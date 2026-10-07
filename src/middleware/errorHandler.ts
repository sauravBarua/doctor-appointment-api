import type { ErrorRequestHandler } from 'express';
import httpStatus from 'http-status';
import { AppError } from '../utils/AppError.js';
import { ErrorCode } from '../utils/errorCodes.js';
import { sendResponse } from '../utils/sendResponse.js';

function getStatus(err: unknown): number | undefined {
  if (typeof err !== 'object' || err === null) return undefined;
  const status = (err as { status?: unknown }).status;
  return typeof status === 'number' ? status : undefined;
}

export const errorHandler: ErrorRequestHandler = (err, req, res, next) => {
  if (res.headersSent) {
    next(err);
    return;
  }

  if (err instanceof AppError) {
    sendResponse(res, {
      statusCode: err.statusCode,
      success: false,
      message: err.message,
      error: { code: err.code, details: err.details },
    });
    return;
  }

  // Errors raised by express.json(): malformed JSON (400) and oversized bodies (413).
  const status = getStatus(err);
  if (status === httpStatus.REQUEST_ENTITY_TOO_LARGE) {
    sendResponse(res, {
      statusCode: status,
      success: false,
      message: 'Request body too large',
      error: { code: ErrorCode.PAYLOAD_TOO_LARGE },
    });
    return;
  }
  if (status === httpStatus.BAD_REQUEST) {
    sendResponse(res, {
      statusCode: status,
      success: false,
      message: 'Malformed JSON body',
      error: { code: ErrorCode.VALIDATION_ERROR },
    });
    return;
  }

  req.log.error({ err }, 'Unhandled error');
  sendResponse(res, {
    statusCode: httpStatus.INTERNAL_SERVER_ERROR,
    success: false,
    message: 'Internal server error',
    error: { code: ErrorCode.INTERNAL_ERROR },
  });
};
