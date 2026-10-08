import type { Request } from 'express';
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import httpStatus from 'http-status';
import { RedisStore, type RedisReply } from 'rate-limit-redis';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { redis } from '../config/redis.js';
import { ErrorCode } from '../utils/errorCodes.js';
import { sendResponse } from '../utils/sendResponse.js';

type LimiterConfig = {
  name: string;
  windowMs: number;
  limit: number;
  keyBy?: 'ip' | 'email-ip';
  failClosed?: boolean; // default: fail open when Redis is unreachable
  enforceInTest?: boolean;
  skip?: (req: Request) => boolean;
};

function emailFrom(req: Request): string | null {
  const body = req.body as { email?: unknown } | undefined;
  return typeof body?.email === 'string' ? body.email.trim().toLowerCase() : null;
}

export function createLimiter(config: LimiterConfig) {
  const disabled = env.NODE_ENV === 'test' && !config.enforceInTest;

  return rateLimit({
    windowMs: config.windowMs,
    limit: disabled ? 1_000_000 : config.limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    passOnStoreError: !config.failClosed,
    skip: config.skip,
    store: new RedisStore({
      prefix: `rl:${config.name}:`,
      sendCommand: async (command: string, ...args: string[]) => {
        try {
          return (await redis.call(command, ...args)) as RedisReply;
        } catch (err) {
          logger.warn(
            { limiter: config.name, error: err instanceof Error ? err.message : String(err) },
            'Rate-limit store error',
          );
          throw err;
        }
      },
    }),
    keyGenerator: (req) => {
      const ip = ipKeyGenerator(req.ip ?? '');
      if (config.keyBy === 'email-ip') {
        const email = emailFrom(req);
        if (email) return `${ip}|${email}`;
      }
      return ip;
    },
    handler: (req, res) => {
      const resetTime = (req as Request & { rateLimit?: { resetTime?: Date } }).rateLimit
        ?.resetTime;
      const retryAfter = resetTime
        ? Math.max(1, Math.ceil((resetTime.getTime() - Date.now()) / 1000))
        : Math.ceil(config.windowMs / 1000);
      res.setHeader('Retry-After', String(retryAfter));
      sendResponse(res, {
        statusCode: httpStatus.TOO_MANY_REQUESTS,
        success: false,
        message: 'Too many requests, please try again later',
        error: { code: ErrorCode.RATE_LIMITED },
      });
    },
  });
}

export const globalLimiter = createLimiter({
  name: 'global',
  windowMs: 60_000,
  limit: 100,
  skip: (req) => req.path.endsWith('/health'),
});

export const loginLimiter = createLimiter({ name: 'login', windowMs: 15 * 60_000, limit: 10 });

export const registerLimiter = createLimiter({
  name: 'register',
  windowMs: 60 * 60_000,
  limit: 5,
});

// Triggers real emails, so a Redis outage must not open an email-bombing window.
export const otpResendLimiter = createLimiter({
  name: 'otp-resend',
  windowMs: 60 * 60_000,
  limit: 5,
  keyBy: 'email-ip',
  failClosed: true,
});

// Brute force is already capped by the 3-attempt OTP limit, so availability wins here.
export const otpVerifyLimiter = createLimiter({
  name: 'otp-verify',
  windowMs: 15 * 60_000,
  limit: 10,
  keyBy: 'email-ip',
});
