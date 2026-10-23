import { Redis } from 'ioredis';
import { config } from '../config';
import { logger } from './logger';

// One shared connection for rate limiting and caching.
// (BullMQ creates its own connections, as it requires different settings.)
export const redis = new Redis(config.REDIS_URL, {
  // Fail fast when Redis is unreachable: callers fall back (fail open) instead of hanging.
  commandTimeout: 1_000,
});

// Without a listener, ioredis reports every reconnect attempt as an unhandled error.
redis.on('error', (err) => logger.warn({ err: err.message }, 'redis connection error'));
