import { describe, expect, it } from 'vitest';
import { pool } from '../src/db/pool';

describe('database schema', () => {
  it('has a tenant_id column on every tenant-data table', async () => {
    const tables = ['users', 'documents', 'chunks', 'conversations', 'messages', 'usage_events'];
    const { rows } = await pool.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.columns
       WHERE table_schema = 'public' AND column_name = 'tenant_id'`,
    );
    const withTenantId = rows.map((r) => r.table_name);

    for (const table of tables) expect(withTenantId).toContain(table);
  });

  it('indexes chunk embeddings with HNSW (cosine distance)', async () => {
    const { rows } = await pool.query<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes WHERE indexname = 'chunks_embedding_hnsw_idx'`,
    );

    expect(rows[0]?.indexdef).toContain('USING hnsw (embedding vector_cosine_ops)');
  });

  it('stores 1024-dimensional embeddings', async () => {
    const { rows } = await pool.query<{ type: string }>(
      `SELECT format_type(atttypid, atttypmod) AS type FROM pg_attribute
       WHERE attrelid = 'chunks'::regclass AND attname = 'embedding'`,
    );

    expect(rows[0]?.type).toBe('vector(1024)');
  });
});
