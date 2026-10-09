import { z } from 'zod';
import { SLOT_DURATION_MINUTES } from '../../config/constants.js';
import { idParams, paginationShape } from '../../utils/schemas.js';

export { idParams };

const MAX_TIME_OFF_DAYS = 365;

const weekday = z.number().int().min(1).max(7);
const minute = z
  .number()
  .int()
  .min(0)
  .max(1440)
  .refine((n) => n % SLOT_DURATION_MINUTES === 0, `Must be a multiple of ${SLOT_DURATION_MINUTES}`);

export const createRuleBody = z
  .object({ weekday, startMinute: minute, endMinute: minute })
  .refine((b) => b.startMinute < b.endMinute, {
    message: 'endMinute must be greater than startMinute',
    path: ['endMinute'],
  });

export const updateRuleBody = z
  .object({
    weekday: weekday.optional(),
    startMinute: minute.optional(),
    endMinute: minute.optional(),
  })
  .refine((b) => Object.values(b).some((v) => v !== undefined), {
    message: 'Provide at least one field',
  });

const instant = z.iso.datetime({ offset: true }).transform((s) => new Date(s));

export const createTimeOffBody = z
  .object({
    startTime: instant,
    endTime: instant,
    reason: z.string().trim().min(1).max(200).optional(),
  })
  .refine((b) => b.endTime > b.startTime, {
    message: 'endTime must be after startTime',
    path: ['endTime'],
  })
  .refine((b) => b.endTime > new Date(), {
    message: 'Time off must end in the future',
    path: ['endTime'],
  })
  .refine((b) => b.endTime.getTime() - b.startTime.getTime() <= MAX_TIME_OFF_DAYS * 86_400_000, {
    message: `Time off cannot exceed ${MAX_TIME_OFF_DAYS} days`,
    path: ['endTime'],
  });

export const listTimeOffQuery = z.object({
  ...paginationShape,
  from: instant.optional(),
  to: instant.optional(),
});

export type CreateRuleBody = z.infer<typeof createRuleBody>;
export type UpdateRuleBody = z.infer<typeof updateRuleBody>;
export type CreateTimeOffBody = z.infer<typeof createTimeOffBody>;
export type ListTimeOffQuery = z.infer<typeof listTimeOffQuery>;
