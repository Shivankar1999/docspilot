import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { pool, withTenant } from '../src/db/pool';
import { app, insertDocument, resetDatabase, signUp } from './helpers';

// Two tenants with one document each. Every test checks that A can't reach B's data.
let a: Awaited<ReturnType<typeof signUp>>;
let b: Awaited<ReturnType<typeof signUp>>;
let docA: string;
let docB: string;

beforeEach(async () => {
  await resetDatabase();
  a = await signUp('Alpha');
  b = await signUp('Bravo');
  docA = await insertDocument(a.tenantId, 'alpha-handbook.txt');
  docB = await insertDocument(b.tenantId, 'bravo-secrets.txt');
});

describe('tenant isolation over HTTP', () => {
  it('a dashboard session lists only its own documents', async () => {
    const res = await a.agent.get('/api/documents').expect(200);
    expect(res.body.documents.map((d: { id: string }) => d.id)).toEqual([docA]);
  });

  it('a secret API key lists only its own tenant documents', async () => {
    const keyB = (await b.agent.post('/api/tenant/secret-key')).body.secretKey;
    const res = await request(app)
      .get('/api/documents')
      .set('Authorization', `Bearer ${keyB}`)
      .expect(200);
    expect(res.body.documents.map((d: { id: string }) => d.id)).toEqual([docB]);
  });

  it('rejects missing or invalid credentials', async () => {
    await request(app).get('/api/documents').expect(401);
    await request(app)
      .get('/api/documents')
      .set('Authorization', 'Bearer sk_not-a-real-key')
      .expect(401);
  });
});

// These go straight to Postgres, proving isolation holds even if app code
// forgets a WHERE clause: the database itself refuses.
describe('row-level security in Postgres', () => {
  it('SELECT without a WHERE clause returns only the current tenant rows', async () => {
    const ids = await withTenant(a.tenantId, async (db) => {
      const { rows } = await db.query<{ id: string }>('SELECT id FROM documents');
      return rows.map((r) => r.id);
    });
    expect(ids).toEqual([docA]);
  });

  it("cannot update or delete another tenant's rows", async () => {
    const [updated, deleted] = await withTenant(a.tenantId, async (db) => [
      (await db.query("UPDATE documents SET filename = 'pwned' WHERE id = $1", [docB])).rowCount,
      (await db.query('DELETE FROM documents WHERE id = $1', [docB])).rowCount,
    ]);
    expect(updated).toBe(0);
    expect(deleted).toBe(0);

    const { rows } = await pool.query('SELECT filename FROM documents WHERE id = $1', [docB]);
    expect(rows[0].filename).toBe('bravo-secrets.txt');
  });

  it('cannot insert rows that belong to another tenant', async () => {
    // Acting as A, try to plant a document in B's account.
    const attempt = withTenant(a.tenantId, (db) =>
      db.query(
        `INSERT INTO documents (tenant_id, filename, mime_type, size_bytes, storage_path)
         VALUES ($1, 'planted.txt', 'text/plain', 1, 'x')`,
        [b.tenantId],
      ),
    );
    await expect(attempt).rejects.toMatchObject({ code: '42501' }); // RLS violation
  });

  it("cannot read another tenant's row in the tenants table", async () => {
    const names = await withTenant(a.tenantId, async (db) => {
      const { rows } = await db.query<{ name: string }>('SELECT name FROM tenants');
      return rows.map((r) => r.name);
    });
    expect(names).toEqual(['Alpha']);
  });

  it('cannot raise its own plan limits (column-level privilege)', async () => {
    const attempt = withTenant(a.tenantId, (db) =>
      db.query('UPDATE tenants SET monthly_message_limit = 1000000 WHERE id = $1', [a.tenantId]),
    );
    await expect(attempt).rejects.toMatchObject({ code: '42501' }); // permission denied
  });

  it('fails closed: the restricted role sees nothing when no tenant is set', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE docspilot_tenant');
      const { rows } = await client.query('SELECT id FROM documents');
      expect(rows).toHaveLength(0);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });
});
