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
  CreateSpecialtyBody,
  PublicListQuery,
  UpdateSpecialtyBody,
} from './specialties.schema.js';
import * as service from './specialties.service.js';

export async function listPublic(_req: Request, res: Response) {
  const { query } = getValidated<unknown, PublicListQuery>(res);
  const { items, total } = await service.listSpecialties({ ...query, isActive: true });
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Specialties',
    meta: { page: query.page, pageSize: query.pageSize, total },
    data: items,
  });
}

export async function getPublic(_req: Request, res: Response) {
  const { params } = getValidated<unknown, unknown, IdParams>(res);
  const data = await service.getSpecialty(params.id, true);
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Specialty', data });
}

export async function listAdmin(_req: Request, res: Response) {
  const { query } = getValidated<unknown, AdminListQuery>(res);
  const { items, total } = await service.listSpecialties(query);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Specialties',
    meta: { page: query.page, pageSize: query.pageSize, total },
    data: items,
  });
}

export async function getAdmin(_req: Request, res: Response) {
  const { params } = getValidated<unknown, unknown, IdParams>(res);
  const data = await service.getSpecialty(params.id);
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Specialty', data });
}

export async function create(req: Request, res: Response) {
  const { body } = getValidated<CreateSpecialtyBody>(res);
  const data = await service.createSpecialty(body, req.file);
  await recordAudit({
    req,
    action: AuditAction.SPECIALTY_CREATED,
    entityType: 'Specialty',
    entityId: data.id,
    metadata: { name: data.name, hasImage: Boolean(req.file) },
  });
  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: 'Specialty created',
    data,
  });
}

export async function update(req: Request, res: Response) {
  const { body, params } = getValidated<UpdateSpecialtyBody, unknown, IdParams>(res);
  assertHasChanges(body, req.file);
  const data = await service.updateSpecialty(params.id, body, req.file);
  await recordAudit({
    req,
    action: AuditAction.SPECIALTY_UPDATED,
    entityType: 'Specialty',
    entityId: params.id,
    metadata: { fields: [...Object.keys(body), ...(req.file ? ['image'] : [])] },
  });
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Specialty updated',
    data,
  });
}

export async function remove(req: Request, res: Response) {
  const { params } = getValidated<unknown, unknown, IdParams>(res);
  await service.deleteSpecialty(params.id);
  await recordAudit({
    req,
    action: AuditAction.SPECIALTY_DELETED,
    entityType: 'Specialty',
    entityId: params.id,
  });
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Specialty deleted' });
}
