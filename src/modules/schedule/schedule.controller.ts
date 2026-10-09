import type { Request, Response } from 'express';
import httpStatus from 'http-status';
import { getValidated } from '../../middleware/validate.js';
import { sendResponse } from '../../utils/sendResponse.js';
import { AuditAction } from '../audit/audit.actions.js';
import { recordAudit } from '../audit/audit.service.js';
import type {
  CreateRuleBody,
  CreateTimeOffBody,
  ListTimeOffQuery,
  UpdateRuleBody,
} from './schedule.schema.js';
import * as service from './schedule.service.js';

type IdParams = { id: string };

// requireAuth guarantees req.user.
const doctorOf = (req: Request) => service.getDoctorContext(req.user!.id);

export async function listRules(req: Request, res: Response) {
  const doctor = await doctorOf(req);
  const data = await service.listRules(doctor.id, doctor.timezone);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Availability rules',
    data,
  });
}

export async function createRule(req: Request, res: Response) {
  const { body } = getValidated<CreateRuleBody>(res);
  const doctor = await doctorOf(req);
  const data = await service.createRule(doctor.id, body);
  await recordAudit({
    req,
    action: AuditAction.AVAILABILITY_RULE_CREATED,
    entityType: 'AvailabilityRule',
    entityId: data.id,
    metadata: body,
  });
  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: 'Availability rule created',
    data,
  });
}

export async function updateRule(req: Request, res: Response) {
  const { body, params } = getValidated<UpdateRuleBody, unknown, IdParams>(res);
  const doctor = await doctorOf(req);
  const data = await service.updateRule(doctor.id, params.id, body);
  await recordAudit({
    req,
    action: AuditAction.AVAILABILITY_RULE_UPDATED,
    entityType: 'AvailabilityRule',
    entityId: params.id,
    metadata: body,
  });
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Availability rule updated',
    data,
  });
}

export async function deleteRule(req: Request, res: Response) {
  const { params } = getValidated<unknown, unknown, IdParams>(res);
  const doctor = await doctorOf(req);
  await service.deleteRule(doctor.id, params.id);
  await recordAudit({
    req,
    action: AuditAction.AVAILABILITY_RULE_DELETED,
    entityType: 'AvailabilityRule',
    entityId: params.id,
  });
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Availability rule deleted',
  });
}

export async function createTimeOff(req: Request, res: Response) {
  const { body } = getValidated<CreateTimeOffBody>(res);
  const doctor = await doctorOf(req);
  const data = await service.createTimeOff(doctor.id, body);
  await recordAudit({
    req,
    action: AuditAction.TIME_OFF_CREATED,
    entityType: 'TimeOff',
    entityId: data.id,
    metadata: { startTime: body.startTime, endTime: body.endTime },
  });
  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: 'Time off created',
    data,
  });
}

export async function listTimeOff(req: Request, res: Response) {
  const { query } = getValidated<unknown, ListTimeOffQuery>(res);
  const doctor = await doctorOf(req);
  const { items, total } = await service.listTimeOff(doctor.id, query);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Time off',
    meta: { page: query.page, pageSize: query.pageSize, total },
    data: items,
  });
}

export async function deleteTimeOff(req: Request, res: Response) {
  const { params } = getValidated<unknown, unknown, IdParams>(res);
  const doctor = await doctorOf(req);
  await service.deleteTimeOff(doctor.id, params.id);
  await recordAudit({
    req,
    action: AuditAction.TIME_OFF_DELETED,
    entityType: 'TimeOff',
    entityId: params.id,
  });
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Time off deleted' });
}
