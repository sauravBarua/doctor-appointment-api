import { redis } from '../../config/redis.js';
import { prisma } from '../../config/prisma.js';

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

async function pingRedis(): Promise<'up' | 'down'> {
  try {
    const reply = await withTimeout(redis.ping(), 1000);
    return reply === 'PONG' ? 'up' : 'down';
  } catch {
    return 'down';
  }
}

async function pingDb(): Promise<'up' | 'down'> {
  try {
    await withTimeout(prisma.$queryRaw`SELECT 1`, 1000);
    return 'up';
  } catch {
    return 'down';
  }
}

export async function getHealth() {
  const [redisStatus, dbStatus] = await Promise.all([pingRedis(), pingDb()]);
  return {
    status: redisStatus === 'up' && dbStatus === 'up' ? 'ok' : 'degraded',
    uptimeSeconds: Math.round(process.uptime()),
    db: dbStatus,
    redis: redisStatus,
  };
}
