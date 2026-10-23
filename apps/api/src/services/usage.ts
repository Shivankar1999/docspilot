import { withTenant } from '../db/pool';
import { AppError } from '../lib/errors';
import { logger } from '../lib/logger';
import { estimateCostUsd, type CostInput } from './pricing';

// Monthly limits use calendar months in UTC.
const MONTH_START = `date_trunc('month', now(), 'UTC')`;

export interface UsageRecord extends CostInput {
  tenantId: string;
  kind: 'chat' | 'ingest';
  latencyMs: number;
  cacheHit: boolean;
}

/**
 * Writes one usage_events row: every answered question and every ingested
 * document, with tokens, estimated cost and latency. Failures are logged, not
 * thrown: metering must never break the product for the end user.
 */
export async function recordUsage(record: UsageRecord): Promise<void> {
  try {
    await withTenant(record.tenantId, (db) =>
      db.query(
        `INSERT INTO usage_events
           (tenant_id, kind, model, input_tokens, output_tokens, embedding_tokens, cost_usd, latency_ms, cache_hit)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          record.tenantId,
          record.kind,
          record.model ?? record.embeddingModel,
          record.inputTokens,
          record.outputTokens,
          record.embeddingTokens,
          estimateCostUsd(record),
          Math.round(record.latencyMs),
          record.cacheHit,
        ],
      ),
    );
  } catch (err) {
    logger.error({ err, tenantId: record.tenantId, kind: record.kind }, 'could not record usage');
  }
}

/** First moment of next month (UTC): when monthly limits reset. */
export function monthlyResetDate(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}

/**
 * 402 Payment Required: the plan's allowance is used up, so "upgrade or wait for
 * the reset", which is different from 429 rate limiting's "slow down and retry".
 */
export function planLimitError(limit: 'messages' | 'documents' | 'storage', message: string, details: object) {
  return new AppError(402, 'PLAN_LIMIT_REACHED', message, { limit, ...details });
}

export async function getMonthlyMessageUsage(tenantId: string): Promise<{ used: number; limit: number }> {
  return withTenant(tenantId, async (db) => {
    const { rows } = await db.query<{ used: number; limit: number }>(
      `SELECT (SELECT count(*) FROM usage_events WHERE kind = 'chat' AND created_at >= ${MONTH_START}) AS used,
              monthly_message_limit AS "limit"
       FROM tenants WHERE id = $1`,
      [tenantId],
    );
    return rows[0];
  });
}

export interface UsageSummary {
  month: {
    messages: number;
    messageLimit: number;
    documents: number;
    documentLimit: number;
    storageBytes: number;
    storageLimit: number;
    costUsd: number;
    resetsAt: string;
  };
  daily: {
    date: string;
    messages: number;
    cacheHits: number;
    inputTokens: number;
    outputTokens: number;
    embeddingTokens: number;
    costUsd: number;
  }[];
}

// One row per day for the last $1 days, including days with no usage
// (generate_series supplies the days; LEFT JOIN keeps the empty ones).
const DAILY_SQL = `
  SELECT to_char(d.day AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS date,
         count(e.id) FILTER (WHERE e.kind = 'chat')::int AS messages,
         count(e.id) FILTER (WHERE e.cache_hit)::int AS "cacheHits",
         coalesce(sum(e.input_tokens), 0)::int AS "inputTokens",
         coalesce(sum(e.output_tokens), 0)::int AS "outputTokens",
         coalesce(sum(e.embedding_tokens), 0)::int AS "embeddingTokens",
         coalesce(sum(e.cost_usd), 0)::float8 AS "costUsd"
  FROM generate_series(date_trunc('day', now(), 'UTC') - ($1::int - 1) * interval '1 day',
                       date_trunc('day', now(), 'UTC'), interval '1 day') AS d(day)
  LEFT JOIN usage_events e ON e.created_at >= d.day AND e.created_at < d.day + interval '1 day'
  GROUP BY d.day
  ORDER BY d.day`;

export function getUsageSummary(tenantId: string, days = 30): Promise<UsageSummary> {
  return withTenant(tenantId, async (db) => {
    const month = await db.query<Omit<UsageSummary['month'], 'resetsAt'>>(
      `SELECT
         (SELECT count(*) FROM usage_events WHERE kind = 'chat' AND created_at >= ${MONTH_START}) AS messages,
         (SELECT coalesce(sum(cost_usd), 0) FROM usage_events WHERE created_at >= ${MONTH_START})::float8 AS "costUsd",
         (SELECT count(*) FROM documents) AS documents,
         (SELECT coalesce(sum(size_bytes), 0) FROM documents) AS "storageBytes",
         monthly_message_limit AS "messageLimit",
         max_documents AS "documentLimit",
         max_storage_bytes AS "storageLimit"
       FROM tenants WHERE id = $1`,
      [tenantId],
    );
    const daily = await db.query<UsageSummary['daily'][number]>(DAILY_SQL, [days]);
    return {
      month: { ...month.rows[0], resetsAt: monthlyResetDate().toISOString() },
      daily: daily.rows,
    };
  });
}
