import { toNodeHandler } from 'better-auth/node';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { API_PREFIX } from './config/constants.js';
import { corsOptions } from './config/cors.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { docsRouter } from './docs/docs.router.js';
import { auth } from './lib/auth.js';
import { errorHandler } from './middleware/errorHandler.js';
import { notFound } from './middleware/notFound.js';
import { globalLimiter } from './middleware/rateLimiters.js';
import { apiRouter } from './modules/index.route.js';

export const app = express();

app.disable('x-powered-by');
app.set('trust proxy', env.TRUST_PROXY_HOPS);

app.use(cors(corsOptions)); // before the limiter so preflights are never rate limited
app.use('/api', docsRouter); // before global helmet: has its own relaxed helmet
app.use(helmet()); // strict defaults for everything else

app.use(
  pinoHttp({
    logger,
    redact: {
      paths: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
      censor: '[redacted]',
    },
    autoLogging: { ignore: (req) => req.url?.endsWith('/health') ?? false },
  }),
);
app.use(globalLimiter);

// Better Auth's raw handler: mounted BEFORE express.json(), behind an allowlist.
// Everything else under /api/auth/* is 404, so all auth goes through our validated routes.
const BETTER_AUTH_ALLOWLIST = new Set(['GET /api/auth/jwks', 'GET /api/auth/callback/google']);

// Better Auth can send OAuth failures (for example a missing state cookie) to /api/auth/error.
// Forward them to our own error page so they use the standard envelope.
app.get('/api/auth/error', (req, res) => {
  const query = req.originalUrl.split('?')[1];
  res.redirect(`${API_PREFIX}/auth/google/error${query ? `?${query}` : ''}`);
});

app.all(
  '/api/auth/*splat',
  (req, res, next) => {
    if (BETTER_AUTH_ALLOWLIST.has(`${req.method} ${req.path}`)) {
      next();
      return;
    }
    notFound(req, res, next);
  },
  toNodeHandler(auth),
);

app.use(express.json({ limit: '1mb' }));
app.use(API_PREFIX, apiRouter);
app.use(notFound);
app.use(errorHandler);
