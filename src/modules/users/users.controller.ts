import type { Request, Response } from 'express';
import httpStatus from 'http-status';
import { assertHasChanges } from '../../middleware/upload.js';
import { getValidated } from '../../middleware/validate.js';
import { AppError } from '../../utils/AppError.js';
import { ErrorCode } from '../../utils/errorCodes.js';
import { sendResponse } from '../../utils/sendResponse.js';
import { AuditAction } from '../audit/audit.actions.js';
import { recordAudit } from '../audit/audit.service.js';
import type { UpdateProfileBody } from './users.schema.js';
import * as service from './users.service.js';

export async function updateMe(req: Request, res: Response) {
  if (!req.user) {
    throw new AppError(httpStatus.UNAUTHORIZED, ErrorCode.UNAUTHORIZED, 'Authentication required');
  }
  const { body } = getValidated<UpdateProfileBody>(res);
  assertHasChanges(body, req.file);
  const data = await service.updateMyProfile(req.user.id, req.user.role, body, req.file);
  await recordAudit({
    req,
    action: AuditAction.PROFILE_UPDATED,
    entityType: 'User',
    entityId: req.user.id,
    metadata: { fields: [...Object.keys(body), ...(req.file ? ['image'] : [])] },
  });
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Profile updated', data });
}
