import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { OPS } from '../src/docs/openapi.js';
import { frontendOrigin } from '../src/config/cors.js';

describe('docs, helmet, CORS', () => {
  it('serves a valid OpenAPI document', async () => {
    const res = await request(app).get('/api/openapi.json');
    expect(res.status).toBe(200);
    expect(res.body.openapi).toMatch(/^3\.1/);
    expect(Object.keys(res.body.paths).length).toBeGreaterThan(30);
  });

  it('serves Swagger UI', async () => {
    const res = await request(app).get('/api/docs/');
    expect(res.status).toBe(200);
    expect(res.text).toContain('swagger-ui');
  });

  it('sets security headers on API responses', async () => {
    const res = await request(app).get('/api/v1/health');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toBeDefined();
  });

  it('answers preflight for the frontend origin only', async () => {
    const ok = await request(app)
      .options('/api/v1/appointments')
      .set('Origin', frontendOrigin)
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'authorization,content-type');
    expect(ok.status).toBe(204);
    expect(ok.headers['access-control-allow-origin']).toBe(frontendOrigin);
    expect(ok.headers['access-control-allow-credentials']).toBe('true');

    const evil = await request(app)
      .options('/api/v1/appointments')
      .set('Origin', 'https://evil.example')
      .set('Access-Control-Request-Method', 'POST');
    expect(evil.headers['access-control-allow-origin']).not.toBe('https://evil.example');
  });

  // Drift guard: every documented secured operation must exist and enforce auth.
  it('every documented secured route answers 401 without a token', async () => {
    const secured = OPS.filter((o) => o.roles);
    expect(secured.length).toBeGreaterThan(30);
    const id = '00000000-0000-4000-8000-000000000000';
    for (const op of secured) {
      const path = '/api/v1' + op.p.replace(/\{\w+\}/g, id);
      const res = await request(app)[op.m](path);
      expect(res.status, `${op.m.toUpperCase()} ${path}`).toBe(401);
    }
  });
});
