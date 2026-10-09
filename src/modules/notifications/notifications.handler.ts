import { randomUUID } from 'node:crypto';
import { prisma } from '../../config/prisma.js';
import { logger } from '../../config/logger.js';
import { sendEmail } from '../../lib/mailer.js';
import { appointmentEventSchema } from '../../messaging/events.js';
import { emitToUser } from '../../realtime/socket.js';
import { buildMessage, recipientsFor, type AppointmentFacts } from './notifications.templates.js';

async function loadFacts(appointmentId: string): Promise<AppointmentFacts | null> {
  const a = await prisma.appointment.findUnique({
    where: { id: appointmentId },
    select: {
      id: true,
      startTime: true,
      patient: { select: { id: true, name: true, email: true } },
      doctor: {
        select: {
          user: { select: { id: true, name: true, email: true } },
          clinic: { select: { name: true, address: true, timezone: true } },
        },
      },
    },
  });
  if (!a) return null;
  return {
    id: a.id,
    startTime: a.startTime,
    timezone: a.doctor.clinic.timezone,
    patient: a.patient,
    doctor: a.doctor.user,
    clinicName: a.doctor.clinic.name,
    clinicAddress: a.doctor.clinic.address,
  };
}

/**
 * The queue consumer. Throws on bad payloads and database errors (so the broker retries,
 * then dead-letters). Safe to run twice for the same event: a recipient is only notified
 * when its row was newly created.
 */
export async function processAppointmentEvent(raw: unknown): Promise<void> {
  const event = appointmentEventSchema.parse(raw);
  const facts = await loadFacts(event.appointmentId);
  if (!facts) {
    logger.warn(
      { eventId: event.id, appointmentId: event.appointmentId },
      'Appointment no longer exists, skipping',
    );
    return;
  }

  for (const recipient of recipientsFor(event, facts)) {
    const message = buildMessage(event, facts, recipient);
    const id = randomUUID();

    const { count } = await prisma.notification.createMany({
      data: [{ id, eventId: event.id, userId: recipient.id, ...message }],
      skipDuplicates: true,
    });
    if (count === 0) continue; // already handled

    emitToUser(recipient.id, 'notification', {
      id,
      ...message,
      readAt: null,
      createdAt: new Date().toISOString(),
    });

    try {
      await sendEmail({ to: recipient.email, subject: message.title, text: message.body });
    } catch (err) {
      logger.warn({ err, userId: recipient.id }, 'Notification email failed');
    }
  }
}
