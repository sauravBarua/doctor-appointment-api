import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/mailer.js', () => ({
  sendOtpEmail: async () => undefined,
  sendEmail: async () => undefined,
}));
vi.mock('../src/lib/cloudinary.js', () => ({
  uploadImageToCloudinary: async (_buffer: Buffer, opts: { publicId: string }) =>
    `https://res.cloudinary.test/${opts.publicId}.png`,
}));

import { app } from '../src/app.js';
import { prisma } from '../src/config/prisma.js';
import { redis } from '../src/config/redis.js';
import { loginAs } from './helpers/auth.js';
import { createVerifiedUser } from './helpers/users.js';

const url = '/api/v1/users/me';
const email = `profile-${randomUUID().slice(0, 8)}@example.com`;
let token = '';

const as = () => ({ Authorization: `Bearer ${token}` });
const png = { filename: 'me.png', contentType: 'image/png' };

beforeAll(async () => {
  const { user, password } = await createVerifiedUser({ email });
  token = (await loginAs(user.email, password)).accessToken;
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email } });
  await prisma.$disconnect();
  await redis.quit();
});

describe('PATCH /users/me', () => {
  it('updates the name via form-data', async () => {
    const res = await request(app)
      .patch(url)
      .set(as())
      .field('data', JSON.stringify({ name: 'Profile Test' }));
    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('Profile Test');
  });

  it('updates the image', async () => {
    const res = await request(app)
      .patch(url)
      .set(as())
      .field('data', '{}')
      .attach('image', Buffer.from('fake'), png);
    expect(res.status).toBe(200);
    expect(res.body.data.image).toContain('user-');
  });

  it('ignores an email change', async () => {
    const res = await request(app)
      .patch(url)
      .set(as())
      .field('data', JSON.stringify({ name: 'Profile Test', email: 'hacker@example.com' }));
    expect(res.status).toBe(200);
    expect(res.body.data.email).toBe(email);
  });

  it('rejects a bio for a non-doctor', async () => {
    const res = await request(app)
      .patch(url)
      .set(as())
      .field('data', JSON.stringify({ bio: 'hi' }));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects an empty update and invalid JSON', async () => {
    const empty = await request(app).patch(url).set(as()).field('data', '{}');
    expect(empty.status).toBe(400);
    const bad = await request(app).patch(url).set(as()).field('data', 'nope');
    expect(bad.status).toBe(400);
  });

  it('requires a token', async () => {
    const res = await request(app)
      .patch(url)
      .field('data', JSON.stringify({ name: 'Nobody' }));
    expect(res.status).toBe(401);
  });
});
