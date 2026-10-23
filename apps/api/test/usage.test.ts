import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../src/db/pool';
import { estimateCostUsd } from '../src/services/pricing';
import { app, ask, resetDatabase, signUp, uploadAndIngest } from './helpers';

const POLICY = 'Refunds are processed within 5 business days. Shipping takes 3 to 7 days.';

beforeEach(resetDatabase);

async function events(tenantId: string) {
  const { rows } = await pool.query(
    `SELECT kind, model, input_tokens, output_tokens, embedding_tokens, cost_usd::float8 AS cost, latency_ms, cache_hit
     FROM usage_events WHERE tenant_id = $1 ORDER BY id`,
    [tenantId],
  );
  return rows;
}

/** Plan limits are operator-controlled, so tests set them with the owner connection. */
async function setLimits(tenantId: string, limits: { messages?: number; documents?: number; storageBytes?: number }) {
  await pool.query(
    `UPDATE tenants SET
       monthly_message_limit = coalesce($2, monthly_message_limit),
       max_documents = coalesce($3, max_documents),
       max_storage_bytes = coalesce($4, max_storage_bytes)
     WHERE id = $1`,
    [tenantId, limits.messages ?? null, limits.documents ?? null, limits.storageBytes ?? null],
  );
}

describe('cost estimates', () => {
  it('prices chat and embedding tokens per model (mocks are free)', () => {
    const million = { inputTokens: 1_000_000, outputTokens: 1_000_000, embeddingTokens: 1_000_000 };
    expect(estimateCostUsd({ ...million, model: 'claude-opus-5-5', embeddingModel: 'voyage-4' })).toBeCloseTo(24.06);
    expect(estimateCostUsd({ ...million, model: 'claude-haiku-5-5', embeddingModel: null })).toBeCloseTo(0.6);
    expect(estimateCostUsd({ ...million, model: 'mock-extractive-v1', embeddingModel: 'mock-hashing-v1' })).toBe(0);
  });
});

describe('usage metering', () => {
  it('records ingestion and every chat answer, including cache hits', async () => {
    const { agent, tenantId } = await signUp('Acme');
    await uploadAndIngest(agent, tenantId, POLICY);
    await ask(agent, 'How long do refunds take?');
    await ask(agent, 'How long do refunds take?');

    const [ingest, miss, hit] = await events(tenantId);
    expect(ingest).toMatchObject({ kind: 'ingest', model: 'mock-hashing-v1', cache_hit: false });
    expect(ingest.embedding_tokens).toBeGreaterThan(0);
    expect(miss).toMatchObject({ kind: 'chat', model: 'mock-extractive-v1', cache_hit: false });
    expect(miss.input_tokens).toBeGreaterThan(0);
    expect(miss.output_tokens).toBeGreaterThan(0);
    expect(miss.latency_ms).toBeGreaterThanOrEqual(0);
    expect(hit).toMatchObject({ kind: 'chat', model: null, cache_hit: true, input_tokens: 0, embedding_tokens: 0 });
  });
});

describe('plan limits', () => {
  it('blocks chat with 402 once the monthly message allowance is used', async () => {
    const { agent, tenantId } = await signUp('Acme');
    await setLimits(tenantId, { messages: 2 });

    expect((await ask(agent, 'first')).status).toBe(200);
    expect((await ask(agent, 'second')).status).toBe(200);
    const blocked = await ask(agent, 'third');

    expect(blocked.status).toBe(402);
    expect(blocked.json.error).toMatchObject({
      code: 'PLAN_LIMIT_REACHED',
      details: { limit: 'messages', used: 2, max: 2 },
    });
    expect(blocked.json.error.details.resetsAt).toMatch(/^\d{4}-\d{2}-01T00:00:00/);
  });

  it("doesn't count last month's messages", async () => {
    const { agent, tenantId } = await signUp('Acme');
    await setLimits(tenantId, { messages: 1 });
    await pool.query(
      `INSERT INTO usage_events (tenant_id, kind, created_at)
       VALUES ($1, 'chat', date_trunc('month', now(), 'UTC') - interval '1 day')`,
      [tenantId],
    );

    expect((await ask(agent, 'new month, new allowance')).status).toBe(200);
  });

  it('blocks uploads beyond the document limit, leaving no file behind', async () => {
    const { agent, tenantId } = await signUp('Acme');
    await setLimits(tenantId, { documents: 1 });
    await agent.post('/api/documents').attach('file', Buffer.from('one'), 'one.txt').expect(202);

    const res = await agent.post('/api/documents').attach('file', Buffer.from('two'), 'two.txt');

    expect(res.status).toBe(402);
    expect(res.body.error.details).toMatchObject({ limit: 'documents', used: 1, max: 1 });
    const { rows } = await pool.query('SELECT filename FROM documents WHERE tenant_id = $1', [tenantId]);
    expect(rows.map((r) => r.filename)).toEqual(['one.txt']);
  });

  it('blocks uploads that would exceed the storage limit', async () => {
    const { agent, tenantId } = await signUp('Acme');
    await setLimits(tenantId, { storageBytes: 20 });

    const res = await agent.post('/api/documents').attach('file', Buffer.alloc(30, 'a'), 'big.txt');

    expect(res.status).toBe(402);
    expect(res.body.error.details).toMatchObject({ limit: 'storage', used: 0, max: 20 });
  });

  it('enforces the document limit atomically under parallel uploads', async () => {
    const { agent, tenantId } = await signUp('Acme');
    await setLimits(tenantId, { documents: 2 });

    const results = await Promise.all(
      [1, 2, 3, 4, 5].map((i) => agent.post('/api/documents').attach('file', Buffer.from(`doc ${i}`), `${i}.txt`)),
    );

    expect(results.filter((r) => r.status === 202)).toHaveLength(2);
    expect(results.filter((r) => r.status === 402)).toHaveLength(3);
  });
});

describe('GET /api/usage', () => {
  it('returns month-to-date usage against limits and 30 zero-filled days', async () => {
    const { agent, tenantId } = await signUp('Acme');
    await uploadAndIngest(agent, tenantId, POLICY);
    await ask(agent, 'How long do refunds take?');

    const res = await agent.get('/api/usage').expect(200);

    expect(res.body.month).toMatchObject({ messages: 1, messageLimit: 1000, documents: 1, documentLimit: 50 });
    expect(res.body.month.storageBytes).toBe(POLICY.length);
    expect(res.body.daily).toHaveLength(30);
    const today = res.body.daily.at(-1);
    expect(today.date).toBe(new Date().toISOString().slice(0, 10));
    expect(today.messages).toBe(1);
    expect(res.body.daily[0]).toMatchObject({ messages: 0, costUsd: 0 });
  });

  it('is dashboard-only (a secret key cannot read it)', async () => {
    const { agent } = await signUp('Acme');
    const key = (await agent.post('/api/tenant/secret-key')).body.secretKey;
    await request(app).get('/api/usage').set('Authorization', `Bearer ${key}`).expect(401);
  });
});
