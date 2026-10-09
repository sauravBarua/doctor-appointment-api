import type { Request, Response } from 'express';
import httpStatus from 'http-status';
import { getValidated } from '../../middleware/validate.js';
import { sendResponse } from '../../utils/sendResponse.js';
import { AuditAction } from '../audit/audit.actions.js';
import { recordAudit } from '../audit/audit.service.js';
import type { BookBody, CancelBody, ListQuery } from './appointments.schema.js';
import * as service from './appointments.service.js';

type IdParams = { id: string };

// requireAuth guarantees req.user.
const actorOf = (req: Request) => ({ id: req.user!.id, role: req.user!.role });

export async function book(req: Request, res: Response) {
  const { body } = getValidated<BookBody>(res);
  const data = await service.bookAppointment(req.user!.id, body);
  await recordAudit({
    req,
    action: AuditAction.APPOINTMENT_BOOKED,
    entityType: 'Appointment',
    entityId: data.id,
    metadata: { doctorId: body.doctorId, startTime: data.startTime },
  });
  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: 'Appointment booked',
    data,
  });
}

export async function cancel(req: Request, res: Response) {
  const { body, params } = getValidated<CancelBody, unknown, IdParams>(res);
  const data = await service.cancelAppointment(actorOf(req), params.id, body.reason);
  await recordAudit({
    req,
    action: AuditAction.APPOINTMENT_CANCELLED,
    entityType: 'Appointment',
    entityId: params.id,
    metadata: { reason: body.reason ?? null },
  });
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Appointment cancelled',
    data,
  });
}

export async function list(req: Request, res: Response) {
  const { query } = getValidated<unknown, ListQuery>(res);
  const { items, total } = await service.listAppointments(actorOf(req), query);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Appointments',
    meta: { page: query.page, pageSize: query.pageSize, total },
    data: items,
  });
}

export async function getOne(req: Request, res: Response) {
  const { params } = getValidated<unknown, unknown, IdParams>(res);
  const data = await service.getAppointment(actorOf(req), params.id);
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Appointment', data });
}
