import { io } from 'socket.io-client';

const out = (...parts: unknown[]) => process.stdout.write(`${parts.join(' ')}\n`);
const fail = (...parts: unknown[]) => process.stderr.write(`${parts.join(' ')}\n`);

const token = process.argv[2];
const url = process.argv[3] ?? 'http://localhost:3000';
if (!token) {
  fail('Usage: pnpm tsx scripts/socket-listen.ts <accessToken> [url]');
  process.exit(1);
}

const socket = io(url, { auth: { token } });
socket.on('connect', () => out('connected', socket.id));
socket.on('ready', (info) => out('ready', JSON.stringify(info)));
socket.on('notification', (n) => out('notification', JSON.stringify(n, null, 2)));
socket.on('connect_error', (err) => fail('connect_error', err.message));
socket.on('disconnect', (reason) => out('disconnected', reason));
