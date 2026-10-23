import { SignJWT } from 'jose';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { app, PASSWORD, resetDatabase, signUp } from './helpers';

beforeEach(resetDatabase);

describe('signup', () => {
  it('creates a tenant + user and starts a secure session', async () => {
    const res = await request(app)
      .post('/api/auth/signup')
      .send({ companyName: 'Acme', email: 'Owner@Acme.test', password: PASSWORD });

    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ email: 'owner@acme.test' }); // normalized
    const cookie = res.headers['set-cookie']?.[0] ?? '';
    expect(cookie).toMatch(/^dp_session=/);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);
  });

  it('gives each tenant a public widget key and no secret key yet', async () => {
    const { agent } = await signUp('Acme');
    const me = await agent.get('/api/auth/me').expect(200);

    expect(me.body.tenant.name).toBe('Acme');
    expect(me.body.tenant.publicKey).toMatch(/^pk_/);
    expect(me.body.tenant.hasSecretKey).toBe(false);
    expect(me.body.tenant).not.toHaveProperty('secretKeyHash');
  });

  it('rejects a duplicate email with 409', async () => {
    const { email } = await signUp('Acme');
    const res = await request(app)
      .post('/api/auth/signup')
      .send({ companyName: 'Other', email, password: PASSWORD });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('EMAIL_TAKEN');
  });

  it('validates input', async () => {
    const res = await request(app)
      .post('/api/auth/signup')
      .send({ companyName: '', email: 'not-an-email', password: 'short' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    const fields = res.body.error.details.map((d: { path: string[] }) => d.path[0]);
    expect(fields).toEqual(expect.arrayContaining(['companyName', 'email', 'password']));
  });
});

describe('login and logout', () => {
  it('logs in with the right password (email is case-insensitive)', async () => {
    const { email } = await signUp('Acme');
    const agent = request.agent(app);

    await agent
      .post('/api/auth/login')
      .send({ email: email.toUpperCase(), password: PASSWORD })
      .expect(200);
    await agent.get('/api/auth/me').expect(200);
  });

  it('gives the same error for a wrong password and an unknown email', async () => {
    const { email } = await signUp('Acme');
    const wrongPassword = await request(app)
      .post('/api/auth/login')
      .send({ email, password: 'wrong-password' });
    const unknownEmail = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nobody@acme.test', password: PASSWORD });

    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(wrongPassword.body).toEqual(unknownEmail.body);
  });

  it('logout clears the session cookie', async () => {
    const { agent } = await signUp('Acme');
    await agent.post('/api/auth/logout').expect(204);
    await agent.get('/api/auth/me').expect(401);
  });
});

describe('session tokens', () => {
  it('requires a session for /me', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('rejects a token forged with a different secret', async () => {
    const { tenantId } = await signUp('Victim');
    const forged = await new SignJWT({ tid: tenantId })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('00000000-0000-0000-0000-000000000000')
      .setExpirationTime('1h')
      .sign(new TextEncoder().encode('attacker-guessed-secret-of-32-characters!'));

    await request(app).get('/api/auth/me').set('Cookie', `dp_session=${forged}`).expect(401);
  });
});
