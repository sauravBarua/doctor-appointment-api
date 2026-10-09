import httpStatus from 'http-status';
import { DateTime } from 'luxon';
import { BOOKING_HORIZON_DAYS, SLOT_DURATION_MINUTES } from '../../config/constants.js';
import { prisma } from '../../config/prisma.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { bumpSlotsVersion, invalidateDashboards } from '../../lib/cache.js';
import { publishAppointmentEvent } from '../../messaging/events.js';
import { AppError } from '../../utils/AppError.js';
import { ErrorCode } from '../../utils/errorCodes.js';
import { lockDoctorRow } from '../../utils/locks.js';
import { prismaErrorCode } from '../../utils/prismaErrors.js';
import type { Role } from '../../utils/roles.js';
import type { BookBody, ListQuery } from './appointments.schema.js';

export type Actor = { id: string; role: Role };

export const select = {
  id: true,
  status: true,
  startTime: true,
  endTime: true,
  cancelledAt: true,
  cancelReason: true,
  createdAt: true,
  version: true,
  patient: { select: { id: true, name: true } },
  doctor: {
    select: {
      id: true,
      user: { select: { id: true, name: true } },
      specialty: { select: { name: true } },
      clinic: { select: { id: true, name: true, city: true, address: true, timezone: true } },
    },
  },
} satisfies Prisma.AppointmentSelect;

type Row = Prisma.AppointmentGetPayload<{ select: typeof select }>;

export function toDto(a: Row) {
  const zone = a.doctor.clinic.timezone;
  const local = (d: Date) => DateTime.fromJSDate(d, { zone }).toISO({ suppressMilliseconds: true });
  const { id, name, city, address } = a.doctor.clinic;
  return {
    id: a.id,
    status: a.status,
    startTime: a.startTime.toISOString(), // UTC
    endTime: a.endTime.toISOString(),
    startLocal: local(a.startTime), // clinic time, e.g. 2026-10-12T09:00:00+02:00
    endLocal: local(a.endTime),
    timezone: zone,
    doctor: {
      id: a.doctor.id,
      name: a.doctor.user.name,
      specialty: a.doctor.specialty.name,
      clinic: { id, name, city, address },
    },
    patient: a.patient,
    cancelledAt: a.cancelledAt?.toISOString() ?? null,
    cancelReason: a.cancelReason,
    createdAt: a.createdAt.toISOString(),
  };
}

const conflict = (code: ErrorCode, message: string) =>
  new AppError(httpStatus.CONFLICT, code, message);
const invalidSlot = (message: string) =>
  new AppError(httpStatus.BAD_REQUEST, ErrorCode.INVALID_SLOT, message);
const notFound = () =>
  new AppError(httpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, 'Appointment not found');

/** The unique-index backstop fired: say which of the two indexes it was. */
function uniqueViolation(err: unknown): AppError | null {
  if (prismaErrorCode(err) !== 'P2002') return null;
  const e = err as { message?: string; meta?: unknown };
  const text = `${e.message ?? ''} ${JSON.stringify(e.meta ?? {})}`;
  return text.includes('doctor_start')
    ? conflict(ErrorCode.SLOT_TAKEN, 'That slot has just been booked')
    : conflict(ErrorCode.PATIENT_BUSY, 'You already have an appointment at that time');
}

export async function bookAppointment(patientId: string, input: BookBody) {
  const { doctorId, startTime } = input;
  const now = Date.now();
  if (startTime.getTime() <= now) throw invalidSlot('Start time must be in the future');
  if (startTime.getTime() > now + BOOKING_HORIZON_DAYS * 86_400_000) {
    throw invalidSlot(`Appointments can only be booked ${BOOKING_HORIZON_DAYS} days ahead`);
  }
  const endTime = new Date(startTime.getTime() + SLOT_DURATION_MINUTES * 60_000);

  const doctor = await prisma.doctor.findFirst({
    where: { id: doctorId, isActive: true, specialty: { isActive: true } },
    select: { clinic: { select: { timezone: true } } },
  });
  if (!doctor) throw new AppError(httpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, 'Doctor not found');

  const local = DateTime.fromJSDate(startTime, { zone: doctor.clinic.timezone });
  const minuteOfDay = local.hour * 60 + local.minute;
  if (local.second !== 0 || local.millisecond !== 0 || minuteOfDay % SLOT_DURATION_MINUTES !== 0) {
    throw invalidSlot(`Start time must be on a ${SLOT_DURATION_MINUTES}-minute boundary`);
  }

  try {
    const created = await prisma.$transaction(async (tx) => {
      await lockDoctorRow(tx, doctorId);

      const window = await tx.availabilityRule.findFirst({
        where: {
          doctorId,
          weekday: local.weekday,
          startMinute: { lte: minuteOfDay },
          endMinute: { gte: minuteOfDay + SLOT_DURATION_MINUTES },
        },
        select: { id: true },
      });
      if (!window) throw invalidSlot('The doctor does not work at that time');

      const overlap = { startTime: { lt: endTime }, endTime: { gt: startTime } };

      const off = await tx.timeOff.findFirst({
        where: { doctorId, ...overlap },
        select: { id: true },
      });
      if (off) throw conflict(ErrorCode.SLOT_UNAVAILABLE, 'The doctor is unavailable at that time');

      const taken = await tx.appointment.findFirst({
        where: { doctorId, status: 'BOOKED', ...overlap },
        select: { id: true },
      });
      if (taken) throw conflict(ErrorCode.SLOT_TAKEN, 'That slot has just been booked');

      const mine = await tx.appointment.findFirst({
        where: { patientId, status: 'BOOKED', ...overlap },
        select: { id: true },
      });
      if (mine)
        throw conflict(ErrorCode.PATIENT_BUSY, 'You already have an appointment at that time');

      return tx.appointment.create({ data: { doctorId, patientId, startTime, endTime }, select });
    });
    await bumpSlotsVersion(doctorId);
    await invalidateDashboards({ doctorId, patientId });
    await publishAppointmentEvent({
      type: 'appointment.booked',
      appointmentId: created.id,
      actor: { id: patientId, role: 'PATIENT' },
    });
    return toDto(created);
  } catch (err) {
    throw uniqueViolation(err) ?? err;
  }
}

export async function cancelAppointment(actor: Actor, id: string, reason?: string) {
  const appt = await prisma.appointment.findUnique({ where: { id }, select });
  const allowed =
    appt &&
    (actor.role === 'ADMIN' || appt.patient.id === actor.id || appt.doctor.user.id === actor.id);
  if (!appt || !allowed) throw notFound();

  if (appt.status !== 'BOOKED') {
    throw conflict(
      ErrorCode.APPOINTMENT_NOT_CANCELLABLE,
      `Appointment is already ${appt.status.toLowerCase()}`,
    );
  }
  if (appt.startTime.getTime() <= Date.now()) {
    throw conflict(
      ErrorCode.APPOINTMENT_NOT_CANCELLABLE,
      'Appointments that have started cannot be cancelled',
    );
  }

  // Optimistic lock: only the request that still sees this version wins.
  const { count } = await prisma.appointment.updateMany({
    where: { id, status: 'BOOKED', version: appt.version },
    data: {
      status: 'CANCELLED',
      cancelledById: actor.id,
      cancelledAt: new Date(),
      cancelReason: reason ?? null,
      version: { increment: 1 },
    },
  });
  if (count === 0) {
    throw conflict(
      ErrorCode.APPOINTMENT_NOT_CANCELLABLE,
      'The appointment was just changed. Reload and try again',
    );
  }

  await bumpSlotsVersion(appt.doctor.id);
  await invalidateDashboards({ doctorId: appt.doctor.id, patientId: appt.patient.id });
  await publishAppointmentEvent({
    type: 'appointment.cancelled',
    appointmentId: id,
    actor: { id: actor.id, role: actor.role },
    reason: reason ?? null,
  });
  return toDto(await prisma.appointment.findUniqueOrThrow({ where: { id }, select }));
}

/** Patients see their own, doctors see theirs, admins see everything. */
function scopeFor(actor: Actor): Prisma.AppointmentWhereInput {
  if (actor.role === 'PATIENT') return { patientId: actor.id };
  if (actor.role === 'DOCTOR') return { doctor: { userId: actor.id } };
  return {};
}

export async function listAppointments(actor: Actor, q: ListQuery) {
  const admin = actor.role === 'ADMIN';
  const where: Prisma.AppointmentWhereInput = {
    ...scopeFor(actor),
    ...(admin && q.doctorId ? { doctorId: q.doctorId } : {}),
    ...(admin && q.patientId ? { patientId: q.patientId } : {}),
    ...(q.status ? { status: q.status } : {}),
    ...(q.from || q.to
      ? { startTime: { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lte: q.to } : {}) } }
      : {}),
  };
  const [rows, total] = await prisma.$transaction([
    prisma.appointment.findMany({
      where,
      select,
      orderBy: [{ startTime: 'asc' }, { id: 'asc' }],
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    }),
    prisma.appointment.count({ where }),
  ]);
  return { items: rows.map(toDto), total };
}

export async function getAppointment(actor: Actor, id: string) {
  const row = await prisma.appointment.findFirst({ where: { id, ...scopeFor(actor) }, select });
  if (!row) throw notFound();
  return toDto(row);
}
