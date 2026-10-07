import type { Request, Response } from 'express';
import httpStatus from 'http-status';
import { sendResponse } from '../../utils/sendResponse.js';
import { getHealth } from './health.service.js';

export async function healthCheck(_req: Request, res: Response) {
  const data = await getHealth();
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'OK', data });
}
