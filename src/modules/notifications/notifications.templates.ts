import { DateTime } from 'luxon';
import type { AppointmentEvent } from '../../messaging/events.js';

export type Party = { id: string; name: string; email: string };
export type AppointmentFacts = {
  id: string;
  startTime: Date;
  timezone: string;
  patient: Party;
  doctor: Party;
  clinicName: string;
  clinicAddress: string;
};
export type Recipient = Party & { role: 'PATIENT' | 'DOCTOR' };

export type Message = {
  type: 'APPOINTMENT_BOOKED' | 'APPOINTMENT_CANCELLED';
  title: string;
  body: string;
  data: { appointmentId: string; startTime: string };
};

const when = (a: AppointmentFacts) =>
  `${DateTime.fromJSDate(a.startTime, { zone: a.timezone }).setLocale('en').toFormat("ccc d LLL yyyy 'at' HH:mm")} (${a.timezone})`;

const who = (role: AppointmentEvent['actor']['role']) =>
  role === 'ADMIN' ? 'an administrator' : role === 'DOCTOR' ? 'the doctor' : 'the patient';

export function recipientsFor(event: AppointmentEvent, a: AppointmentFacts): Recipient[] {
  const both: Recipient[] = [
    { ...a.patient, role: 'PATIENT' },
    { ...a.doctor, role: 'DOCTOR' },
  ];
  if (event.type === 'appointment.booked' || event.actor.role === 'ADMIN') return both;
  return both.filter((r) => r.id !== event.actor.id);
}

export function buildMessage(event: AppointmentEvent, a: AppointmentFacts, to: Recipient): Message {
  const data = { appointmentId: a.id, startTime: a.startTime.toISOString() };

  if (event.type === 'appointment.booked') {
    return to.role === 'PATIENT'
      ? {
          type: 'APPOINTMENT_BOOKED',
          title: 'Appointment confirmed',
          body: `Your appointment with ${a.doctor.name} is confirmed for ${when(a)} at ${a.clinicName}, ${a.clinicAddress}.`,
          data,
        }
      : {
          type: 'APPOINTMENT_BOOKED',
          title: 'New appointment',
          body: `${a.patient.name} booked an appointment for ${when(a)}.`,
          data,
        };
  }

  const reason = event.reason ? ` Reason: ${event.reason}` : '';
  const body =
    to.role === 'PATIENT'
      ? `Your appointment with ${a.doctor.name} on ${when(a)} was cancelled by ${who(event.actor.role)}.${reason}`
      : `The appointment with ${a.patient.name} on ${when(a)} was cancelled by ${who(event.actor.role)}.${reason}`;
  return { type: 'APPOINTMENT_CANCELLED', title: 'Appointment cancelled', body, data };
}
