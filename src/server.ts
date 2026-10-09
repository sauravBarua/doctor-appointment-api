import { createServer } from 'node:http';
import { app } from './app.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { prisma } from './config/prisma.js';
import { redis } from './config/redis.js';
import { startMessaging, stopMessaging } from './messaging/broker.js';
import { processAppointmentEvent } from './modules/notifications/notifications.handler.js';
import { attachRealtime } from './realtime/socket.js';

const server = createServer(app);
const io = attachRealtime(server);

server.on('error', (err) => {
  logger.fatal({ err }, 'Server failed to start');
  process.exit(1);
});

server.listen(env.PORT, () => {
  logger.info(`Server listening on http://localhost:${env.PORT}`);
  void startMessaging({ consumer: processAppointmentEvent });
});

let shuttingDown = false;

function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'Shutting down');
  setTimeout(() => process.exit(1), 10_000).unref();
  // io.close() disconnects the sockets and closes the HTTP server too.
  void io.close(() => {
    stopMessaging()
      .then(() => Promise.allSettled([redis.quit(), prisma.$disconnect()]))
      .finally(() => process.exit(0));
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason }, 'Unhandled rejection');
});
