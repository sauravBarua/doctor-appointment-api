import { Redis } from 'ioredis';
import { env } from './env.js';
import { logger } from './logger.js';

// One shared client. No global keyPrefix: each feature sets its own prefix
// (`rl:` rate limits, `cache:` availability, `dash:` dashboards).
export const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: 2,
  retryStrategy: (times) => Math.min(times * 200, 2000),
});

redis.on('error', (err) => logger.warn({ error: err.message }, 'Redis error'));
redis.on('ready', () => logger.info('Redis ready'));
