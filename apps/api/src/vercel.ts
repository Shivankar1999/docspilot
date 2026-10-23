// Vercel entrypoint (see vercel.json): the whole Express app runs as one Vercel
// Function, so there is no listen() here, and no worker process: on Vercel,
// INGEST_MODE defaults to "inline" (see config.ts and jobs/ingest.ts).
import { attachDatabasePool } from '@vercel/functions';
import { createApp } from './app';
import { pool } from './db/pool';

// Instances are reused between requests, then suspended when idle: this closes idle
// Postgres connections before suspension, so they aren't leaked on the database side.
attachDatabasePool(pool);

export default createApp();
