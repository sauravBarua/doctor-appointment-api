import { randomInt } from 'node:crypto';

const SETS = ['ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnopqrstuvwxyz', '23456789', '!@#%*-_'];
const ALL = SETS.join('');

const pick = (set: string): string => set.charAt(randomInt(set.length));

/** 16 characters with at least one upper, lower, digit and symbol. */
export function generateTempPassword(length = 16): string {
  const chars = SETS.map(pick);
  while (chars.length < length) chars.push(pick(ALL));
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    const a = chars[i] ?? '';
    chars[i] = chars[j] ?? '';
    chars[j] = a;
  }
  return chars.join('');
}
