import type { Request, RequestHandler } from 'express';
import httpStatus from 'http-status';
import { errors } from 'jose';
import { z } from 'zod';
import { verifyAccessToken } from '../lib/jwt.js';
import { AppError } from '../utils/AppError.js';
import { ErrorCode } from '../utils/errorCodes.js';

function extractBearer(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;
  const token = header.slice(7).trim();
  return token.length > 0 ? token : null;
}

async function authenticate(req: Request, allowPasswordChange: boolean): Promise<void> {
  const token = extractBearer(req);
  if (!token) {
    throw new AppError(httpStatus.UNAUTHORIZED, ErrorCode.UNAUTHORIZED, 'Authentication required');
  }

  let claims;
  try {
    claims = await verifyAccessToken(token);
  } catch (err) {
    if (err instanceof errors.JOSEError || err instanceof z.ZodError) {
      req.log.warn(
        {
          reason: err instanceof errors.JOSEError ? err.code : 'INVALID_CLAIMS',
          detail: err.message,
        },
        'Access token rejected',
      );
      throw new AppError(
        httpStatus.UNAUTHORIZED,
        ErrorCode.UNAUTHORIZED,
        'Invalid or expired token',
      );
    }
    throw err;
  }

  if (claims.mustChangePassword && !allowPasswordChange) {
    throw new AppError(
      httpStatus.FORBIDDEN,
      ErrorCode.PASSWORD_CHANGE_REQUIRED,
      'You must change your password before continuing',
    );
  }

  req.user = { id: claims.sub, role: claims.role, mustChangePassword: claims.mustChangePassword };
}

/** Default guard: rejects users who still have to change their temporary password. */
export const requireAuth: RequestHandler = async (req, _res, next) => {
  await authenticate(req, false);
  next();
};

/** Only for GET /auth/me, POST /auth/change-password and POST /auth/logout. */
export const requireAuthAllowingPasswordChange: RequestHandler = async (req, _res, next) => {
  await authenticate(req, true);
  next();
};
