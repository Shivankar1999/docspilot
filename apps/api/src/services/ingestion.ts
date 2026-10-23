import { UnrecoverableError } from 'bullmq';
import { withTenant } from '../db/pool';
import { logger } from '../lib/logger';
import type { EmbeddingProvider } from '../providers/types';
import { chunkText, estimateTokens } from './chunking';
import { bumpDocsVersion, setDocumentStatus } from './documents';
import { extractText } from './extract';
import { readStoredFile } from './storage';
import { recordUsage } from './usage';

export interface IngestJobData {
  documentId: string;
  tenantId: string;
}

export interface IngestOptions {
  embedder: EmbeddingProvider;
  attempt: number; // 1-based
  maxAttempts: number;
}

/**
 * The ingestion pipeline for one document: extract → chunk → embed → store.
 *
 * Idempotent: the last step replaces all of the document's chunks in a single
 * transaction, so a retry or a duplicate run can never leave duplicate chunks.
 * Errors are rethrown so BullMQ can retry; UnrecoverableError (e.g. a file with
 * no text) fails immediately, since retrying would give the same result.
 */
export async function ingestDocument(
  { documentId, tenantId }: IngestJobData,
  { embedder, attempt, maxAttempts }: IngestOptions,
): Promise<{ chunks: number; embeddingTokens: number }> {
  const started = performance.now();
  const doc = await startProcessing(tenantId, documentId);
  if (!doc) return { chunks: 0, embeddingTokens: 0 }; // deleted after upload: nothing to do

  try {
    const chunks = await readChunks(doc.storagePath, doc.mimeType);
    const { embeddings, tokens } = await embedder.embed(chunks, 'document');
    await replaceChunks(tenantId, documentId, chunks, embeddings);
    await recordUsage({
      tenantId,
      kind: 'ingest',
      model: null,
      inputTokens: 0,
      outputTokens: 0,
      embeddingModel: embedder.model,
      embeddingTokens: tokens,
      latencyMs: performance.now() - started,
      cacheHit: false,
    });

    logger.info(
      { tenantId, documentId, chunks: chunks.length, embeddingTokens: tokens, durationMs: Math.round(performance.now() - started) },
      'document ingested',
    );
    return { chunks: chunks.length, embeddingTokens: tokens };
  } catch (err) {
    const message = (err as Error).message.slice(0, 500);
    const final = err instanceof UnrecoverableError || attempt >= maxAttempts;
    await setDocumentStatus(
      tenantId,
      documentId,
      final ? 'failed' : 'pending',
      final ? message : `Attempt ${attempt} of ${maxAttempts} failed, retrying: ${message}`,
    ).catch((statusErr) => logger.error({ err: statusErr, documentId }, 'could not record failure'));
    throw err;
  }
}

async function startProcessing(tenantId: string, documentId: string) {
  return withTenant(tenantId, async (db) => {
    const { rows } = await db.query<{ storagePath: string; mimeType: string }>(
      `UPDATE documents SET status = 'processing', error = NULL, updated_at = now()
       WHERE id = $1 RETURNING storage_path AS "storagePath", mime_type AS "mimeType"`,
      [documentId],
    );
    return rows.at(0);
  });
}

// Problems here are properties of the file itself, so retrying can't help.
async function readChunks(storagePath: string, mimeType: string): Promise<string[]> {
  let text: string;
  try {
    text = await extractText(await readStoredFile(storagePath), mimeType);
  } catch (err) {
    throw new UnrecoverableError(`Could not read this file: ${(err as Error).message}`);
  }

  const chunks = chunkText(text);
  if (chunks.length === 0) {
    throw new UnrecoverableError(
      'No text found in this file. Scanned PDFs without a text layer are not supported.',
    );
  }
  return chunks;
}

async function replaceChunks(
  tenantId: string,
  documentId: string,
  chunks: string[],
  embeddings: number[][],
): Promise<void> {
  await withTenant(tenantId, async (db) => {
    // Lock the document row so two runs of the same job (e.g. a stalled job
    // that got picked up again) take turns instead of interleaving.
    const locked = await db.query('SELECT 1 FROM documents WHERE id = $1 FOR UPDATE', [documentId]);
    if (locked.rowCount === 0) return; // deleted while we were embedding

    await db.query('DELETE FROM chunks WHERE document_id = $1', [documentId]);
    // unnest() turns parallel arrays into rows: every chunk in one round trip.
    // Vectors travel as '[0.1,0.2,...]' text, pgvector's input format.
    await db.query(
      `INSERT INTO chunks (tenant_id, document_id, chunk_index, content, token_count, embedding)
       SELECT $1, $2, t.idx, t.content, t.tokens, t.embedding::vector
       FROM unnest($3::int[], $4::text[], $5::int[], $6::text[]) AS t(idx, content, tokens, embedding)`,
      [
        tenantId,
        documentId,
        chunks.map((_, i) => i),
        chunks,
        chunks.map(estimateTokens),
        embeddings.map((e) => JSON.stringify(e)),
      ],
    );
    await db.query(
      `UPDATE documents SET status = 'ready', error = NULL, chunk_count = $2, updated_at = now()
       WHERE id = $1`,
      [documentId, chunks.length],
    );
    await bumpDocsVersion(db, tenantId);
  });
}
