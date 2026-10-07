import { redis } from '../../config/redis.js';

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

export async function getHealth() {
  const redisStatus = await pingRedis();
  return {
    status: redisStatus === 'up' ? 'ok' : 'degraded',
    uptimeSeconds: Math.round(process.uptime()),
    redis: redisStatus,
  };
}
