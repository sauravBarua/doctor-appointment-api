import { z } from 'zod';
import { booleanQuery, paginationShape } from '../../utils/schemas.js';

export const createDoctorBody = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.string().trim().toLowerCase().pipe(z.email()),
  clinicId: z.uuid(),
  specialtyId: z.uuid(),
  slotDurationMinutes: z.number().int().min(10).max(120).multipleOf(5).default(30),
  bio: z.string().trim().max(1000).optional(),
});

export const updateDoctorBody = z.object({
  specialtyId: z.uuid().optional(),
  bio: z.string().trim().max(1000).nullable().optional(),
  isActive: z.boolean().optional(),
});

export const adminListQuery = z.object({
  ...paginationShape,
  search: z.string().trim().min(1).max(100).optional(),
  clinicId: z.uuid().optional(),
  specialtyId: z.uuid().optional(),
  isActive: booleanQuery,
});

export type CreateDoctorBody = z.infer<typeof createDoctorBody>;
export type UpdateDoctorBody = z.infer<typeof updateDoctorBody>;
export type AdminListQuery = z.infer<typeof adminListQuery>;
