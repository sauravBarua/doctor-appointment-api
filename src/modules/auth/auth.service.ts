import httpStatus from 'http-status';
import { OTP_RESEND_COOLDOWN_SECONDS } from '../../config/constants.js';
import { logger } from '../../config/logger.js';
import { prisma } from '../../config/prisma.js';
import { redis } from '../../config/redis.js';
import { auth } from '../../lib/auth.js';
import { hashPassword } from '../../lib/password.js';
import { AppError } from '../../utils/AppError.js';
import { ErrorCode } from '../../utils/errorCodes.js';
import type {
  ChangePasswordBody,
  LoginBody,
  RegisterBody,
  ResendOtpBody,
  VerifyEmailBody,
} from './auth.schema.js';

export const publicUserSelect = {
  id: true,
  name: true,
  email: true,
  image: true,
  role: true,
  emailVerified: true,
  mustChangePassword: true,
  createdAt: true,
} as const;

export function bearerHeaders(sessionToken: string): Headers {
  return new Headers({ authorization: `Bearer ${sessionToken}` });
}

function mapAuthError(err: unknown): unknown {
  if (typeof err !== 'object' || err === null) return err;
  const { statusCode, body } = err as { statusCode?: unknown; body?: { code?: unknown } };
  if (typeof statusCode !== 'number') return err;
  const code = typeof body?.code === 'string' ? body.code : '';

  if (code === 'INVALID_EMAIL_OR_PASSWORD') {
    return new AppError(
      httpStatus.UNAUTHORIZED,
      ErrorCode.INVALID_CREDENTIALS,
      'Invalid email or password',
    );
  }
  if (code === 'EMAIL_NOT_VERIFIED') {
    return new AppError(httpStatus.FORBIDDEN, ErrorCode.EMAIL_NOT_VERIFIED, 'Email not verified');
  }
  if (code.includes('OTP') || code === 'TOO_MANY_ATTEMPTS') {
    return new AppError(httpStatus.BAD_REQUEST, ErrorCode.INVALID_OTP, 'Invalid or expired code');
  }
  if (code === 'INVALID_PASSWORD') {
    return new AppError(
      httpStatus.BAD_REQUEST,
      ErrorCode.INVALID_CURRENT_PASSWORD,
      'Current password is incorrect',
    );
  }
  if (code.includes('ALREADY_EXISTS')) {
    return new AppError(
      httpStatus.CONFLICT,
      ErrorCode.EMAIL_ALREADY_REGISTERED,
      'Email already registered',
    );
  }
  if (statusCode === 401) {
    return new AppError(
      httpStatus.UNAUTHORIZED,
      ErrorCode.UNAUTHORIZED,
      'Invalid or expired session',
    );
  }
  return err;
}

export async function callAuth<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    throw mapAuthError(err);
  }
}

export async function issueAccessToken(sessionToken: string): Promise<string> {
  const { token } = await callAuth(() =>
    auth.api.getToken({ headers: bearerHeaders(sessionToken) }),
  );
  return token;
}

function otpCooldownKey(email: string): string {
  return `otp:cooldown:${email}`;
}

async function enforceOtpCooldown(email: string): Promise<void> {
  const ok = await redis.set(otpCooldownKey(email), '1', 'EX', OTP_RESEND_COOLDOWN_SECONDS, 'NX');
  if (ok !== 'OK') {
    throw new AppError(
      httpStatus.TOO_MANY_REQUESTS,
      ErrorCode.OTP_COOLDOWN,
      'Please wait before requesting another code',
    );
  }
}

async function markOtpSent(email: string): Promise<void> {
  try {
    await redis.set(otpCooldownKey(email), '1', 'EX', OTP_RESEND_COOLDOWN_SECONDS);
  } catch (err) {
    logger.warn(
      { error: err instanceof Error ? err.message : String(err) },
      'Could not set OTP cooldown',
    );
  }
}

export async function register(input: RegisterBody): Promise<void> {
  const existing = await prisma.user.findUnique({
    where: { email: input.email },
    select: { id: true, emailVerified: true },
  });

  if (existing?.emailVerified) {
    throw new AppError(
      httpStatus.CONFLICT,
      ErrorCode.EMAIL_ALREADY_REGISTERED,
      'Email already registered',
    );
  }

  if (existing) {
    await enforceOtpCooldown(input.email);
    // The latest registrant owns the password, so a pre-registration cannot hijack the account.
    const passwordHash = await hashPassword(input.password);
    await prisma.$transaction([
      prisma.user.update({ where: { id: existing.id }, data: { name: input.name } }),
      prisma.account.updateMany({
        where: { userId: existing.id, providerId: 'credential' },
        data: { password: passwordHash },
      }),
    ]);
    await callAuth(() =>
      auth.api.sendVerificationOTP({ body: { email: input.email, type: 'email-verification' } }),
    );
    return;
  }

  await callAuth(() => auth.api.signUpEmail({ body: input }));
  await markOtpSent(input.email);
}

export async function verifyEmail(input: VerifyEmailBody): Promise<void> {
  await callAuth(() => auth.api.verifyEmailOTP({ body: input }));
}

export async function resendOtp(input: ResendOtpBody): Promise<void> {
  // The cooldown applies to every email so the response never reveals whether an account exists.
  await enforceOtpCooldown(input.email);
  const user = await prisma.user.findUnique({
    where: { email: input.email },
    select: { emailVerified: true },
  });
  if (user && !user.emailVerified) {
    await callAuth(() =>
      auth.api.sendVerificationOTP({ body: { email: input.email, type: 'email-verification' } }),
    );
  }
}

export async function login(input: LoginBody) {
  const result = await callAuth(() => auth.api.signInEmail({ body: input }));
  const sessionToken = result.token;

  const user = await prisma.user.findUnique({
    where: { id: result.user.id },
    select: { ...publicUserSelect, isActive: true, tempPasswordExpiresAt: true },
  });

  if (!user || !user.isActive) {
    await prisma.session.deleteMany({ where: { token: sessionToken } });
    throw new AppError(
      httpStatus.UNAUTHORIZED,
      ErrorCode.INVALID_CREDENTIALS,
      'Invalid email or password',
    );
  }

  if (
    user.mustChangePassword &&
    user.tempPasswordExpiresAt &&
    user.tempPasswordExpiresAt < new Date()
  ) {
    await prisma.session.deleteMany({ where: { token: sessionToken } });
    throw new AppError(
      httpStatus.FORBIDDEN,
      ErrorCode.TEMP_PASSWORD_EXPIRED,
      'Temporary password expired. Ask an administrator to issue a new one',
    );
  }

  const accessToken = await issueAccessToken(sessionToken);
  return {
    accessToken,
    sessionToken,
    mustChangePassword: user.mustChangePassword,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      image: user.image,
      role: user.role,
      emailVerified: user.emailVerified,
      mustChangePassword: user.mustChangePassword,
      createdAt: user.createdAt,
    },
  };
}

export async function refresh(sessionToken: string) {
  const session = await callAuth(() =>
    auth.api.getSession({ headers: bearerHeaders(sessionToken) }),
  );
  if (!session) {
    throw new AppError(
      httpStatus.UNAUTHORIZED,
      ErrorCode.UNAUTHORIZED,
      'Invalid or expired session',
    );
  }
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { isActive: true, mustChangePassword: true },
  });
  if (!user?.isActive) {
    throw new AppError(
      httpStatus.UNAUTHORIZED,
      ErrorCode.UNAUTHORIZED,
      'Invalid or expired session',
    );
  }
  return {
    accessToken: await issueAccessToken(sessionToken),
    mustChangePassword: user.mustChangePassword,
  };
}

export async function changePassword(userId: string, input: ChangePasswordBody) {
  const session = await callAuth(() =>
    auth.api.getSession({ headers: bearerHeaders(input.sessionToken) }),
  );
  if (!session || session.user.id !== userId) {
    throw new AppError(
      httpStatus.UNAUTHORIZED,
      ErrorCode.UNAUTHORIZED,
      'Invalid or expired session',
    );
  }

  const result = await callAuth(() =>
    auth.api.changePassword({
      body: {
        currentPassword: input.currentPassword,
        newPassword: input.newPassword,
        revokeOtherSessions: true,
      },
      headers: bearerHeaders(input.sessionToken),
    }),
  );

  // Revoking other sessions may rotate the current one; use the new token when Better Auth returns it.
  const rotated = (result as { token?: unknown }).token;
  const sessionToken = typeof rotated === 'string' ? rotated : input.sessionToken;

  await prisma.user.update({
    where: { id: userId },
    data: { mustChangePassword: false, tempPasswordExpiresAt: null },
  });

  return {
    accessToken: await issueAccessToken(sessionToken),
    sessionToken,
    mustChangePassword: false,
  };
}

export async function logout(userId: string, sessionToken: string): Promise<void> {
  await prisma.session.deleteMany({ where: { token: sessionToken, userId } });
}

export async function me(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: publicUserSelect });
  if (!user) {
    throw new AppError(httpStatus.UNAUTHORIZED, ErrorCode.UNAUTHORIZED, 'Account not found');
  }
  return user;
}
