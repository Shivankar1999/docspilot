import { config } from '../config';
import { withTenant } from '../db/pool';
import type { EmbeddingProvider } from '../providers/types';

// How many chunks to hand the model. 5 × ~500 tokens ≈ 2.5k tokens of context:
// enough to cover an answer spread over a few passages, small enough to stay cheap.
export const TOP_K = 5;

export interface RetrievedChunk {
  id: string;
  documentId: string;
  filename: string;
  chunkIndex: number;
  content: string;
  similarity: number; // cosine similarity, 1 = same direction, 0 = unrelated
}

// `<=>` is pgvector's cosine *distance* (0 = identical); similarity = 1 - distance.
// ORDER BY distance + LIMIT is what lets Postgres use the HNSW index.
// The inner query searches chunks only (index-friendly); the outer one adds filenames.
const SEARCH_SQL = `
  WITH nearest AS MATERIALIZED (
    SELECT id, document_id, chunk_index, content, embedding <=> $1::vector AS distance
    FROM chunks
    ORDER BY embedding <=> $1::vector
    LIMIT $2
  )
  SELECT n.id, n.document_id AS "documentId", d.filename, n.chunk_index AS "chunkIndex",
         n.content, 1 - n.distance AS similarity
  FROM nearest n
  JOIN documents d ON d.id = n.document_id
  ORDER BY n.distance`;

/**
 * The tenant's chunks most similar to the question, keeping only those above the
 * relevance threshold. An empty result means "the docs don't cover this".
 */
export async function retrieveChunks(
  tenantId: string,
  question: string,
  embedder: EmbeddingProvider,
): Promise<{ chunks: RetrievedChunk[]; embeddingTokens: number }> {
  const { embeddings, tokens } = await embedder.embed([question], 'query');
  const minSimilarity = config.RETRIEVAL_MIN_SIMILARITY ?? embedder.minSimilarity;

  const rows = await withTenant(tenantId, async (db) => {
    // Tenant scoping comes from RLS (WHERE tenant_id = current tenant). pgvector applies
    // such filters *after* the HNSW scan, so a small tenant's chunks could be crowded out
    // by a big tenant's; iterative scan keeps scanning until LIMIT rows pass the filter.
    await db.query("SET LOCAL hnsw.iterative_scan = 'relaxed_order'");
    const { rows } = await db.query<RetrievedChunk>(SEARCH_SQL, [
      JSON.stringify(embeddings[0]),
      TOP_K,
    ]);
    return rows;
  });

  return { chunks: rows.filter((r) => r.similarity >= minSimilarity), embeddingTokens: tokens };
}
