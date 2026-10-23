import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { app, resetDatabase, signUp } from './helpers';

beforeEach(resetDatabase);

describe('secret API keys', () => {
  it('is shown once and then authenticates API calls', async () => {
    const { agent } = await signUp('Acme');
    const created = await agent.post('/api/tenant/secret-key').expect(201);
    const secretKey: string = created.body.secretKey;

    expect(secretKey).toMatch(/^sk_/);
    const me = await agent.get('/api/auth/me');
    expect(me.body.tenant.hasSecretKey).toBe(true);
    expect(JSON.stringify(me.body)).not.toContain(secretKey); // never returned again

    await request(app)
      .get('/api/documents')
      .set('Authorization', `Bearer ${secretKey}`)
      .expect(200);
  });

  it('rotating invalidates the previous key', async () => {
    const { agent } = await signUp('Acme');
    const oldKey = (await agent.post('/api/tenant/secret-key')).body.secretKey;
    const newKey = (await agent.post('/api/tenant/secret-key')).body.secretKey;

    await request(app).get('/api/documents').set('Authorization', `Bearer ${oldKey}`).expect(401);
    await request(app).get('/api/documents').set('Authorization', `Bearer ${newKey}`).expect(200);
  });

  it('cannot be used to manage keys or settings (dashboard only)', async () => {
    const { agent } = await signUp('Acme');
    const secretKey = (await agent.post('/api/tenant/secret-key')).body.secretKey;

    await request(app)
      .post('/api/tenant/secret-key')
      .set('Authorization', `Bearer ${secretKey}`)
      .expect(401);
  });
});

describe('allowed widget domains', () => {
  it('normalizes and de-duplicates domains', async () => {
    const { agent } = await signUp('Acme');
    const res = await agent
      .patch('/api/tenant')
      .send({ allowedDomains: [' Example.com ', 'example.com', '*.acme.io', 'localhost:3000'] })
      .expect(200);

    expect(res.body.tenant.allowedDomains).toEqual(['example.com', '*.acme.io', 'localhost:3000']);
  });

  it('rejects values that are not hostnames', async () => {
    const { agent } = await signUp('Acme');
    const res = await agent
      .patch('/api/tenant')
      .send({ allowedDomains: ['https://example.com/path'] });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});
