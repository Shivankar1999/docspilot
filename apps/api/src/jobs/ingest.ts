import { setTimeout as sleep } from 'node:timers/promises';
import { waitUntil } from '@vercel/functions';
import { Queue, UnrecoverableError, Worker, type JobsOptions } from 'bullmq';
import { Redis } from 'ioredis';
import { config } from '../config';
import { pool, withTenant } from '../db/pool';
import { logger } from '../lib/logger';
import { getEmbeddingProvider } from '../providers';
import type { EmbeddingProvider } from '../providers/types';
import { ingestDocument, type IngestJobData } from '../services/ingestion';

export const INGEST_QUEUE = 'ingest';

export const INGEST_JOB_OPTIONS: JobsOptions = {
  attempts: 3, // 1 try + up to 2 retries
  backoff: { type: 'exponential', delay: 2_000 }, // wait 2s, then 4s
  removeOnComplete: { age: 24 * 3600, count: 1_000 },
  removeOnFail: { age: 7 * 24 * 3600 }, // keep failures for a week (admin page)
};

// BullMQ needs maxRetriesPerRequest: null: its blocking commands wait indefinitely.
const createConnection = () => new Redis(config.REDIS_URL, { maxRetriesPerRequest: null });

let queue: { queue: Queue<IngestJobData>; connection: Redis } | undefined;

/** The producer side, used by the API. Created on first use. */
export function getIngestQueue(): Queue<IngestJobData> {
  if (!queue) {
    const connection = createConnection();
    queue = { queue: new Queue<IngestJobData>(INGEST_QUEUE, { connection }), connection };
  }
  return queue.queue;
}

/** jobId = documentId: BullMQ ignores a duplicate add while that job exists, so one upload = one job. */
export function enqueueIngest(data: IngestJobData) {
  return getIngestQueue().add('ingest', data, { ...INGEST_JOB_OPTIONS, jobId: data.documentId });
}

/** Starts ingesting an uploaded document: as a BullMQ job, or (INGEST_MODE=inline) in this process. */
export async function dispatchIngest(data: IngestJobData): Promise<void> {
  if (config.INGEST_MODE === 'queue') {
    await enqueueIngest(data);
    return;
  }
  // The response goes out right away; waitUntil keeps a serverless function alive until this finishes.
  waitUntil(ingestInline(data));
}

/**
 * The worker's job for serverless hosts with no worker process: the same attempts and
 * exponential backoff as INGEST_JOB_OPTIONS, run in the background of the upload request.
 * Never rejects; ingestDocument() records each failure on the document.
 */
export async function ingestInline(
  data: IngestJobData,
  { embedder = getEmbeddingProvider(), backoffMs = 2_000 }: { embedder?: EmbeddingProvider; backoffMs?: number } = {},
): Promise<void> {
  const maxAttempts = INGEST_JOB_OPTIONS.attempts ?? 1;
  for (let attempt = 1; ; attempt++) {
    try {
      await ingestDocument(data, { embedder, attempt, maxAttempts });
      return;
    } catch (err) {
      logger.warn({ documentId: data.documentId, attempt, err: (err as Error).message }, 'inline ingest failed');
      if (err instanceof UnrecoverableError || attempt >= maxAttempts) return;
      await sleep(backoffMs * 2 ** (attempt - 1)); // 2s, then 4s
    }
  }
}

// Longer than a function's maximum run time (300 s), so the original run is surely gone.
const STALLED_AFTER = "interval '10 minutes'";

/**
 * Inline mode's stand-in for BullMQ's stalled-job recovery: if the function running an
 * ingestion died (crash, timeout), its document stays pending/processing. Called when the
 * dashboard lists documents: restarts such runs, or gives up on uploads over an hour old.
 * Claiming bumps updated_at, so parallel calls never restart the same document twice.
 * Returns the restarted document ids.
 */
export async function resumeStalledIngests(tenantId: string): Promise<string[]> {
  const restarted = await withTenant(tenantId, async (db) => {
    await db.query(
      `UPDATE documents SET status = 'failed', error = 'Processing was interrupted. Please upload the file again.',
              updated_at = now()
       WHERE status IN ('pending', 'processing') AND updated_at < now() - ${STALLED_AFTER}
         AND created_at < now() - interval '1 hour'`,
    );
    const { rows } = await db.query<{ id: string }>(
      `UPDATE documents SET updated_at = now()
       WHERE status IN ('pending', 'processing') AND updated_at < now() - ${STALLED_AFTER}
       RETURNING id`,
    );
    return rows.map((row) => row.id);
  });
  for (const documentId of restarted) waitUntil(ingestInline({ documentId, tenantId }));
  return restarted;
}

type IngestState = 'waiting' | 'active' | 'delayed' | 'completed' | 'failed';

/** Ingestion counts per state, for /metrics and the admin page. */
export async function getIngestCounts(): Promise<Record<IngestState, number>> {
  if (config.INGEST_MODE === 'queue') {
    const counts = await getIngestQueue().getJobCounts('waiting', 'active', 'delayed', 'completed', 'failed');
    return counts as Record<IngestState, number>;
  }
  // Inline mode has no queue: the documents table holds the same information.
  const { rows } = await pool.query<{ status: string; count: number }>(
    'SELECT status, count(*) FROM documents GROUP BY status',
  );
  const count = (status: string) => rows.find((row) => row.status === status)?.count ?? 0;
  return {
    waiting: count('pending'),
    active: count('processing'),
    delayed: 0,
    completed: count('ready'),
    failed: count('failed'),
  };
}

/** Job counts per state plus the most recent failures, for the admin page. */
export async function getIngestOverview(failedLimit = 10) {
  const counts = await getIngestCounts();
  if (config.INGEST_MODE === 'inline') return { counts, failed: await getFailedDocuments(failedLimit) };

  const failed = await getIngestQueue().getFailed(0, failedLimit - 1); // newest first
  return {
    counts,
    failed: failed.map((job) => ({
      id: job.id ?? '',
      documentId: job.data.documentId,
      tenantId: job.data.tenantId,
      reason: job.failedReason,
      attempts: job.attemptsMade as number | null,
      failedAt: job.finishedOn ? new Date(job.finishedOn).toISOString() : null,
    })),
  };
}

/** Inline mode's "failed jobs": documents that failed in the last 7 days. Attempts aren't recorded. */
export async function getFailedDocuments(limit: number) {
  const { rows } = await pool.query<{ documentId: string; tenantId: string; reason: string; failedAt: Date }>(
    `SELECT id AS "documentId", tenant_id AS "tenantId", coalesce(error, '') AS reason, updated_at AS "failedAt"
     FROM documents
     WHERE status = 'failed' AND updated_at > now() - interval '7 days'
     ORDER BY updated_at DESC LIMIT $1`,
    [limit],
  );
  return rows.map((row) => ({
    id: row.documentId,
    documentId: row.documentId,
    tenantId: row.tenantId,
    reason: row.reason,
    attempts: null as number | null,
    failedAt: row.failedAt.toISOString(),
  }));
}

export async function closeIngestQueue(): Promise<void> {
  if (!queue) return;
  await queue.queue.close();
  queue.connection.disconnect();
  queue = undefined;
}

/** The consumer side, run by worker.ts. Returns a close() that waits for in-flight jobs. */
export function createIngestWorker(embedder: EmbeddingProvider, concurrency = 2) {
  const connection = createConnection();
  const worker = new Worker<IngestJobData>(
    INGEST_QUEUE,
    (job) =>
      ingestDocument(job.data, {
        embedder,
        attempt: job.attemptsMade + 1, // attemptsMade counts previous failed attempts
        maxAttempts: job.opts.attempts ?? 1,
      }),
    { connection, concurrency },
  );

  worker.on('failed', (job, err) =>
    logger.warn({ jobId: job?.id, attemptsMade: job?.attemptsMade, err: err.message }, 'ingest job failed'),
  );

  return {
    worker,
    async close() {
      await worker.close();
      connection.disconnect();
    },
  };
}
