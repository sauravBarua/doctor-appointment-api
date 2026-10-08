import type { Request, Response } from 'express';
import httpStatus from 'http-status';
import { getValidated } from '../../middleware/validate.js';
import { AppError } from '../../utils/AppError.js';
import { ErrorCode } from '../../utils/errorCodes.js';
import { sendResponse } from '../../utils/sendResponse.js';
import type {
  ChangePasswordBody,
  LoginBody,
  LogoutBody,
  RefreshBody,
  RegisterBody,
  ResendOtpBody,
  VerifyEmailBody,
} from './auth.schema.js';
import * as authService from './auth.service.js';

function currentUserId(req: Request): string {
  if (!req.user) {
    throw new AppError(httpStatus.UNAUTHORIZED, ErrorCode.UNAUTHORIZED, 'Authentication required');
  }
  return req.user.id;
}

export async function register(_req: Request, res: Response) {
  const { body } = getValidated<RegisterBody>(res);
  await authService.register(body);
  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: 'Account created. Check your email for the verification code',
  });
}

export async function verifyEmail(_req: Request, res: Response) {
  const { body } = getValidated<VerifyEmailBody>(res);
  await authService.verifyEmail(body);
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Email verified' });
}

export async function resendOtp(_req: Request, res: Response) {
  const { body } = getValidated<ResendOtpBody>(res);
  await authService.resendOtp(body);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'If the account exists and is not verified, a new code was sent',
  });
}

export async function login(_req: Request, res: Response) {
  const { body } = getValidated<LoginBody>(res);
  const data = await authService.login(body);
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Signed in', data });
}

export async function refresh(_req: Request, res: Response) {
  const { body } = getValidated<RefreshBody>(res);
  const data = await authService.refresh(body.sessionToken);
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Token refreshed', data });
}

export async function changePassword(req: Request, res: Response) {
  const { body } = getValidated<ChangePasswordBody>(res);
  const data = await authService.changePassword(currentUserId(req), body);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Password changed',
    data,
  });
}

export async function logout(req: Request, res: Response) {
  const { body } = getValidated<LogoutBody>(res);
  await authService.logout(currentUserId(req), body.sessionToken);
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Signed out' });
}

export async function me(req: Request, res: Response) {
  const data = await authService.me(currentUserId(req));
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Current user', data });
}
