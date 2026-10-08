import { z } from 'zod';
import { AuditAction, type AuditActionValue } from './audit.actions.js';

const actions = Object.values(AuditAction) as [AuditActionValue, ...AuditActionValue[]];

export const listAuditLogsQuery = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    actorId: z.string().min(1).max(64).optional(),
    action: z.enum(actions).optional(),
    entityType: z.string().min(1).max(50).optional(),
    entityId: z.string().min(1).max(64).optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
  })
  .refine((q) => !q.from || !q.to || q.from <= q.to, {
    message: '`from` must not be after `to`',
    path: ['from'],
  });

export type ListAuditLogsQuery = z.infer<typeof listAuditLogsQuery>;
