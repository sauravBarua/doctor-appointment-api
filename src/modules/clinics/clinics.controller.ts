import type { Request, Response } from 'express';
import httpStatus from 'http-status';
import { assertHasChanges } from '../../middleware/upload.js';
import { getValidated } from '../../middleware/validate.js';
import { sendResponse } from '../../utils/sendResponse.js';
import type { IdParams } from '../../utils/schemas.js';
import { AuditAction } from '../audit/audit.actions.js';
import { recordAudit } from '../audit/audit.service.js';
import type {
  AdminListQuery,
  CreateClinicBody,
  PublicListQuery,
  UpdateClinicBody,
} from './clinics.schema.js';
import * as service from './clinics.service.js';

export async function listPublic(_req: Request, res: Response) {
  const { query } = getValidated<unknown, PublicListQuery>(res);
  const { items, total } = await service.listClinics({ ...query, isActive: true });
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Clinics',
    meta: { page: query.page, pageSize: query.pageSize, total },
    data: items,
  });
}

export async function getPublic(_req: Request, res: Response) {
  const { params } = getValidated<unknown, unknown, IdParams>(res);
  const data = await service.getClinic(params.id, true);
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Clinic', data });
}

export async function listAdmin(_req: Request, res: Response) {
  const { query } = getValidated<unknown, AdminListQuery>(res);
  const { items, total } = await service.listClinics(query);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Clinics',
    meta: { page: query.page, pageSize: query.pageSize, total },
    data: items,
  });
}

export async function getAdmin(_req: Request, res: Response) {
  const { params } = getValidated<unknown, unknown, IdParams>(res);
  const data = await service.getClinic(params.id);
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Clinic', data });
}

export async function create(req: Request, res: Response) {
  const { body } = getValidated<CreateClinicBody>(res);
  const data = await service.createClinic(body, req.file);
  await recordAudit({
    req,
    action: AuditAction.CLINIC_CREATED,
    entityType: 'Clinic',
    entityId: data.id,
    metadata: { name: data.name, hasImage: Boolean(req.file) },
  });
  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: 'Clinic created',
    data,
  });
}

export async function update(req: Request, res: Response) {
  const { body, params } = getValidated<UpdateClinicBody, unknown, IdParams>(res);
  assertHasChanges(body, req.file);
  const data = await service.updateClinic(params.id, body, req.file);
  await recordAudit({
    req,
    action: AuditAction.CLINIC_UPDATED,
    entityType: 'Clinic',
    entityId: params.id,
    metadata: { fields: [...Object.keys(body), ...(req.file ? ['image'] : [])] },
  });
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Clinic updated', data });
}

export async function remove(req: Request, res: Response) {
  const { params } = getValidated<unknown, unknown, IdParams>(res);
  await service.deleteClinic(params.id);
  await recordAudit({
    req,
    action: AuditAction.CLINIC_DELETED,
    entityType: 'Clinic',
    entityId: params.id,
  });
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Clinic deleted' });
}
