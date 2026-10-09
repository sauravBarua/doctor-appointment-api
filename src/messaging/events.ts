import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { publish } from './broker.js';

export const AppointmentEventType = {
  BOOKED: 'appointment.booked',
  CANCELLED: 'appointment.cancelled',
} as const;

export const appointmentEventSchema = z.object({
  id: z.uuid(),
  type: z.enum([AppointmentEventType.BOOKED, AppointmentEventType.CANCELLED]),
  occurredAt: z.iso.datetime(),
  appointmentId: z.string().min(1),
  actor: z.object({ id: z.string().min(1), role: z.enum(['PATIENT', 'DOCTOR', 'ADMIN']) }),
  reason: z.string().nullish(),
});

export type AppointmentEvent = z.infer<typeof appointmentEventSchema>;

export function publishAppointmentEvent(input: {
  type: AppointmentEvent['type'];
  appointmentId: string;
  actor: AppointmentEvent['actor'];
  reason?: string | null;
}): Promise<boolean> {
  const event: AppointmentEvent = {
    id: randomUUID(),
    occurredAt: new Date().toISOString(),
    ...input,
  };
  return publish(event.type, event);
}
