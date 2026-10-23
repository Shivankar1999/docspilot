import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createIngestWorker, getFailedDocuments, getIngestQueue, ingestInline } from '../src/jobs/ingest';
import { MockEmbeddingProvider } from '../src/providers/mock';
import { ask, resetDatabase, signUp, uploadAndIngest, waitFor } from './helpers';

// ADMIN_EMAILS=admin@platform.test in vitest.config.mts

let worker: ReturnType<typeof createIngestWorker> | undefined;
beforeEach(resetDatabase);
afterEach(async () => {
  await worker?.close();
  worker = undefined;
});

class BrokenEmbedder extends MockEmbeddingProvider {
  override async embed(): Promise<never> {
    throw new Error('Voyage API error 503: overloaded');
  }
}

describe('admin overview', () => {
  it('is forbidden for regular tenant users', async () => {
    const { agent } = await signUp('Acme');
    const res = await agent.get('/api/admin/overview');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');

    const me = await agent.get('/api/auth/me');
    expect(me.body.user.isAdmin).toBe(false);
  });

  it('shows cross-tenant totals, queue counts and recent failed jobs', async () => {
    const admin = await signUp('Platform', 'admin@platform.test');
    const acme = await signUp('Acme');
    await uploadAndIngest(acme.agent, acme.tenantId, 'Refunds take 5 days.', 'refunds.txt');
    await ask(acme.agent, 'How long do refunds take?');

    // A job that fails for good: one attempt, and an embedder that always errors.
    const upload = await acme.agent.post('/api/documents').attach('file', Buffer.from('Some text.'), 'broken.txt');
    const documentId = upload.body.document.id;
    const queue = getIngestQueue();
    await queue.obliterate({ force: true }); // drop the jobs the uploads queued
    const job = await queue.add('ingest', { documentId, tenantId: acme.tenantId }, { jobId: documentId, attempts: 1 });
    worker = createIngestWorker(new BrokenEmbedder());
    await waitFor(async () => (await job.getState()) === 'failed');

    const me = await admin.agent.get('/api/auth/me');
    expect(me.body.user.isAdmin).toBe(true);
    const res = await admin.agent.get('/api/admin/overview').expect(200);

    expect(res.body.tenants).toBe(2);
    expect(res.body.documents).toMatchObject({ ready: 1, failed: 1 });
    expect(res.body.last30Days).toMatchObject({ messages: 1 });
    expect(res.body.topTenants[0]).toMatchObject({ name: 'Acme', messages: 1 });
    expect(res.body.queue.failed).toBe(1);
    expect(res.body.failedJobs[0]).toMatchObject({
      documentId,
      filename: 'broken.txt',
      tenantName: 'Acme',
      reason: 'Voyage API error 503: overloaded',
      attempts: 1,
    });
  });

  it('lists failed documents as the failed jobs when ingestion runs inline (no queue)', async () => {
    const acme = await signUp('Acme');
    const upload = await acme.agent.post('/api/documents').attach('file', Buffer.from('Some text.'), 'broken.txt');
    const documentId = upload.body.document.id;
    await ingestInline({ documentId, tenantId: acme.tenantId }, { embedder: new BrokenEmbedder(), backoffMs: 1 });

    expect(await getFailedDocuments(10)).toMatchObject([
      { documentId, tenantId: acme.tenantId, reason: 'Voyage API error 503: overloaded', attempts: null },
    ]);
  });
});
