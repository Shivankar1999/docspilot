import { afterAll } from 'vitest';
import { pool } from '../src/db/pool';
import { closeIngestQueue } from '../src/jobs/ingest';
import { redis } from '../src/lib/redis';

// Close shared connections after each test file so Vitest can exit cleanly.
afterAll(async () => {
  await closeIngestQueue();
  await pool.end();
  redis.disconnect();
});
