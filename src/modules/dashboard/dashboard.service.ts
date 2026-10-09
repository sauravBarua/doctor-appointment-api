import httpStatus from 'http-status';
import { DateTime } from 'luxon';
import { CACHE_TTL_SECONDS, DASHBOARD_TIMEZONE } from '../../config/constants.js';
import { prisma } from '../../config/prisma.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { cached } from '../../lib/cache.js';
import { AppError } from '../../utils/AppError.js';
import { ErrorCode } from '../../utils/errorCodes.js';
import {
  select as appointmentSelect,
  toDto as toAppointmentDto,
} from '../appointments/appointments.service.js';

type Status = 'BOOKED' | 'CANCELLED' | 'COMPLETED';
const HELD: Status[] = ['BOOKED', 'COMPLETED']; // appointments that actually happen

async function countByStatus(where: Prisma.AppointmentWhereInput) {
  const rows = await prisma.appointment.groupBy({ by: ['status'], where, _count: { _all: true } });
  const result: Record<Status, number> = { BOOKED: 0, CANCELLED: 0, COMPLETED: 0 };
  for (const r of rows) result[r.status] = r._count._all;
  return result;
}

function dayWindow(zone: string) {
  const now = DateTime.now().setZone(zone);
  const start = now.startOf('day');
  return { now, start, end: start.plus({ days: 1 }) };
}

// ---------------------------------------------------------------- admin

export function getAdminDashboard() {
  return cached('dash:admin', CACHE_TTL_SECONDS, async () => {
    const zone = DASHBOARD_TIMEZONE;
    const { now, start: today, end: tomorrow } = dayWindow(zone);
    const since30 = today.minus({ days: 29 }); // 30 days including today
    const nowDate = now.toJSDate();

    const [
      roleRows,
      newPatients,
      activeDoctors,
      inactiveDoctors,
      clinics,
      specialties,
      byStatus,
      todayCount,
      next7Count,
      past30Count,
      dailyRows,
      topRows,
      activity,
    ] = await Promise.all([
      prisma.user.groupBy({ by: ['role'], _count: { _all: true } }),
      prisma.user.count({ where: { role: 'PATIENT', createdAt: { gte: since30.toJSDate() } } }),
      prisma.doctor.count({ where: { isActive: true } }),
      prisma.doctor.count({ where: { isActive: false } }),
      prisma.clinic.count(),
      prisma.specialty.count({ where: { isActive: true } }),
      countByStatus({}),
      prisma.appointment.count({
        where: { status: 'BOOKED', startTime: { gte: today.toJSDate(), lt: tomorrow.toJSDate() } },
      }),
      prisma.appointment.count({
        where: {
          status: 'BOOKED',
          startTime: { gte: nowDate, lt: now.plus({ days: 7 }).toJSDate() },
        },
      }),
      prisma.appointment.count({
        where: { status: { in: HELD }, startTime: { gte: since30.toJSDate(), lt: nowDate } },
      }),
      prisma.$queryRaw<{ day: string; count: number }[]>`
        SELECT to_char("startTime" AT TIME ZONE ${zone}, 'YYYY-MM-DD') AS day, COUNT(*)::int AS count
        FROM appointments
        WHERE status IN ('BOOKED', 'COMPLETED')
          AND "startTime" >= ${since30.toJSDate()} AND "startTime" < ${tomorrow.toJSDate()}
        GROUP BY 1
        ORDER BY 1`,
      prisma.appointment.groupBy({
        by: ['doctorId'],
        where: { status: { in: HELD }, startTime: { gte: since30.toJSDate(), lt: nowDate } },
        _count: { _all: true },
        orderBy: { _count: { doctorId: 'desc' } },
        take: 5,
      }),
      prisma.auditLog.findMany({
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 10,
        select: {
          id: true,
          action: true,
          entityType: true,
          entityId: true,
          actorRole: true,
          createdAt: true,
          actor: { select: { name: true, email: true } },
        },
      }),
    ]);

    const roles = { PATIENT: 0, DOCTOR: 0, ADMIN: 0 };
    for (const r of roleRows) roles[r.role] = r._count._all;

    const perDay = new Map(dailyRows.map((r) => [r.day, r.count]));
    const dailyBookings = Array.from({ length: 30 }, (_, i) => {
      const date = since30.plus({ days: i }).toISODate()!;
      return { date, count: perDay.get(date) ?? 0 };
    });

    const topDoctorRows = await prisma.doctor.findMany({
      where: { id: { in: topRows.map((r) => r.doctorId) } },
      select: { id: true, user: { select: { name: true } }, specialty: { select: { name: true } } },
    });
    const byId = new Map(topDoctorRows.map((d) => [d.id, d]));
    const topDoctors = topRows.map((r) => ({
      doctorId: r.doctorId,
      name: byId.get(r.doctorId)?.user.name ?? 'Unknown',
      specialty: byId.get(r.doctorId)?.specialty.name ?? null,
      appointments: r._count._all,
    }));

    return {
      generatedAt: nowDate.toISOString(),
      timezone: zone,
      users: {
        patients: roles.PATIENT,
        doctors: roles.DOCTOR,
        admins: roles.ADMIN,
        newPatientsLast30Days: newPatients,
      },
      catalog: { activeDoctors, inactiveDoctors, clinics, specialties },
      appointments: { byStatus, today: todayCount, next7Days: next7Count, past30Days: past30Count },
      dailyBookings,
      topDoctors,
      recentActivity: activity.map((a) => ({ ...a, createdAt: a.createdAt.toISOString() })),
    };
  });
}

// ---------------------------------------------------------------- doctor

export async function getDoctorDashboard(userId: string) {
  const doctor = await prisma.doctor.findUnique({
    where: { userId },
    select: { id: true, clinic: { select: { timezone: true } } },
  });
  if (!doctor)
    throw new AppError(httpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, 'Doctor profile not found');
  const doctorId = doctor.id;
  const zone = doctor.clinic.timezone;

  return cached(`dash:doctor:${doctorId}`, CACHE_TTL_SECONDS, async () => {
    const { now, start: today, end: tomorrow } = dayWindow(zone);
    const nowDate = now.toJSDate();
    const weekEnd = today.plus({ days: 7 });

    const [todayRows, next, upcoming, weekRows, byStatus, patients, timeOff] = await Promise.all([
      prisma.appointment.findMany({
        where: {
          doctorId,
          status: 'BOOKED',
          startTime: { gte: today.toJSDate(), lt: tomorrow.toJSDate() },
        },
        orderBy: { startTime: 'asc' },
        take: 50,
        select: appointmentSelect,
      }),
      prisma.appointment.findFirst({
        where: { doctorId, status: 'BOOKED', startTime: { gt: nowDate } },
        orderBy: { startTime: 'asc' },
        select: appointmentSelect,
      }),
      prisma.appointment.count({
        where: { doctorId, status: 'BOOKED', startTime: { gt: nowDate } },
      }),
      prisma.appointment.findMany({
        where: {
          doctorId,
          status: 'BOOKED',
          startTime: { gte: today.toJSDate(), lt: weekEnd.toJSDate() },
        },
        select: { startTime: true },
      }),
      countByStatus({ doctorId }),
      prisma.appointment.groupBy({
        by: ['patientId'],
        where: { doctorId, status: { in: HELD }, startTime: { lt: nowDate } },
        _count: { _all: true },
      }),
      prisma.timeOff.count({ where: { doctorId, endTime: { gte: nowDate } } }),
    ]);

    const perDay = new Map<string, number>();
    for (const r of weekRows) {
      const key = DateTime.fromJSDate(r.startTime, { zone }).toISODate()!;
      perDay.set(key, (perDay.get(key) ?? 0) + 1);
    }
    const next7Days = Array.from({ length: 7 }, (_, i) => {
      const date = today.plus({ days: i }).toISODate()!;
      return { date, count: perDay.get(date) ?? 0 };
    });

    return {
      generatedAt: nowDate.toISOString(),
      timezone: zone,
      today: { total: todayRows.length, appointments: todayRows.map(toAppointmentDto) },
      nextAppointment: next ? toAppointmentDto(next) : null,
      upcoming,
      next7Days,
      byStatus,
      patientsServed: patients.length,
      upcomingTimeOff: timeOff,
    };
  });
}

// ---------------------------------------------------------------- patient

export function getPatientDashboard(patientId: string) {
  return cached(`dash:patient:${patientId}`, CACHE_TTL_SECONDS, async () => {
    const now = DateTime.now().setZone(DASHBOARD_TIMEZONE);
    const nowDate = now.toJSDate();
    const upcomingWhere: Prisma.AppointmentWhereInput = {
      patientId,
      status: 'BOOKED',
      startTime: { gt: nowDate },
    };

    const [upcomingRows, upcoming, past, cancelled] = await Promise.all([
      prisma.appointment.findMany({
        where: upcomingWhere,
        orderBy: { startTime: 'asc' },
        take: 5,
        select: appointmentSelect,
      }),
      prisma.appointment.count({ where: upcomingWhere }),
      prisma.appointment.count({
        where: { patientId, status: { in: HELD }, startTime: { lte: nowDate } },
      }),
      prisma.appointment.count({ where: { patientId, status: 'CANCELLED' } }),
    ]);

    const list = upcomingRows.map(toAppointmentDto);
    return {
      generatedAt: nowDate.toISOString(),
      timezone: DASHBOARD_TIMEZONE,
      nextAppointment: list[0] ?? null,
      upcoming: list,
      counts: { upcoming, past, cancelled },
    };
  });
}
