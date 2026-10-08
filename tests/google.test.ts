import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { app } from '../src/app.js';
import { prisma } from '../src/config/prisma.js';
import { redis } from '../src/config/redis.js';
import { auth } from '../src/lib/auth.js';
import { completeGoogleAuth, createHandoffCode } from '../src/modules/auth/google.service.js';
import { createVerifiedUser } from './helpers/users.js';

const base = '/api/v1/auth/google';
const run = randomUUID().slice(0, 8);
const password = 'Str0ngPassw0rd';
const emails = {
  normal: `g-normal-${run}@example.com`,
  gated: `g-gated-${run}@example.com`,
  disabled: `g-disabled-${run}@example.com`,
  exchange: `g-exchange-${run}@example.com`,
};

async function sessionFor(email: string) {
  const { token } = await auth.api.signInEmail({ body: { email, password } });
  return { token, headers: new Headers({ authorization: `Bearer ${token}` }) };
}

beforeAll(async () => {
  await createVerifiedUser({ email: emails.normal, password });
  await createVerifiedUser({
    email: emails.gated,
    password,
    role: 'DOCTOR',
    mustChangePassword: true,
  });
  await createVerifiedUser({ email: emails.disabled, password, isActive: false });
  await createVerifiedUser({ email: emails.exchange, password });
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: { in: Object.values(emails) } } });
  await prisma.$disconnect();
  await redis.quit();
});

describe('entry points', () => {
  it.each(['', '/signup'])('GET %s redirects to Google', async (suffix) => {
    const res = await request(app).get(`${base}${suffix}`);
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('accounts.google.com');
  });

  it('allows the Google callback through the raw handler but nothing else', async () => {
    const callback = await request(app).get('/api/auth/callback/google');
    expect(callback.status).not.toBe(404);

    const blocked = await request(app).post('/api/auth/sign-in/social').send({});
    expect(blocked.status).toBe(404);
    expect(blocked.body.error.code).toBe('NOT_FOUND');
  });
});

describe('error page', () => {
  it.each([
    ['signup_disabled', 'ACCOUNT_NOT_FOUND'],
    ['account_not_linked', 'ACCOUNT_NOT_LINKED'],
    ['access_denied', 'GOOGLE_AUTH_FAILED'],
    [undefined, 'GOOGLE_AUTH_FAILED'],
  ])('maps %s to %s', async (error, code) => {
    const res = await request(app)
      .get(`${base}/error`)
      .query(error ? { error } : {});
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ success: false, meta: null, data: null });
    expect(res.body.error.code).toBe(code);
  });
});

describe('success page', () => {
  it('returns 401 without a session', async () => {
    const res = await request(app).get(`${base}/success`);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('issues tokens for a normal user', async () => {
    const { headers } = await sessionFor(emails.normal);
    const result = await completeGoogleAuth(headers);
    expect(result.user.email).toBe(emails.normal);
    expect(result.accessToken).toEqual(expect.any(String));
    expect(result.isNewUser).toBe(true); // created seconds ago
  });

  it('blocks a user who still has a temporary password and revokes the session', async () => {
    const { token, headers } = await sessionFor(emails.gated);
    await expect(completeGoogleAuth(headers)).rejects.toMatchObject({
      code: 'PASSWORD_CHANGE_REQUIRED',
    });
    expect(await prisma.session.count({ where: { token } })).toBe(0);
  });

  it('blocks a disabled account and revokes the session', async () => {
    const { token, headers } = await sessionFor(emails.disabled);
    await expect(completeGoogleAuth(headers)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await prisma.session.count({ where: { token } })).toBe(0);
  });
});

describe('POST /exchange', () => {
  it('trades a one-time code for tokens exactly once', async () => {
    const { token } = await sessionFor(emails.exchange);
    const code = await createHandoffCode(token);

    const first = await request(app).post(`${base}/exchange`).send({ code });
    expect(first.status).toBe(200);
    expect(first.body.data.user.email).toBe(emails.exchange);
    expect(first.body.data.accessToken).toEqual(expect.any(String));

    const second = await request(app).post(`${base}/exchange`).send({ code });
    expect(second.status).toBe(400);
    expect(second.body.error.code).toBe('INVALID_GOOGLE_CODE');
  });

  it('rejects a code that was never issued', async () => {
    const res = await request(app)
      .post(`${base}/exchange`)
      .send({ code: 'A'.repeat(43) });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_GOOGLE_CODE');
  });

  it('rejects a malformed code', async () => {
    const res = await request(app).post(`${base}/exchange`).send({ code: 'short' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});
