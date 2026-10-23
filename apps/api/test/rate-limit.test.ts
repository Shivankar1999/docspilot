import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { consumeRateLimit } from '../src/lib/rateLimit';
import { redis } from '../src/lib/redis';
import { ask, resetDatabase, signUp } from './helpers';

// Test limits (vitest.config.mts): 5 per IP and 8 per tenant per minute.

beforeEach(resetDatabase);
afterEach(() => vi.restoreAllMocks());

describe('sliding window (Redis Lua script)', () => {
  it('allows up to the limit, blocks, then frees a slot as old requests slide out', async () => {
    const rule = [{ scope: 'test', key: 'ratelimit:test:slide', limit: 2 }];

    expect((await consumeRateLimit(rule, 400)).allowed).toBe(true);
    expect((await consumeRateLimit(rule, 400)).allowed).toBe(true);
    const blocked = await consumeRateLimit(rule, 400);
    expect(blocked.allowed).toBe(false);
    if (!blocked.allowed) expect(blocked.retryAfterMs).toBeGreaterThan(0);

    await new Promise((r) => setTimeout(r, 450));
    expect((await consumeRateLimit(rule, 400)).allowed).toBe(true);
  });

  it('is all-or-nothing: a request blocked by one limit is not counted by the others', async () => {
    const full = { scope: 'a', key: 'ratelimit:test:full', limit: 1 };
    const roomy = { scope: 'b', key: 'ratelimit:test:roomy', limit: 10 };
    await consumeRateLimit([full], 60_000);

    const result = await consumeRateLimit([roomy, full], 60_000);

    expect(result).toMatchObject({ allowed: false, blockedBy: { scope: 'a' } });
    expect(await redis.zcard(roomy.key)).toBe(0);
  });
});

describe('POST /api/chat rate limits', () => {
  it('limits each IP, with a 429, a Retry-After header and a JSON error', async () => {
    const { agent } = await signUp('Acme');
    for (let i = 0; i < 5; i++) {
      expect((await ask(agent, `question ${i}`, { ip: '198.51.100.7' })).status).toBe(200);
    }

    const blocked = await ask(agent, 'one too many', { ip: '198.51.100.7' });
    expect(blocked.status).toBe(429);
    expect(blocked.json.error).toMatchObject({ code: 'RATE_LIMITED', details: { scope: 'ip' } });
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);

    // A different visitor of the same tenant is unaffected.
    expect((await ask(agent, 'hello', { ip: '198.51.100.8' })).status).toBe(200);
  });

  it('limits each tenant across all IPs, without affecting other tenants', async () => {
    const busy = await signUp('Busy');
    for (let i = 1; i <= 8; i++) {
      expect((await ask(busy.agent, `question ${i}`, { ip: `10.0.0.${i}` })).status).toBe(200);
    }

    const blocked = await ask(busy.agent, 'one too many', { ip: '10.0.0.9' });
    expect(blocked.status).toBe(429);
    expect(blocked.json.error.details.scope).toBe('tenant');

    const other = await signUp('Calm');
    expect((await ask(other.agent, 'hello', { ip: '10.0.0.9' })).status).toBe(200);
  });

  it('fails open: if Redis is down, chat keeps working', async () => {
    const { agent } = await signUp('Acme');
    vi.spyOn(redis, 'eval').mockRejectedValueOnce(new Error('Connection is closed.'));

    expect((await ask(agent, 'still there?')).status).toBe(200);
  });
});
