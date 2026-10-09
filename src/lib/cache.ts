import { logger } from '../config/logger.js';
import { redis } from '../config/redis.js';

/** Read-through cache that never breaks a request: Redis errors fall back to the loader. */
export async function cached<T>(
  key: string,
  ttlSeconds: number,
  load: () => Promise<T>,
): Promise<T> {
  try {
    const hit = await redis.get(key);
    if (hit !== null) return JSON.parse(hit) as T;
  } catch (err) {
    logger.warn({ err, key }, 'cache read failed');
  }
  const value = await load();
  try {
    await redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
  } catch (err) {
    logger.warn({ err, key }, 'cache write failed');
  }
  return value;
}

const slotsVersionKey = (doctorId: string) => `slots:ver:${doctorId}`;

export async function getSlotsVersion(doctorId: string): Promise<string> {
  try {
    return (await redis.get(slotsVersionKey(doctorId))) ?? '0';
  } catch (err) {
    logger.warn({ err, doctorId }, 'slots version read failed');
    return `nocache-${Date.now()}`;
  }
}

/** Call after anything that changes a doctor's bookable slots. */
export async function bumpSlotsVersion(doctorId: string): Promise<void> {
  try {
    await redis.incr(slotsVersionKey(doctorId));
  } catch (err) {
    logger.warn({ err, doctorId }, 'slots version bump failed');
  }
}
