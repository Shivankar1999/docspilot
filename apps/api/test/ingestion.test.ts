import { UnrecoverableError } from 'bullmq';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../src/db/pool';
import {
  createIngestWorker,
  getIngestQueue,
  INGEST_JOB_OPTIONS,
  ingestInline,
  resumeStalledIngests,
} from '../src/jobs/ingest';
import { MockEmbeddingProvider } from '../src/providers/mock';
import type { EmbeddingInputType, EmbeddingProvider } from '../src/providers/types';
import { ingestDocument } from '../src/services/ingestion';
import { makePdf, resetDatabase, signUp, waitFor } from './helpers';

const mock = new MockEmbeddingProvider();

/** Fails the first `failures` calls (like a flaky embedding API), then works. */
class FlakyEmbedder implements EmbeddingProvider {
  readonly model = 'flaky';
  readonly minSimilarity = mock.minSimilarity;
  calls = 0;
  constructor(private readonly failures: number) {}
  async embed(texts: string[], inputType: EmbeddingInputType) {
    this.calls++;
    if (this.calls <= this.failures) throw new Error('Embedding API timed out');
    return mock.embed(texts);
  }
}

// ~16k characters: several chunks.
const handbook = Array.from(
  { length: 30 },
  (_, i) => `Section ${i}. ` + 'Refunds are accepted within thirty days of purchase. '.repeat(10),
).join('\n\n');

beforeEach(async () => {
  await resetDatabase();
  await getIngestQueue().obliterate({ force: true });
});

async function upload(content: string | Buffer, filename = 'handbook.txt') {
  const { agent, tenantId } = await signUp('Acme');
  const res = await agent
    .post('/api/documents')
    .attach('file', Buffer.from(content), filename)
    .expect(202);
  return { agent, tenantId, documentId: res.body.document.id as string };
}

function run(doc: { tenantId: string; documentId: string }, embedder: EmbeddingProvider = mock, attempt = 1) {
  return ingestDocument(doc, { embedder, attempt, maxAttempts: 3 });
}

async function stateOf(documentId: string) {
  const doc = await pool.query<{ status: string; error: string | null; chunk_count: number }>(
    'SELECT status, error, chunk_count FROM documents WHERE id = $1',
    [documentId],
  );
  const chunks = await pool.query<{ chunk_index: number; content: string; dims: number }>(
    `SELECT chunk_index, content, vector_dims(embedding) AS dims
     FROM chunks WHERE document_id = $1 ORDER BY chunk_index`,
    [documentId],
  );
  return { ...doc.rows[0], chunks: chunks.rows };
}

describe('ingestion pipeline', () => {
  it('extracts, chunks, embeds and stores a text file', async () => {
    const doc = await upload(handbook);
    const result = await run(doc);

    const state = await stateOf(doc.documentId);
    expect(state.status).toBe('ready');
    expect(state.error).toBeNull();
    expect(state.chunk_count).toBeGreaterThan(5);
    expect(state.chunks).toHaveLength(state.chunk_count);
    expect(state.chunks.map((c) => c.chunk_index)).toEqual([...Array(state.chunk_count).keys()]);
    expect(state.chunks.every((c) => c.dims === 1024)).toBe(true);
    expect(result.chunks).toBe(state.chunk_count);
  });

  it('extracts text from PDFs', async () => {
    const doc = await upload(makePdf('Refunds are processed within five business days.'), 'faq.pdf');
    await run(doc);

    const state = await stateOf(doc.documentId);
    expect(state.status).toBe('ready');
    expect(state.chunks[0].content).toContain('Refunds are processed within five business days.');
  });

  it('is idempotent: running the same job twice never duplicates chunks', async () => {
    const doc = await upload(handbook);
    await run(doc);
    const first = await stateOf(doc.documentId);
    await run(doc);
    const second = await stateOf(doc.documentId);

    expect(second.chunks).toHaveLength(first.chunks.length);
    expect(second.chunks.map((c) => c.content)).toEqual(first.chunks.map((c) => c.content));
  });

  it('records a failed attempt as "retrying", and a later attempt succeeds', async () => {
    const doc = await upload(handbook);
    const flaky = new FlakyEmbedder(1);

    await expect(run(doc, flaky, 1)).rejects.toThrow('Embedding API timed out');
    const afterFailure = await stateOf(doc.documentId);
    expect(afterFailure.status).toBe('pending');
    expect(afterFailure.error).toMatch(/Attempt 1 of 3 failed, retrying/);
    expect(afterFailure.chunks).toHaveLength(0);

    await run(doc, flaky, 2);
    const afterRetry = await stateOf(doc.documentId);
    expect(afterRetry.status).toBe('ready');
    expect(afterRetry.error).toBeNull();
  });

  it('marks the document failed after the last attempt', async () => {
    const doc = await upload(handbook);
    await expect(run(doc, new FlakyEmbedder(Infinity), 3)).rejects.toThrow();

    const state = await stateOf(doc.documentId);
    expect(state.status).toBe('failed');
    expect(state.error).toBe('Embedding API timed out');
    expect(state.chunks).toHaveLength(0);
  });

  it('fails immediately, without retrying, when the file has no text', async () => {
    const doc = await upload('   \n\n   \t  ');
    await expect(run(doc, mock, 1)).rejects.toBeInstanceOf(UnrecoverableError);

    const state = await stateOf(doc.documentId);
    expect(state.status).toBe('failed'); // on attempt 1 of 3, not "retrying"
    expect(state.error).toMatch(/No text found/);
  });

  it('does nothing for a document deleted before processing', async () => {
    const doc = await upload(handbook);
    await doc.agent.delete(`/api/documents/${doc.documentId}`).expect(204);
    await expect(run(doc)).resolves.toEqual({ chunks: 0, embeddingTokens: 0 });
  });
});

// End to end through real BullMQ + Redis: proves the retry/backoff configuration works.
describe('ingest worker (BullMQ)', () => {
  let worker: ReturnType<typeof createIngestWorker> | undefined;
  afterEach(async () => {
    await worker?.close();
    worker = undefined;
  });

  // Swap the upload's job for one with a 50 ms backoff so the test runs fast.
  async function requeueWithFastBackoff(doc: { tenantId: string; documentId: string }) {
    const queue = getIngestQueue();
    await (await queue.getJob(doc.documentId))?.remove();
    return queue.add('ingest', doc, {
      ...INGEST_JOB_OPTIONS,
      jobId: doc.documentId,
      backoff: { type: 'exponential', delay: 50 },
    });
  }

  it('retries with backoff until the job succeeds', async () => {
    const doc = await upload(handbook);
    const flaky = new FlakyEmbedder(2); // fails attempts 1 and 2
    const job = await requeueWithFastBackoff(doc);
    worker = createIngestWorker(flaky);

    // Wait on the job (BullMQ marks it completed just *after* our processor commits).
    await waitFor(async () => (await job.getState()) === 'completed');
    expect(flaky.calls).toBe(3);
    expect((await stateOf(doc.documentId)).status).toBe('ready');
  });

  it('gives up after 3 attempts and marks the document failed', async () => {
    const doc = await upload(handbook);
    const broken = new FlakyEmbedder(Infinity);
    const job = await requeueWithFastBackoff(doc);
    worker = createIngestWorker(broken);

    await waitFor(async () => (await job.getState()) === 'failed');
    expect(broken.calls).toBe(3);
    expect((await stateOf(doc.documentId)).status).toBe('failed');
  });
});

// INGEST_MODE=inline (the default on Vercel): no worker, the API runs the same retry policy itself.
describe('inline ingestion (serverless)', () => {
  it('retries with backoff until ingestion succeeds', async () => {
    const doc = await upload(handbook);
    const flaky = new FlakyEmbedder(2); // fails attempts 1 and 2
    await ingestInline(doc, { embedder: flaky, backoffMs: 10 });

    expect(flaky.calls).toBe(3);
    expect((await stateOf(doc.documentId)).status).toBe('ready');
  });

  it('gives up after 3 attempts without throwing, and marks the document failed', async () => {
    const doc = await upload(handbook);
    const broken = new FlakyEmbedder(Infinity);
    await expect(ingestInline(doc, { embedder: broken, backoffMs: 10 })).resolves.toBeUndefined();

    expect(broken.calls).toBe(3);
    expect((await stateOf(doc.documentId)).status).toBe('failed');
  });

  it('does not retry a file with no text', async () => {
    const doc = await upload('   \n\n   \t  ');
    await ingestInline(doc, { backoffMs: 60_000 }); // a retry would time the test out

    const state = await stateOf(doc.documentId);
    expect(state.status).toBe('failed');
    expect(state.error).toMatch(/No text found/);
  });
});

describe('resuming stalled inline ingestions', () => {
  // Pretends the document was last touched (and uploaded) that many minutes ago.
  function age(documentId: string, updatedMinutesAgo: number, createdMinutesAgo = updatedMinutesAgo) {
    return pool.query(
      `UPDATE documents SET updated_at = now() - make_interval(mins => $2),
                            created_at = now() - make_interval(mins => $3)
       WHERE id = $1`,
      [documentId, updatedMinutesAgo, createdMinutesAgo],
    );
  }

  it('restarts an ingestion whose function died, exactly once', async () => {
    const doc = await upload(handbook);
    expect(await resumeStalledIngests(doc.tenantId)).toEqual([]); // just uploaded: not stalled

    await age(doc.documentId, 11);
    expect(await resumeStalledIngests(doc.tenantId)).toEqual([doc.documentId]);
    expect(await resumeStalledIngests(doc.tenantId)).toEqual([]); // already claimed

    // The usage row is the run's last write: once it exists, nothing still touches the
    // database, so the next test's TRUNCATE can't collide with this background run.
    await waitFor(async () => (await pool.query("SELECT 1 FROM usage_events WHERE kind = 'ingest'")).rowCount);
    expect((await stateOf(doc.documentId)).status).toBe('ready');
  });

  it('gives up on uploads that stalled over an hour ago', async () => {
    const doc = await upload(handbook);
    await age(doc.documentId, 30, 90);
    expect(await resumeStalledIngests(doc.tenantId)).toEqual([]);

    const state = await stateOf(doc.documentId);
    expect(state.status).toBe('failed');
    expect(state.error).toMatch(/interrupted/);
  });
});
