import httpStatus from 'http-status';
import { DateTime } from 'luxon';
import {
  BOOKING_HORIZON_DAYS,
  CACHE_TTL_SECONDS,
  MAX_SLOT_RANGE_DAYS,
  SLOT_DURATION_MINUTES,
} from '../../config/constants.js';
import { prisma } from '../../config/prisma.js';
import { cached, getSlotsVersion } from '../../lib/cache.js';
import { AppError } from '../../utils/AppError.js';
import { ErrorCode } from '../../utils/errorCodes.js';
import { buildDaySlots } from './slots.builder.js';

const badRange = (message: string) =>
  new AppError(httpStatus.BAD_REQUEST, ErrorCode.VALIDATION_ERROR, message);

export async function getSlots(doctorId: string, q: { from?: string; to?: string }) {
  const doctor = await prisma.doctor.findFirst({
    where: { id: doctorId, isActive: true, specialty: { isActive: true } },
    select: { id: true, clinic: { select: { timezone: true } } },
  });
  if (!doctor) throw new AppError(httpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, 'Doctor not found');

  const timezone = doctor.clinic.timezone;
  const today = DateTime.now().setZone(timezone).startOf('day');
  const from = q.from ? DateTime.fromISO(q.from, { zone: timezone }) : today;
  const to = q.to ? DateTime.fromISO(q.to, { zone: timezone }) : from.plus({ days: 6 });

  if (from < today) throw badRange('from cannot be in the past');
  if (to < from) throw badRange('to must be on or after from');
  if (to.diff(from, 'days').days > MAX_SLOT_RANGE_DAYS - 1)
    throw badRange(`Range cannot exceed ${MAX_SLOT_RANGE_DAYS} days`);
  if (to > today.plus({ days: BOOKING_HORIZON_DAYS }))
    throw badRange(`Slots are only available ${BOOKING_HORIZON_DAYS} days ahead`);

  const fromStr = from.toISODate()!;
  const toStr = to.toISODate()!;
  const version = await getSlotsVersion(doctor.id);

  return cached(
    `slots:${doctor.id}:v${version}:${fromStr}:${toStr}`,
    CACHE_TTL_SECONDS,
    async () => {
      const rangeStart = from.startOf('day').toJSDate();
      const rangeEnd = to.plus({ days: 1 }).startOf('day').toJSDate();
      const overlap = { startTime: { lt: rangeEnd }, endTime: { gt: rangeStart } };

      const [rules, timeOff, booked] = await Promise.all([
        prisma.availabilityRule.findMany({
          where: { doctorId: doctor.id },
          select: { weekday: true, startMinute: true, endMinute: true },
        }),
        prisma.timeOff.findMany({
          where: { doctorId: doctor.id, ...overlap },
          select: { startTime: true, endTime: true },
        }),
        prisma.appointment.findMany({
          where: { doctorId: doctor.id, status: 'BOOKED', ...overlap },
          select: { startTime: true, endTime: true },
        }),
      ]);

      const days = buildDaySlots({
        from: fromStr,
        to: toStr,
        timezone,
        rules,
        blocks: [...timeOff, ...booked],
        now: new Date(),
      });

      return {
        doctorId: doctor.id,
        timezone,
        slotDurationMinutes: SLOT_DURATION_MINUTES,
        from: fromStr,
        to: toStr,
        days: days.map((d) => ({
          date: d.date,
          slots: d.slots.map((s) => {
            const start = DateTime.fromJSDate(s.startTime, { zone: timezone });
            const end = DateTime.fromJSDate(s.endTime, { zone: timezone });
            return {
              startTime: s.startTime.toISOString(), // UTC: use this value to book
              endTime: s.endTime.toISOString(),
              startLocal: start.toISO({ suppressMilliseconds: true }), // e.g. 2026-10-12T09:00:00+02:00
              endLocal: end.toISO({ suppressMilliseconds: true }),
              label: `${start.toFormat('HH:mm')}-${end.toFormat('HH:mm')}`, // e.g. 09:00-09:30
            };
          }),
        })),
      };
    },
  );
}
