import type { Request, Response } from 'express';
import httpStatus from 'http-status';
import { getValidated } from '../../middleware/validate.js';
import { sendResponse } from '../../utils/sendResponse.js';
import type { ListAuditLogsQuery } from './audit.schema.js';
import * as auditService from './audit.service.js';

export async function listAuditLogs(_req: Request, res: Response) {
  const { query } = getValidated<unknown, ListAuditLogsQuery>(res);
  const { items, total } = await auditService.listAuditLogs(query);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Audit logs',
    meta: { page: query.page, pageSize: query.pageSize, total },
    data: items,
  });
}
