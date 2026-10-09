import { z } from 'zod';
import { idParams, paginationShape } from '../../utils/schemas.js';

export { idParams };

const instant = z.iso.datetime({ offset: true }).transform((s) => new Date(s));

export const bookBody = z.object({
  doctorId: idParams.shape.id,
  startTime: instant,
});

export const cancelBody = z
  .object({ reason: z.string().trim().min(1).max(300).optional() })
  .default({});

export const listQuery = z.object({
  ...paginationShape,
  status: z.enum(['BOOKED', 'CANCELLED', 'COMPLETED']).optional(),
  from: instant.optional(),
  to: instant.optional(),
  doctorId: idParams.shape.id.optional(), // admin only
  patientId: z.string().trim().min(1).max(64).optional(), // admin only
});

export type BookBody = z.infer<typeof bookBody>;
export type CancelBody = z.infer<typeof cancelBody>;
export type ListQuery = z.infer<typeof listQuery>;
