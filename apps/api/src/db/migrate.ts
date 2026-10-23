import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { Client } from 'pg';

// apps/api/migrations — same relative path from src/db (dev) and dist/db (prod).
const MIGRATIONS_DIR = path.resolve(__dirname, '../../migrations');

// Arbitrary constant: the API and worker may start at the same moment,
// and this lock guarantees only one of them applies migrations.
const MIGRATION_LOCK_ID = 727_001;

/**
 * Applies every migrations/*.sql file not yet recorded in schema_migrations,
 * in filename order. Each file runs in its own transaction (all or nothing).
 * Returns the names of the files applied in this run.
 */
export async function runMigrations(
  connectionString: string,
  log: (message: string) => void = () => {},
): Promise<string[]> {
  const client = new Client({ connectionString });
  await client.connect();

  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_ID]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name       text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )`);

    const { rows } = await client.query<{ name: string }>('SELECT name FROM schema_migrations');
    const alreadyApplied = new Set(rows.map((r) => r.name));
    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();

    const applied: string[] = [];
    for (const file of files) {
      if (alreadyApplied.has(file)) continue;

      const sql = await readFile(path.join(MIGRATIONS_DIR, file), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
      }
      log(`applied ${file}`);
      applied.push(file);
    }
    return applied;
  } finally {
    await client.end(); // closing the session also releases the advisory lock
  }
}
