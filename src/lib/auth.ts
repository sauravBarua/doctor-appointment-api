import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { bearer, emailOTP, jwt } from 'better-auth/plugins';
import { prisma } from '../config/prisma.js';
import {
  ACCESS_TOKEN_TTL,
  OTP_LENGTH,
  OTP_MAX_ATTEMPTS,
  OTP_TTL_SECONDS,
  SESSION_TTL_SECONDS,
  SESSION_UPDATE_AGE_SECONDS,
} from '../config/constants.js';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { sendOtpEmail } from './mailer.js';
import { hashPassword, verifyPassword } from './password.js';

export const auth = betterAuth({
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,
  trustedOrigins: [env.FRONTEND_URL],
  database: prismaAdapter(prisma, { provider: 'postgresql' }),
  rateLimit: { enabled: false }, // our Redis limiters own rate limiting
  session: {
    expiresIn: SESSION_TTL_SECONDS,
    updateAge: SESSION_UPDATE_AGE_SECONDS,
    freshAge: 0,
  },
  user: {
    additionalFields: {
      role: { type: 'string', required: false, input: false, defaultValue: 'PATIENT' },
      mustChangePassword: { type: 'boolean', required: false, input: false, defaultValue: false },
      tempPasswordExpiresAt: { type: 'date', required: false, input: false },
    },
  },
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    autoSignIn: false,
    minPasswordLength: 8,
    maxPasswordLength: 72,
    password: {
      hash: hashPassword,
      verify: ({ hash, password }) => verifyPassword(password, hash),
    },
  },
  plugins: [
    bearer(),
    jwt({
      jwt: {
        issuer: env.BETTER_AUTH_URL,
        audience: env.BETTER_AUTH_URL,
        expirationTime: ACCESS_TOKEN_TTL,
        definePayload: ({ user }) => {
          const u = user as { role?: string; mustChangePassword?: boolean };
          return { role: u.role ?? 'PATIENT', mustChangePassword: u.mustChangePassword ?? false };
        },
      },
    }),
    emailOTP({
      otpLength: OTP_LENGTH,
      expiresIn: OTP_TTL_SECONDS,
      allowedAttempts: OTP_MAX_ATTEMPTS,
      storeOTP: 'hashed',
      sendVerificationOnSignUp: true,
      sendVerificationOTP: async ({ email, otp, type }) => {
        if (type !== 'email-verification') return;
        // Deliberately not awaited: keeps response time independent of the mail server.
        void sendOtpEmail(email, otp).catch((err: unknown) =>
          logger.error({ err }, 'Failed to send OTP email'),
        );
      },
    }),
  ],
});
