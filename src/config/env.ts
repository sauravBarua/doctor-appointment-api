import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config({ quiet: true });

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).default(0),
  RATE_LIMIT_DISABLED: z.stringbool().default(false),
  DATABASE_URL: z.url(),
  REDIS_URL: z.url(),
  RABBITMQ_URL: z.url(),
  FRONTEND_URL: z.url(),
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.url(),
  SMTP_HOST: z.string().min(1),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535),
  SMTP_USER: z.string().min(1),
  SMTP_PASS: z.string().min(1),
  MAIL_FROM: z.string().min(3),
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  CLOUDINARY_CLOUD_NAME: z.string().min(1),
  CLOUDINARY_API_KEY: z.string().min(1),
  CLOUDINARY_API_SECRET: z.string().min(1),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const lines = parsed.error.issues.map((i) => `  ${i.path.map(String).join('.')}: ${i.message}`);
  process.stderr.write(`Invalid environment variables:\n${lines.join('\n')}\n`);
  process.exit(1);
}

if (parsed.data.NODE_ENV === 'production' && parsed.data.RATE_LIMIT_DISABLED) {
  process.stderr.write('RATE_LIMIT_DISABLED must not be enabled in production\n');
  process.exit(1);
}

export const env = parsed.data;
