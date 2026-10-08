import { randomBytes } from 'node:crypto';
import httpStatus from 'http-status';
import { API_PREFIX, GOOGLE_HANDOFF_TTL_SECONDS } from '../../config/constants.js';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { prisma } from '../../config/prisma.js';
import { redis } from '../../config/redis.js';
import { auth } from '../../lib/auth.js';
import { AppError } from '../../utils/AppError.js';
import { ErrorCode } from '../../utils/errorCodes.js';
import { bearerHeaders, callAuth, issueAccessToken, publicUserSelect } from './auth.service.js';

const callbackBase = `${env.BETTER_AUTH_URL}${API_PREFIX}/auth/google`;

const googleCodeKey = (code: string) => `google:code:${code}`;

export async function startGoogleAuth(headers: Headers, mode: 'signin' | 'signup') {
  const response = await auth.api.signInSocial({
    body: {
      provider: 'google',
      callbackURL: `${callbackBase}/success`,
      errorCallbackURL: `${callbackBase}/error`,
      ...(mode === 'signup' ? { requestSignUp: true } : {}),
    },
    headers,
    asResponse: true,
  });

  if (!response.ok) {
    logger.warn(
      { status: response.status, detail: await response.text() },
      'Could not start Google sign-in',
    );
    throw new AppError(
      httpStatus.BAD_REQUEST,
      ErrorCode.GOOGLE_AUTH_FAILED,
      'Could not start Google sign-in',
    );
  }

  const { url } = (await response.json()) as { url?: string };
  if (!url) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      ErrorCode.GOOGLE_AUTH_FAILED,
      'Could not start Google sign-in',
    );
  }
  // The OAuth state cookie must reach the browser, or the callback fails with a state mismatch.
  return { url, cookies: response.headers.getSetCookie() };
}

/** Runs after Google redirects back: checks the new session and issues our access token. */
export async function completeGoogleAuth(headers: Headers) {
  const session = await callAuth(() => auth.api.getSession({ headers }));
  if (!session) {
    throw new AppError(
      httpStatus.UNAUTHORIZED,
      ErrorCode.UNAUTHORIZED,
      'No Google session. Start again at /api/v1/auth/google',
    );
  }

  const sessionToken = session.session.token;
  const revoke = () => prisma.session.deleteMany({ where: { token: sessionToken } });

  const record = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { ...publicUserSelect, isActive: true },
  });
  if (!record) {
    await revoke();
    throw new AppError(httpStatus.FORBIDDEN, ErrorCode.FORBIDDEN, 'Account is disabled');
  }

  const { isActive, ...user } = record;
  if (!isActive) {
    await revoke();
    throw new AppError(httpStatus.FORBIDDEN, ErrorCode.FORBIDDEN, 'Account is disabled');
  }
  if (user.mustChangePassword) {
    await revoke();
    throw new AppError(
      httpStatus.FORBIDDEN,
      ErrorCode.PASSWORD_CHANGE_REQUIRED,
      'Sign in with your temporary password and change it before using Google',
    );
  }

  return {
    user,
    sessionToken,
    accessToken: await issueAccessToken(sessionToken),
    isNewUser: Date.now() - user.createdAt.getTime() < 60_000,
  };
}

/** One-time code for the production redirect: no tokens ever appear in a URL. */
export async function createHandoffCode(sessionToken: string): Promise<string> {
  const code = randomBytes(32).toString('base64url');
  await redis.set(googleCodeKey(code), sessionToken, 'EX', GOOGLE_HANDOFF_TTL_SECONDS);
  return code;
}

export async function exchangeGoogleCode(code: string) {
  const invalid = () =>
    new AppError(httpStatus.BAD_REQUEST, ErrorCode.INVALID_GOOGLE_CODE, 'Invalid or expired code');

  const sessionToken = await redis.getdel(googleCodeKey(code)); // single use
  if (!sessionToken) throw invalid();

  const session = await callAuth(() =>
    auth.api.getSession({ headers: bearerHeaders(sessionToken) }),
  );
  if (!session) throw invalid();

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: publicUserSelect,
  });
  if (!user) throw invalid();

  return {
    accessToken: await issueAccessToken(sessionToken),
    sessionToken,
    mustChangePassword: user.mustChangePassword,
    user,
  };
}

export function mapGoogleError(raw?: string) {
  const reason = raw?.toLowerCase().replace(/[\s-]+/g, '_');
  const safeReason = reason && /^[a-z_]{1,50}$/.test(reason) ? reason : undefined;

  switch (reason) {
    case 'signup_disabled':
      return {
        code: ErrorCode.ACCOUNT_NOT_FOUND,
        message: 'No account found for this Google profile. Sign up with Google first',
        reason: safeReason,
      };
    case 'account_not_linked':
      return {
        code: ErrorCode.ACCOUNT_NOT_LINKED,
        message:
          'An account with this email already exists and could not be linked. If you registered with a password, verify your email with the code we sent, then try again',
        reason: safeReason,
      };
    default:
      return {
        code: ErrorCode.GOOGLE_AUTH_FAILED,
        message: 'Google sign-in failed',
        reason: safeReason,
      };
  }
}
