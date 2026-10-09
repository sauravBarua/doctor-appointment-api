import type { Request, Response } from 'express';
import httpStatus from 'http-status';
import { sendResponse } from '../../utils/sendResponse.js';
import * as service from './dashboard.service.js';

// requireAuth guarantees req.user.
export async function admin(_req: Request, res: Response) {
  const data = await service.getAdminDashboard();
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Admin dashboard', data });
}

export async function doctor(req: Request, res: Response) {
  const data = await service.getDoctorDashboard(req.user!.id);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Doctor dashboard',
    data,
  });
}

export async function patient(req: Request, res: Response) {
  const data = await service.getPatientDashboard(req.user!.id);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Patient dashboard',
    data,
  });
}
