import { createLocalJWKSet, errors, jwtVerify, type JSONWebKeySet } from 'jose';
import { z } from 'zod';
import { env } from '../config/env.js';
import { ROLES } from '../utils/roles.js';
import { auth } from './auth.js';

const claimsSchema = z.object({
  sub: z.string().min(1),
  role: z.enum(ROLES),
  mustChangePassword: z.boolean(),
});

export type AccessTokenClaims = z.infer<typeof claimsSchema>;

const KEY_TTL_MS = 5 * 60_000;
const MIN_RELOAD_INTERVAL_MS = 30_000;

type KeyCache = { getKey: ReturnType<typeof createLocalJWKSet>; loadedAt: number };
let cache: KeyCache | null = null;

async function loadKeys(): Promise<KeyCache> {
  const jwks = (await auth.api.getJwks()) as unknown as JSONWebKeySet;
  cache = { getKey: createLocalJWKSet(jwks), loadedAt: Date.now() };
  return cache;
}

function verifyWith(keys: KeyCache, token: string) {
  return jwtVerify(token, keys.getKey, {
    issuer: env.BETTER_AUTH_URL,
    audience: env.BETTER_AUTH_URL,
  });
}

export async function verifyAccessToken(token: string): Promise<AccessTokenClaims> {
  let keys = cache && Date.now() - cache.loadedAt < KEY_TTL_MS ? cache : await loadKeys();
  let result: Awaited<ReturnType<typeof verifyWith>>;
  try {
    result = await verifyWith(keys, token);
  } catch (err) {
    // Unknown key id: the keys may have rotated. Reload once, but not on every bad token.
    if (
      !(err instanceof errors.JWKSNoMatchingKey) ||
      Date.now() - keys.loadedAt < MIN_RELOAD_INTERVAL_MS
    ) {
      throw err;
    }
    keys = await loadKeys();
    result = await verifyWith(keys, token);
  }
  return claimsSchema.parse(result.payload);
}
