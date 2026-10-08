import type { RequestHandler } from 'express';
import httpStatus from 'http-status';
import { AppError } from '../utils/AppError.js';
import { ErrorCode } from '../utils/errorCodes.js';
import type { Role } from '../utils/roles.js';

export function requireRole(...roles: Role[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.user) {
      next(
        new AppError(httpStatus.UNAUTHORIZED, ErrorCode.UNAUTHORIZED, 'Authentication required'),
      );
      return;
    }
    if (!roles.includes(req.user.role)) {
      next(new AppError(httpStatus.FORBIDDEN, ErrorCode.FORBIDDEN, 'Insufficient permissions'));
      return;
    }
    next();
  };
}
