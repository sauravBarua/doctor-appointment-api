import { fromNodeHeaders } from 'better-auth/node';
import type { Request, Response } from 'express';
import httpStatus from 'http-status';
import { env } from '../../config/env.js';
import { getValidated } from '../../middleware/validate.js';
import { AppError } from '../../utils/AppError.js';
import { sendResponse } from '../../utils/sendResponse.js';
import type { GoogleErrorQuery, GoogleExchangeBody } from './google.schema.js';
import * as google from './google.service.js';

// Redirect to the frontend everywhere except automated tests, which assert on the JSON.
const redirectToFrontend = env.NODE_ENV !== 'test';

const frontendErrorUrl = (code: string) =>
  `${env.FRONTEND_URL}/auth/error?code=${encodeURIComponent(code)}`;

async function start(req: Request, res: Response, mode: 'signin' | 'signup') {
  const { url, cookies } = await google.startGoogleAuth(fromNodeHeaders(req.headers), mode);
  for (const cookie of cookies) res.append('Set-Cookie', cookie);
  res.redirect(url);
}

export const googleSignIn = (req: Request, res: Response) => start(req, res, 'signin');
export const googleSignUp = (req: Request, res: Response) => start(req, res, 'signup');

export async function googleSuccess(req: Request, res: Response) {
  try {
    const result = await google.completeGoogleAuth(fromNodeHeaders(req.headers));

    if (redirectToFrontend) {
      const code = await google.createHandoffCode(result.sessionToken);
      res.redirect(`${env.FRONTEND_URL}/auth/callback?code=${encodeURIComponent(code)}`);
      return;
    }

    sendResponse(res, {
      statusCode: httpStatus.OK,
      success: true,
      message: result.isNewUser ? 'Signed up with Google' : 'Signed in with Google',
      data: {
        user: result.user,
        accessToken: result.accessToken,
        sessionToken: result.sessionToken,
        isNewUser: result.isNewUser,
      },
    });
  } catch (err) {
    if (redirectToFrontend && err instanceof AppError) {
      res.redirect(frontendErrorUrl(err.code));
      return;
    }
    throw err;
  }
}

export function googleError(_req: Request, res: Response) {
  const { query } = getValidated<unknown, GoogleErrorQuery>(res);
  const mapped = google.mapGoogleError(query.error);

  if (redirectToFrontend) {
    res.redirect(frontendErrorUrl(mapped.code));
    return;
  }

  sendResponse(res, {
    statusCode: httpStatus.BAD_REQUEST,
    success: false,
    message: mapped.message,
    error: { code: mapped.code, details: mapped.reason ? { reason: mapped.reason } : undefined },
  });
}

export async function googleExchange(_req: Request, res: Response) {
  const { body } = getValidated<GoogleExchangeBody>(res);
  const data = await google.exchangeGoogleCode(body.code);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Signed in with Google',
    data,
  });
}
