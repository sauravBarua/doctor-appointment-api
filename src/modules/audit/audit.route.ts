import { Router } from 'express';
import { Role } from '../../generated/prisma/client.js';
import { requireAuth } from '../../middleware/requireAuth.js';
import { requireRole } from '../../middleware/requireRole.js';
import { validate } from '../../middleware/validate.js';
import * as controller from './audit.controller.js';
import { listAuditLogsQuery } from './audit.schema.js';

export const auditRouter: Router = Router();

auditRouter.get(
  '/',
  requireAuth,
  requireRole(Role.ADMIN),
  validate({ query: listAuditLogsQuery }),
  controller.listAuditLogs,
);
