import type { CorsOptions } from 'cors';
import { env } from './env.js';

// FRONTEND_URL may include a path or trailing slash; browsers send only the origin.
export const frontendOrigin = new URL(env.FRONTEND_URL).origin;

export const corsOptions: CorsOptions = {
  origin: frontendOrigin,
  credentials: true,
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  exposedHeaders: ['RateLimit', 'RateLimit-Policy', 'Retry-After'],
  maxAge: 600,
};
