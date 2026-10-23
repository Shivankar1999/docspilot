import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../src/db/pool';
import { getIngestQueue } from '../src/jobs/ingest';
import { MockEmbeddingProvider } from '../src/providers/mock';
import { ingestDocument } from '../src/services/ingestion';
import { readStoredFile } from '../src/services/storage';
import { app, resetDatabase, signUp } from './helpers';

beforeEach(async () => {
  await resetDatabase();
  await getIngestQueue().obliterate({ force: true });
});

async function storagePathOf(documentId: string): Promise<string> {
  const { rows } = await pool.query('SELECT storage_path FROM documents WHERE id = $1', [documentId]);
  return rows[0].storage_path;
}

async function docsVersion(tenantId: string): Promise<number> {
  const { rows } = await pool.query('SELECT docs_version FROM tenants WHERE id = $1', [tenantId]);
  return rows[0].docs_version;
}

describe('POST /api/documents', () => {
  it('saves the file, creates a pending document and enqueues exactly one job', async () => {
    const { agent, tenantId } = await signUp('Acme');
    const res = await agent
      .post('/api/documents')
      .attach('file', Buffer.from('Our refund window is 30 days.'), 'policy.txt');

    expect(res.status).toBe(202);
    expect(res.body.document).toMatchObject({
      filename: 'policy.txt',
      mimeType: 'text/plain',
      status: 'pending',
      sizeBytes: 29,
    });

    const id = res.body.document.id;
    expect((await readStoredFile(await storagePathOf(id))).toString()).toBe(
      'Our refund window is 30 days.',
    );
    const job = await getIngestQueue().getJob(id);
    expect(job?.data).toEqual({ documentId: id, tenantId });
    expect(await getIngestQueue().count()).toBe(1);
  });

  it('accepts uploads authenticated with a secret API key', async () => {
    const { agent } = await signUp('Acme');
    const key = (await agent.post('/api/tenant/secret-key')).body.secretKey;

    await request(app)
      .post('/api/documents')
      .set('Authorization', `Bearer ${key}`)
      .attach('file', Buffer.from('# Guide'), 'guide.md')
      .expect(202);
  });

  it('keeps non-ASCII filenames intact', async () => {
    const { agent } = await signUp('Acme');
    const res = await agent
      .post('/api/documents')
      .attach('file', Buffer.from('bonjour'), 'résumé-été.txt')
      .expect(202);
    expect(res.body.document.filename).toBe('résumé-été.txt');
  });

  it('rejects unsupported types and files pretending to be PDFs (415)', async () => {
    const { agent } = await signUp('Acme');
    const exe = await agent.post('/api/documents').attach('file', Buffer.from('MZ'), 'app.exe');
    const fakePdf = await agent
      .post('/api/documents')
      .attach('file', Buffer.from('just text'), 'fake.pdf');

    expect(exe.status).toBe(415);
    expect(fakePdf.status).toBe(415);
    expect(fakePdf.body.error.message).toMatch(/not a valid PDF/);
  });

  it('rejects empty files and requests without a file (400)', async () => {
    const { agent } = await signUp('Acme');
    const empty = await agent.post('/api/documents').attach('file', Buffer.alloc(0), 'empty.txt');
    const missing = await agent.post('/api/documents').field('note', 'no file here');

    expect(empty.body.error.code).toBe('EMPTY_FILE');
    expect(missing.body.error.code).toBe('NO_FILE');
  });

  it('rejects files over 10 MB (413)', async () => {
    const { agent } = await signUp('Acme');
    const res = await agent
      .post('/api/documents')
      .attach('file', Buffer.alloc(10 * 1024 * 1024 + 1, 'a'), 'huge.txt');

    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('FILE_TOO_LARGE');
  });

  it('requires authentication', async () => {
    await request(app)
      .post('/api/documents')
      .attach('file', Buffer.from('x'), 'a.txt')
      .expect(401);
  });
});

describe('DELETE /api/documents/:id', () => {
  it('removes the document, its chunks and its file, and bumps the docs version', async () => {
    const { agent, tenantId } = await signUp('Acme');
    const id = (
      await agent.post('/api/documents').attach('file', Buffer.from('Some content.'), 'a.txt')
    ).body.document.id;
    await ingestDocument(
      { documentId: id, tenantId },
      { embedder: new MockEmbeddingProvider(), attempt: 1, maxAttempts: 3 },
    );
    const storagePath = await storagePathOf(id);
    const versionBefore = await docsVersion(tenantId);

    await agent.delete(`/api/documents/${id}`).expect(204);

    expect((await agent.get('/api/documents')).body.documents).toEqual([]);
    const chunks = await pool.query('SELECT 1 FROM chunks WHERE document_id = $1', [id]);
    expect(chunks.rowCount).toBe(0);
    await expect(readStoredFile(storagePath)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await docsVersion(tenantId)).toBe(versionBefore + 1);
  });

  it("returns 404 for another tenant's document", async () => {
    const owner = await signUp('Alpha');
    const intruder = await signUp('Bravo');
    const id = (
      await owner.agent.post('/api/documents').attach('file', Buffer.from('x'), 'a.txt')
    ).body.document.id;

    await intruder.agent.delete(`/api/documents/${id}`).expect(404);
    expect((await owner.agent.get('/api/documents')).body.documents).toHaveLength(1);
  });

  it('validates the id', async () => {
    const { agent } = await signUp('Acme');
    const res = await agent.delete('/api/documents/not-a-uuid');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});
