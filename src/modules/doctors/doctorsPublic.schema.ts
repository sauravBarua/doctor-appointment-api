import { z } from 'zod';
import { idParams, paginationShape } from '../../utils/schemas.js';

export { idParams };

const text = z.string().trim().min(1).max(100);

export const searchDoctorsQuery = z.object({
  ...paginationShape,
  q: text.optional(),
  city: text.optional(),
  specialtyId: idParams.shape.id.optional(),
  clinicId: idParams.shape.id.optional(),
});

export const slotsQuery = z.object({
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
});

export type SearchDoctorsQuery = z.infer<typeof searchDoctorsQuery>;
export type SlotsQuery = z.infer<typeof slotsQuery>;
