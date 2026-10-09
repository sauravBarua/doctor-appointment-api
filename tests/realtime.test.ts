import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { io as connect, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../src/config/prisma.js';
import { redis } from '../src/config/redis.js';
import { attachRealtime, emitToUser } from '../src/realtime/socket.js';
import { loginAs } from './helpers/auth.js';
import { createVerifiedUser } from './helpers/users.js';

const run = randomUUID().slice(0, 8);
const emails = [`rt-a-${run}@example.com`, `rt-b-${run}@example.com`];
let httpServer: HttpServer;
let url = '';
const sockets: Socket[] = [];
const users: { id: string; token: string }[] = [];

const open = (opts: Parameters<typeof connect>[1]) => {
  const s = connect(url, { transports: ['websocket'], reconnection: false, ...opts });
  sockets.push(s);
  return s;
};
const waitFor = <T>(s: Socket, event: string, ms = 2000) =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), ms);
    s.once(event, (value: T) => {
      clearTimeout(timer);
      resolve(value);
    });
  });

beforeAll(async () => {
  for (const email of emails) {
    const u = await createVerifiedUser({ email });
    users.push({ id: u.user.id, token: (await loginAs(u.user.email, u.password)).accessToken });
  }
  httpServer = createServer();
  attachRealtime(httpServer);
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  url = `http://localhost:${(httpServer.address() as AddressInfo).port}`;
});

afterAll(async () => {
  for (const s of sockets) s.close();
  await new Promise((resolve) => httpServer.close(resolve));
  await prisma.user.deleteMany({ where: { email: { in: emails } } });
  await prisma.$disconnect();
  redis.disconnect();
});

describe('socket.io', () => {
  it('rejects a connection without a valid token', async () => {
    const none = open({});
    expect((await waitFor<Error>(none, 'connect_error')).message).toBe('UNAUTHORIZED');
    const bad = open({ auth: { token: 'not-a-jwt' } });
    expect((await waitFor<Error>(bad, 'connect_error')).message).toBe('UNAUTHORIZED');
  });

  it('delivers to the right user only', async () => {
    const [a, b] = users;
    const sa = open({ auth: { token: a!.token } });
    const sb = open({ auth: { token: b!.token } });
    await Promise.all([waitFor(sa, 'ready'), waitFor(sb, 'ready')]);

    let leaked = false;
    sb.on('notification', () => (leaked = true));
    const received = waitFor<{ hello: string }>(sa, 'notification');
    emitToUser(a!.id, 'notification', { hello: 'world' });

    expect(await received).toEqual({ hello: 'world' });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(leaked).toBe(false);
  });

  it('also accepts the token in the Authorization header', async () => {
    const s = open({ extraHeaders: { Authorization: `Bearer ${users[0]!.token}` } });
    expect(await waitFor<{ userId: string }>(s, 'ready')).toEqual({ userId: users[0]!.id });
  });
});
