import express from 'express';
import { pinoHttp } from 'pino-http';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { errorHandler } from './middleware/errorHandler.js';
import { notFound } from './middleware/notFound.js';
import { apiRouter } from './modules/index.route.js';
import { API_PREFIX } from './config/constants.js';

export const app = express();

app.disable('x-powered-by');
app.set('trust proxy', env.TRUST_PROXY_HOPS);

app.use(
  pinoHttp({ logger, autoLogging: { ignore: (req) => req.url?.endsWith('/health') ?? false } }),
);

// Phase 3: the Better Auth raw handler mounts HERE, before express.json().

app.use(express.json({ limit: '1mb' }));
app.use(API_PREFIX, apiRouter);
app.use(notFound);
app.use(errorHandler);
