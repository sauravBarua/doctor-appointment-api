import { z } from 'zod';

// Unknown keys (such as email) are stripped by Zod, so they can never be changed here.
export const updateProfileBody = z.object({
  name: z.string().trim().min(2).max(100).optional(),
  bio: z.string().trim().max(1000).nullable().optional(),
});

export type UpdateProfileBody = z.infer<typeof updateProfileBody>;
