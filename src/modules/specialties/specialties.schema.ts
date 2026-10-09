import { z } from 'zod';
import { booleanQuery, paginationShape } from '../../utils/schemas.js';

const name = z.string().trim().min(2).max(80);

export const createSpecialtyBody = z.object({ name });

export const updateSpecialtyBody = z.object({
  name: name.optional(),
  isActive: z.boolean().optional(),
});

export const publicListQuery = z.object({
  ...paginationShape,
  search: z.string().trim().min(1).max(80).optional(),
});

export const adminListQuery = publicListQuery.extend({ isActive: booleanQuery });

export type CreateSpecialtyBody = z.infer<typeof createSpecialtyBody>;
export type UpdateSpecialtyBody = z.infer<typeof updateSpecialtyBody>;
export type PublicListQuery = z.infer<typeof publicListQuery>;
export type AdminListQuery = z.infer<typeof adminListQuery>;
