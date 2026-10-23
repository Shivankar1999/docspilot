import { Client } from 'pg';
import type { TestProject } from 'vitest/node';
import { runMigrations } from '../src/db/migrate';

// Runs once before all test files: make sure the test database exists and is migrated.
export default async function setup(project: TestProject) {
  const databaseUrl = project.config.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is missing from the Vitest env');

  await createDatabaseIfMissing(databaseUrl);
  await runMigrations(databaseUrl);
}

async function createDatabaseIfMissing(connectionString: string) {
  const url = new URL(connectionString);
  const dbName = url.pathname.slice(1);
  url.pathname = '/postgres'; // connect to the default DB to create the test one

  const client = new Client({ connectionString: url.toString() });
  await client.connect();
  try {
    const { rowCount } = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
    if (!rowCount) await client.query(`CREATE DATABASE "${dbName}"`);
  } finally {
    await client.end();
  }
}
