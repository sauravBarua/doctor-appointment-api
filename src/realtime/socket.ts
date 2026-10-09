import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import { SOCKET_MAX_AGE_MS } from '../config/constants.js';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { verifyAccessToken } from '../lib/jwt.js';

let io: Server | null = null;

export const userRoom = (userId: string) => `user:${userId}`;

function tokenFrom(handshake: {
  auth: Record<string, unknown>;
  headers: Record<string, unknown>;
}): string | null {
  const fromAuth = handshake.auth['token'];
  if (typeof fromAuth === 'string' && fromAuth.length > 0) return fromAuth;
  const header = handshake.headers['authorization'];
  if (typeof header === 'string' && header.startsWith('Bearer '))
    return header.slice(7).trim() || null;
  return null;
}

export function attachRealtime(httpServer: HttpServer): Server {
  const server = new Server(httpServer, {
    cors: { origin: env.FRONTEND_URL, credentials: true },
    serveClient: false,
  });

  server.use(async (socket, next) => {
    try {
      const token = tokenFrom(socket.handshake);
      if (!token) return next(new Error('UNAUTHORIZED'));
      const claims = await verifyAccessToken(token);
      if (claims.mustChangePassword) return next(new Error('PASSWORD_CHANGE_REQUIRED'));
      socket.data['userId'] = claims.sub;
      next();
    } catch {
      next(new Error('UNAUTHORIZED'));
    }
  });

  server.on('connection', (socket) => {
    const userId = socket.data['userId'] as string;
    void socket.join(userRoom(userId));
    socket.emit('ready', { userId });
    // Tokens last 10 minutes and are only checked here, so force a periodic re-authentication.
    const timer = setTimeout(() => socket.disconnect(true), SOCKET_MAX_AGE_MS);
    timer.unref();
    socket.on('disconnect', () => clearTimeout(timer));
    logger.debug({ userId }, 'Socket connected');
  });

  io = server;
  return server;
}

/** Fire-and-forget push to every open tab of one user. */
export function emitToUser(userId: string, event: string, payload: unknown): void {
  io?.to(userRoom(userId)).emit(event, payload);
}
