import { randomUUID } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { afterAll, expect, it } from 'vitest';
import { redis } from '../src/config/redis.js';
import { createLimiter } from '../src/middleware/rateLimiters.js';
import { sendResponse } from '../src/utils/sendResponse.js';

afterAll(async () => {
  await redis.quit();
});

it('returns 429 in the envelope after the limit is exceeded', async () => {
  const app = express();
  app.use(
    createLimiter({
      name: `test-${randomUUID()}`,
      windowMs: 60_000,
      limit: 3,
      enforceInTest: true,
    }),
  );
  app.get('/ping', (_req, res) => {
    sendResponse(res, { statusCode: 200, success: true, message: 'pong' });
  });

  for (let i = 0; i < 3; i++) {
    expect((await request(app).get('/ping')).status).toBe(200);
  }

  const blocked = await request(app).get('/ping');
  expect(blocked.status).toBe(429);
  expect(blocked.body).toMatchObject({
    success: false,
    meta: null,
    data: null,
    error: { code: 'RATE_LIMITED' },
  });
  expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
});
