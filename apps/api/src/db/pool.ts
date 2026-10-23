import { Pool, types, type PoolClient } from 'pg';
import { config } from '../config';
import { logger } from '../lib/logger';

// Postgres returns BIGINT (and COUNT(*)) as strings to avoid precision loss. Our values
// (counts, byte sizes) stay far below 2^53, so plain numbers are safe and easier to use.
types.setTypeParser(types.builtins.INT8, (value) => Number(value));

// A pool reuses connections instead of opening one per query (slow and limited).
export const pool = new Pool({
  connectionString: config.DATABASE_URL,
  max: 10,
  connectionTimeoutMillis: 5_000,
});

// An idle client can error (e.g. Postgres restarted). Log it instead of crashing.
pool.on('error', (err) => logger.error({ err }, 'idle postgres client error'));

/** Runs fn inside one transaction on one connection: commits on success, rolls back on error. */
export async function withTransaction<T>(fn: (db: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Runs fn as `tenantId`, with Row-Level Security enforced by Postgres:
 * every query inside sees and writes only that tenant's rows, even without a
 * WHERE tenant_id clause. Use this for ALL tenant data. Plain `pool.query` is
 * reserved for the few system lookups that happen before the tenant is known
 * (signup, login, API-key lookup). See migrations/002_rls.sql.
 */
export function withTenant<T>(tenantId: string, fn: (db: PoolClient) => Promise<T>): Promise<T> {
  return withTransaction(async (db) => {
    await db.query('SET LOCAL ROLE docspilot_tenant');
    // set_config(..., true) is SET LOCAL, but accepts a bound parameter (no SQL injection).
    await db.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    return fn(db);
  });
}
