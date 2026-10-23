import { createApp } from './app';
import { config } from './config';
import { pool } from './db/pool';
import { logger } from './lib/logger';
import { redis } from './lib/redis';

const server = createApp().listen(config.PORT, () => {
  logger.info({ port: config.PORT }, 'api listening');
});

// Graceful shutdown: stop accepting connections, let in-flight requests finish,
// then close the pools. The timer is a safety net for long-lived SSE streams.
function shutdown(signal: string) {
  logger.info({ signal }, 'shutting down');
  server.close(async () => {
    await pool.end();
    redis.disconnect();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
