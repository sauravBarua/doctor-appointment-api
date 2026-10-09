import { z } from 'zod';
import { booleanQuery, paginationShape } from '../../utils/schemas.js';

function isValidTimeZone(tz: string): boolean {
  if (tz !== 'UTC' && !/^[A-Za-z]+\/[A-Za-z0-9_+\-/]+$/.test(tz)) return false;
  try {
    Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const timezone = z
  .string()
  .trim()
  .refine(isValidTimeZone, 'Must be an IANA time zone such as Europe/Paris');
const name = z.string().trim().min(2).max(120);
const city = z.string().trim().min(2).max(80);
const address = z.string().trim().min(5).max(200);

export const createClinicBody = z.object({ name, city, address, timezone });

export const updateClinicBody = z.object({
  name: name.optional(),
  city: city.optional(),
  address: address.optional(),
  timezone: timezone.optional(),
  isActive: z.boolean().optional(),
});

export const publicListQuery = z.object({
  ...paginationShape,
  search: z.string().trim().min(1).max(120).optional(),
  city: z.string().trim().min(1).max(80).optional(),
});

export const adminListQuery = publicListQuery.extend({ isActive: booleanQuery });

export type CreateClinicBody = z.infer<typeof createClinicBody>;
export type UpdateClinicBody = z.infer<typeof updateClinicBody>;
export type PublicListQuery = z.infer<typeof publicListQuery>;
export type AdminListQuery = z.infer<typeof adminListQuery>;
