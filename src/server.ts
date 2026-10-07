import { createServer } from 'node:http';
import { app } from './app.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { redis } from './config/redis.js';
import { prisma } from './config/prisma.js';

// Phase 10 attaches Socket.io to this http server.
const server = createServer(app);

server.on('error', (err) => {
  logger.fatal({ err }, 'Server failed to start');
  process.exit(1);
});

server.listen(env.PORT, () => {
  logger.info(`Server listening on http://localhost:${env.PORT}`);
});

let shuttingDown = false;

function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'Shutting down');
  setTimeout(() => process.exit(1), 10_000).unref();
  server.close(() => {
    Promise.allSettled([redis.quit(), prisma.$disconnect()]).finally(() => process.exit(0));
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason }, 'Unhandled rejection');
});
