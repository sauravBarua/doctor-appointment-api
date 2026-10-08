import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { prisma } from '../src/config/prisma.js';
import { app } from '../src/app.js';
import { AuditAction } from '../src/modules/audit/audit.actions.js';
import { recordAudit } from '../src/modules/audit/audit.service.js';

describe('audit', () => {
  it('redacts secrets in metadata', async () => {
    await recordAudit({
      action: AuditAction.AUTH_LOGIN_FAILED,
      metadata: { email: 'x@test.local', password: 'hunter2', nested: { otp: '123456' } },
    });
    const row = await prisma.auditLog.findFirst({ orderBy: { createdAt: 'desc' } });
    const json = JSON.stringify(row?.metadata);
    expect(json).toContain('x@test.local');
    expect(json).not.toContain('hunter2');
    expect(json).not.toContain('123456');
  });

  it('never throws when the write fails', async () => {
    await expect(
      recordAudit({ action: AuditAction.AUTH_LOGOUT, actorId: 'does-not-exist' }),
    ).resolves.toBeUndefined();
  });

  it('records a failed login without the password', async () => {
    const email = `nobody-${Date.now()}@test.local`;
    await request(app)
      .post('/api/v1/auth/login')
      .send({ email, password: 'Wrong#Pass123' })
      .expect(401);
    const row = await prisma.auditLog.findFirst({
      where: { action: AuditAction.AUTH_LOGIN_FAILED },
      orderBy: { createdAt: 'desc' },
    });
    expect(JSON.stringify(row?.metadata)).toContain(email);
    expect(JSON.stringify(row?.metadata)).not.toContain('Wrong#Pass123');
  });

  it('protects the endpoint', async () => {
    await request(app).get('/api/v1/admin/audit-logs').expect(401);
  });
});
