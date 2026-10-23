import { pool } from '../db/pool';
import { getIngestOverview } from '../jobs/ingest';

// Platform-operator view across ALL tenants. It is deliberately cross-tenant, so it
// uses the owner connection (no RLS) and is only reachable behind requireAdmin.

export async function getAdminOverview() {
  const [tenants, documents, usage, topTenants, queue] = await Promise.all([
    pool.query<{ count: number }>('SELECT count(*) FROM tenants'),
    pool.query<{ status: string; count: number }>('SELECT status, count(*) FROM documents GROUP BY status'),
    pool.query<{ messages: number; costUsd: number; cacheHitRate: number | null; p95LatencyMs: number | null }>(
      `SELECT count(*) FILTER (WHERE kind = 'chat') AS messages,
              coalesce(sum(cost_usd), 0)::float8 AS "costUsd",
              avg(cache_hit::int) FILTER (WHERE kind = 'chat')::float8 AS "cacheHitRate",
              percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms) FILTER (WHERE kind = 'chat') AS "p95LatencyMs"
       FROM usage_events WHERE created_at >= now() - interval '30 days'`,
    ),
    pool.query<{ name: string; messages: number; costUsd: number }>(
      `SELECT t.name, count(*) FILTER (WHERE e.kind = 'chat') AS messages,
              coalesce(sum(e.cost_usd), 0)::float8 AS "costUsd"
       FROM usage_events e JOIN tenants t ON t.id = e.tenant_id
       WHERE e.created_at >= now() - interval '30 days'
       GROUP BY t.id ORDER BY "costUsd" DESC, messages DESC LIMIT 5`,
    ),
    getIngestOverview(),
  ]);

  // Add the tenant and file names to failed jobs (the document may be deleted since).
  const names = await pool.query<{ id: string; filename: string; tenantName: string }>(
    `SELECT d.id, d.filename, t.name AS "tenantName"
     FROM documents d JOIN tenants t ON t.id = d.tenant_id WHERE d.id = ANY($1::uuid[])`,
    [queue.failed.map((job) => job.documentId)],
  );
  const byId = new Map(names.rows.map((row) => [row.id, row]));

  return {
    tenants: tenants.rows[0].count,
    documents: Object.fromEntries(documents.rows.map((row) => [row.status, row.count])),
    last30Days: usage.rows[0],
    topTenants: topTenants.rows,
    queue: queue.counts,
    failedJobs: queue.failed.map((job) => ({
      ...job,
      filename: byId.get(job.documentId)?.filename ?? null,
      tenantName: byId.get(job.documentId)?.tenantName ?? null,
    })),
  };
}
