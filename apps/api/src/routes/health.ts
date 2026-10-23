import { Router } from 'express';
import { pool } from '../db/pool';
import { redis } from '../lib/redis';

export const healthRouter = Router();

// Used by Docker/load balancers: 200 when every dependency answers, 503 otherwise.
healthRouter.get('/health', async (_req, res) => {
  const [postgres, cache] = await Promise.all([
    probe(() => pool.query('SELECT 1')),
    probe(() => redis.ping()),
  ]);
  const ok = postgres && cache;

  res.status(ok ? 200 : 503).json({
    status: ok ? 'ok' : 'degraded',
    checks: { postgres: postgres ? 'up' : 'down', redis: cache ? 'up' : 'down' },
    uptimeSeconds: Math.round(process.uptime()),
  });
});

// A hung dependency must not hang the health check, so each probe gets a timeout.
async function probe(check: () => Promise<unknown>, timeoutMs = 1_000): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('timeout')), timeoutMs);
  });
  try {
    await Promise.race([check(), timeout]);
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
