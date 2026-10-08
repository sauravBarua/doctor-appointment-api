import { randomUUID } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { afterAll, describe, expect, it, vi } from 'vitest';

const mailbox = vi.hoisted(() => ({ otps: new Map<string, string>() }));

vi.mock('../src/lib/mailer.js', () => ({
  sendOtpEmail: async (to: string, otp: string) => {
    mailbox.otps.set(to, otp);
  },
  sendEmail: async () => undefined,
}));

import { app } from '../src/app.js';
import { prisma } from '../src/config/prisma.js';
import { redis } from '../src/config/redis.js';
import { hashPassword } from '../src/lib/password.js';
import { errorHandler } from '../src/middleware/errorHandler.js';
import { requireAuth } from '../src/middleware/requireAuth.js';
import { DEMO_PASSWORD, loginAs } from './helpers/auth.js';

const base = '/api/v1/auth';
const run = randomUUID().slice(0, 8);
const email = `test-${run}@example.com`;
const gateEmail = `gate-${run}@example.com`;
const expiredEmail = `expired-${run}@example.com`;
const password = 'Str0ngPassw0rd';
const tempPassword = 'Temp0rary-Pass1';

async function createDoctorUser(userEmail: string, expiresAt: Date) {
  const id = randomUUID();
  await prisma.user.create({
    data: {
      id,
      name: 'Temp Doctor',
      email: userEmail,
      emailVerified: true,
      role: 'DOCTOR',
      mustChangePassword: true,
      tempPasswordExpiresAt: expiresAt,
      accounts: {
        create: {
          id: randomUUID(),
          accountId: id,
          providerId: 'credential',
          password: await hashPassword(tempPassword),
        },
      },
    },
  });
}

afterAll(async () => {
  const emails = [email, gateEmail, expiredEmail];
  await prisma.user.deleteMany({ where: { email: { in: emails } } });
  await prisma.verification.deleteMany({ where: { identifier: { contains: `-${run}@` } } });
  await redis.del(`otp:cooldown:${email}`);
  await prisma.$disconnect();
  await redis.quit();
});

describe('registration and login', () => {
  let accessToken = '';

  it('registers and sends an OTP', async () => {
    const res = await request(app)
      .post(`${base}/register`)
      .send({ name: 'Test User', email, password });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ success: true, meta: null, data: null });
    expect(mailbox.otps.get(email)).toMatch(/^\d{6}$/);
  });

  it('blocks login until the email is verified', async () => {
    const res = await request(app).post(`${base}/login`).send({ email, password });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('EMAIL_NOT_VERIFIED');
  });

  it('rejects a wrong OTP', async () => {
    const real = mailbox.otps.get(email);
    const wrong = real === '000000' ? '111111' : '000000';
    const res = await request(app).post(`${base}/verify-email`).send({ email, otp: wrong });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_OTP');
  });

  it('verifies the email and logs in', async () => {
    const verify = await request(app)
      .post(`${base}/verify-email`)
      .send({ email, otp: mailbox.otps.get(email) });
    expect(verify.status).toBe(200);

    const login = await request(app).post(`${base}/login`).send({ email, password });
    expect(login.status).toBe(200);
    expect(login.body.data.mustChangePassword).toBe(false);
    accessToken = login.body.data.accessToken;
  });

  it('serves /auth/me with a valid token and rejects a missing one', async () => {
    const ok = await request(app).get(`${base}/me`).set('Authorization', `Bearer ${accessToken}`);
    expect(ok.status).toBe(200);
    expect(ok.body.data.email).toBe(email);

    const missing = await request(app).get(`${base}/me`);
    expect(missing.status).toBe(401);
    expect(missing.body.error.code).toBe('UNAUTHORIZED');
  });

  it('rejects wrong credentials with a generic error', async () => {
    const res = await request(app).post(`${base}/login`).send({ email, password: 'Wr0ngPassword' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });
});

describe('seeded users', () => {
  it('logs in the seeded patient through the helper and calls /auth/me', async () => {
    const { accessToken } = await loginAs('patient@demo.local', DEMO_PASSWORD);
    const res = await request(app).get(`${base}/me`).set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.role).toBe('PATIENT');
  });
});

describe('temporary password rules', () => {
  it('gates the user until the password is changed', async () => {
    await createDoctorUser(gateEmail, new Date(Date.now() + 60 * 60_000));

    const login = await request(app)
      .post(`${base}/login`)
      .send({ email: gateEmail, password: tempPassword });
    expect(login.status).toBe(200);
    expect(login.body.data.mustChangePassword).toBe(true);

    const probe = express();
    probe.get('/protected', requireAuth, (_req, res) => {
      res.json({ ok: true });
    });
    probe.use(errorHandler);

    const blocked = await request(probe)
      .get('/protected')
      .set('Authorization', `Bearer ${login.body.data.accessToken}`);
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');

    const changed = await request(app)
      .post(`${base}/change-password`)
      .set('Authorization', `Bearer ${login.body.data.accessToken}`)
      .send({
        currentPassword: tempPassword,
        newPassword: 'N3wStrongPass',
        sessionToken: login.body.data.sessionToken,
      });
    expect(changed.status).toBe(200);
    expect(changed.body.data.mustChangePassword).toBe(false);

    const allowed = await request(probe)
      .get('/protected')
      .set('Authorization', `Bearer ${changed.body.data.accessToken}`);
    expect(allowed.status).toBe(200);
  });

  it('refuses login once the temporary password has expired', async () => {
    await createDoctorUser(expiredEmail, new Date(Date.now() - 60_000));
    const res = await request(app)
      .post(`${base}/login`)
      .send({ email: expiredEmail, password: tempPassword });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('TEMP_PASSWORD_EXPIRED');
  });
});
