import type { Request, Response } from 'express';
import httpStatus from 'http-status';
import { assertHasChanges } from '../../middleware/upload.js';
import { getValidated } from '../../middleware/validate.js';
import { sendResponse } from '../../utils/sendResponse.js';
import type { IdParams } from '../../utils/schemas.js';
import { AuditAction } from '../audit/audit.actions.js';
import { recordAudit } from '../audit/audit.service.js';
import type { AdminListQuery, CreateDoctorBody, UpdateDoctorBody } from './doctors.schema.js';
import * as service from './doctors.service.js';

export async function create(req: Request, res: Response) {
  const { body } = getValidated<CreateDoctorBody>(res);
  const data = await service.createDoctor(body, req.file);
  await recordAudit({
    req,
    action: AuditAction.DOCTOR_CREATED,
    entityType: 'Doctor',
    entityId: data.doctor.id,
    metadata: {
      email: data.doctor.user.email,
      credentialsEmailed: data.credentialsEmailed,
      hasImage: Boolean(req.file),
    },
  });
  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: 'Doctor created',
    data,
  });
}

export async function list(_req: Request, res: Response) {
  const { query } = getValidated<unknown, AdminListQuery>(res);
  const { items, total } = await service.listDoctors(query);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Doctors',
    meta: { page: query.page, pageSize: query.pageSize, total },
    data: items,
  });
}

export async function get(_req: Request, res: Response) {
  const { params } = getValidated<unknown, unknown, IdParams>(res);
  const data = await service.getDoctor(params.id);
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Doctor', data });
}

export async function update(req: Request, res: Response) {
  const { body, params } = getValidated<UpdateDoctorBody, unknown, IdParams>(res);
  assertHasChanges(body, req.file);
  const data = await service.updateDoctor(params.id, body, req.file);
  await recordAudit({
    req,
    action: AuditAction.DOCTOR_UPDATED,
    entityType: 'Doctor',
    entityId: params.id,
    metadata: { fields: [...Object.keys(body), ...(req.file ? ['image'] : [])] },
  });
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Doctor updated', data });
}
