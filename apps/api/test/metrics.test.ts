import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { app, ask, resetDatabase, signUp, uploadAndIngest } from './helpers';

beforeEach(resetDatabase);

/** Reads one metric's value out of the Prometheus text output. */
function metric(text: string, name: string): number {
  const line = text.split('\n').find((l) => l.startsWith(`${name} `));
  if (!line) throw new Error(`metric ${name} not found`);
  return Number(line.split(' ').at(-1));
}

describe('GET /metrics', () => {
  it('reports requests, chat cache hits/misses, latency percentiles and queue depth', async () => {
    const before = await request(app).get('/metrics');
    const { agent, tenantId } = await signUp('Acme');
    await uploadAndIngest(agent, tenantId, 'Refunds are processed within 5 business days.');
    await ask(agent, 'How long do refunds take?');
    await ask(agent, 'How long do refunds take?');
    await agent.get('/api/does-not-exist');
    await request(app).get('/health'); // probes are excluded

    const res = await request(app).get('/metrics').expect(200);
    const text = res.text;

    expect(res.headers['content-type']).toMatch(/^text\/plain/);
    expect(text).toContain('# TYPE docspilot_http_requests_total counter');
    const delta = (name: string) => metric(text, name) - metric(before.text, name);
    expect(delta('docspilot_chat_answers_total{cache="miss"}')).toBe(1);
    expect(delta('docspilot_chat_answers_total{cache="hit"}')).toBe(1);
    expect(delta('docspilot_http_requests_total{status="4xx"}')).toBe(1);
    expect(delta('docspilot_http_requests_total{status="2xx"}')).toBeGreaterThanOrEqual(4);
    expect(metric(text, 'docspilot_chat_cache_hit_ratio')).toBeGreaterThan(0);
    expect(metric(text, 'docspilot_chat_answer_duration_p95_ms')).toBeGreaterThanOrEqual(0);
    expect(text).toMatch(/docspilot_ingest_queue_jobs\{state="waiting"\} \d+/);
  });
});
