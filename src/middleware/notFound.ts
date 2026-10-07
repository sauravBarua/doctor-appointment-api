import type { RequestHandler } from 'express';
import httpStatus from 'http-status';
import { ErrorCode } from '../utils/errorCodes.js';
import { sendResponse } from '../utils/sendResponse.js';

export const notFound: RequestHandler = (req, res) => {
  sendResponse(res, {
    statusCode: httpStatus.NOT_FOUND,
    success: false,
    message: `Route ${req.method} ${req.originalUrl} not found`,
    error: { code: ErrorCode.NOT_FOUND },
  });
};
