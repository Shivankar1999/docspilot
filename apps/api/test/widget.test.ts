import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../src/db/pool';
import { isAllowedOrigin } from '../src/lib/domains';
import { app, ask, resetDatabase, signUp, uploadAndIngest } from './helpers';

beforeEach(resetDatabase);

describe('isAllowedOrigin', () => {
  const allowed = ['shop.com', '*.acme.io', 'localhost:3000'];

  it.each([
    ['https://shop.com', true],
    ['http://shop.com', true],
    ['https://www.shop.com', false], // exact entry: no subdomains
    ['https://shop.com:8443', false], // non-default port needs an explicit entry
    ['https://app.acme.io', true],
    ['https://a.b.acme.io', true],
    ['https://acme.io', false], // wildcard covers subdomains only
    ['https://evilacme.io', false],
    ['http://localhost:3000', true],
    ['http://localhost:3001', false],
    ['not a url', false],
    ['', false],
  ])('%s → %s', (origin, expected) => {
    expect(isAllowedOrigin(origin, allowed)).toBe(expected);
  });

  it('allows nothing when the list is empty', () => {
    expect(isAllowedOrigin('https://shop.com', [])).toBe(false);
  });
});

/** A tenant with a public key, one allowed domain and an ingested document. */
async function widgetTenant() {
  const { agent, tenantId } = await signUp('Shop');
  await agent.patch('/api/tenant').send({ allowedDomains: ['shop.example.com'] }).expect(200);
  await uploadAndIngest(agent, tenantId, 'Refunds are processed within 5 business days.');
  const publicKey: string = (await agent.get('/api/auth/me')).body.tenant.publicKey;
  return { agent, tenantId, publicKey };
}

const widgetHeaders = (publicKey: string, origin: string) => ({ 'X-Widget-Key': publicKey, 'X-Widget-Origin': origin });

describe('GET /api/widget/config', () => {
  it('returns the tenant name and allowed domains for a valid public key', async () => {
    const { publicKey } = await widgetTenant();
    const res = await request(app).get('/api/widget/config').query({ key: publicKey }).expect(200);
    expect(res.body).toEqual({ name: 'Shop', allowedDomains: ['shop.example.com'] });
  });

  it('returns 404 for an unknown key', async () => {
    await request(app).get('/api/widget/config').query({ key: 'pk_nope' }).expect(404);
  });
});

describe('widget chat (public key)', () => {
  it('answers from an allowed domain and records the conversation as "widget"', async () => {
    const { publicKey } = await widgetTenant();

    const chat = await ask(request.agent(app), 'How long do refunds take?', {
      headers: widgetHeaders(publicKey, 'https://shop.example.com'),
    });

    expect(chat.status).toBe(200);
    expect(chat.answer).toContain('Refunds are processed within 5 business days');
    const { rows } = await pool.query('SELECT source FROM conversations');
    expect(rows[0].source).toBe('widget');
  });

  it('rejects other websites (403) and unknown keys (401)', async () => {
    const { publicKey } = await widgetTenant();
    const anon = request.agent(app);

    const evil = await ask(anon, 'hi', { headers: widgetHeaders(publicKey, 'https://evil.example.net') });
    expect(evil.status).toBe(403);
    expect(evil.json.error.code).toBe('DOMAIN_NOT_ALLOWED');

    const noOrigin = await ask(anon, 'hi', { headers: { 'X-Widget-Key': publicKey } });
    expect(noOrigin.status).toBe(403);

    const badKey = await ask(anon, 'hi', { headers: widgetHeaders('pk_forged', 'https://shop.example.com') });
    expect(badKey.status).toBe(401);
  });

  it('is off until the tenant allows at least one domain', async () => {
    const { agent } = await signUp('Fresh');
    const publicKey = (await agent.get('/api/auth/me')).body.tenant.publicKey;

    const chat = await ask(request.agent(app), 'hi', { headers: widgetHeaders(publicKey, 'https://anywhere.com') });
    expect(chat.status).toBe(403);
  });

  it('can only chat: a public key never grants access to documents', async () => {
    const { publicKey } = await widgetTenant();
    await request(app)
      .get('/api/documents')
      .set(widgetHeaders(publicKey, 'https://shop.example.com'))
      .expect(401);
  });
});
