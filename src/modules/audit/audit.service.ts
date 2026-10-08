import type { Request } from 'express';
import { logger } from '../../config/logger.js';
import { prisma } from '../../config/prisma.js';
import type { Prisma, Role } from '../../generated/prisma/client.js';
import { AppError } from '../../utils/AppError.js';
import type { AuditActionValue } from './audit.actions.js';
import type { ListAuditLogsQuery } from './audit.schema.js';

const SENSITIVE_KEY = /pass|token|otp|secret|authorization|cookie/i;

function redact(value: unknown, depth = 0): unknown {
  if (depth > 4) return '[truncated]';
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [
        k,
        SENSITIVE_KEY.test(k) ? '[redacted]' : redact(v, depth + 1),
      ]),
    );
  }
  return value;
}

export interface RecordAuditInput {
  action: AuditActionValue;
  req?: Request;
  actorId?: string | null;
  actorRole?: Role | null;
  entityType?: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
}

/** Never throws: a failed audit write is logged and swallowed. */
export async function recordAudit(input: RecordAuditInput): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        action: input.action,
        actorId: input.actorId ?? input.req?.user?.id ?? null,
        actorRole: input.actorRole ?? input.req?.user?.role ?? null,
        entityType: input.entityType ?? null,
        entityId: input.entityId ?? null,
        ip: input.req?.ip ?? null,
        userAgent: input.req?.get('user-agent')?.slice(0, 255) ?? null,
        ...(input.metadata ? { metadata: redact(input.metadata) as Prisma.InputJsonObject } : {}),
      },
    });
  } catch (err) {
    logger.error({ err, action: input.action }, 'Failed to write audit log');
  }
}

/** Runs fn; when it throws an AppError, records a failure audit row and rethrows. */
export async function withFailureAudit<T>(
  req: Request,
  action: AuditActionValue,
  metadata: Record<string, unknown>,
  fn: () => Promise<T>,
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof AppError) {
      await recordAudit({ req, action, metadata: { ...metadata, errorCode: err.code } });
    }
    throw err;
  }
}

export async function listAuditLogs(q: ListAuditLogsQuery) {
  const where: Prisma.AuditLogWhereInput = {
    ...(q.actorId ? { actorId: q.actorId } : {}),
    ...(q.action ? { action: q.action } : {}),
    ...(q.entityType ? { entityType: q.entityType } : {}),
    ...(q.entityId ? { entityId: q.entityId } : {}),
    ...(q.from || q.to
      ? { createdAt: { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lte: q.to } : {}) } }
      : {}),
  };

  const [total, items] = await prisma.$transaction([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
      include: { actor: { select: { id: true, email: true, name: true } } },
    }),
  ]);

  return { items, total };
}
