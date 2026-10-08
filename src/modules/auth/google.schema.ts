import { z } from 'zod';

export const googleErrorQuery = z.object({
  error: z.string().max(100).optional(),
  error_description: z.string().max(500).optional(),
});

export const googleExchangeBody = z.object({
  code: z.string().regex(/^[A-Za-z0-9_-]{20,100}$/, 'Invalid code'),
});

export type GoogleErrorQuery = z.infer<typeof googleErrorQuery>;
export type GoogleExchangeBody = z.infer<typeof googleExchangeBody>;
