import httpStatus from 'http-status';
import { SLOT_DURATION_MINUTES } from '../../config/constants.js';
import { prisma } from '../../config/prisma.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { bumpSlotsVersion } from '../../lib/cache.js';
import { AppError } from '../../utils/AppError.js';
import { ErrorCode } from '../../utils/errorCodes.js';
import type {
  CreateRuleBody,
  CreateTimeOffBody,
  ListTimeOffQuery,
  UpdateRuleBody,
} from './schedule.schema.js';

const hhmm = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

const ruleSelect = { id: true, weekday: true, startMinute: true, endMinute: true } as const;
const toRuleDto = (r: { id: string; weekday: number; startMinute: number; endMinute: number }) => ({
  ...r,
  start: hhmm(r.startMinute),
  end: hhmm(r.endMinute),
});

const timeOffSelect = { id: true, startTime: true, endTime: true, reason: true } as const;

const notFound = (what: string) =>
  new AppError(httpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, `${what} not found`);

/** A no-op write takes the doctor's row lock until the transaction ends. Phase 8 booking must do the same. */
async function lockDoctor(tx: Prisma.TransactionClient, doctorId: string) {
  await tx.doctor.update({
    where: { id: doctorId },
    data: { slotDurationMinutes: SLOT_DURATION_MINUTES },
  });
}

export async function getDoctorContext(userId: string) {
  const doctor = await prisma.doctor.findUnique({
    where: { userId },
    select: { id: true, clinic: { select: { timezone: true } } },
  });
  if (!doctor) throw notFound('Doctor profile');
  return { id: doctor.id, timezone: doctor.clinic.timezone };
}

async function assertNoOverlap(
  tx: Prisma.TransactionClient,
  doctorId: string,
  weekday: number,
  start: number,
  end: number,
  excludeId?: string,
) {
  const clash = await tx.availabilityRule.findFirst({
    where: {
      doctorId,
      weekday,
      startMinute: { lt: end },
      endMinute: { gt: start },
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    select: ruleSelect,
  });
  if (clash) {
    throw new AppError(
      httpStatus.CONFLICT,
      ErrorCode.AVAILABILITY_OVERLAP,
      `Overlaps an existing window (${hhmm(clash.startMinute)}-${hhmm(clash.endMinute)})`,
      { conflictingRule: toRuleDto(clash) },
    );
  }
}

export async function listRules(doctorId: string, timezone: string) {
  const rules = await prisma.availabilityRule.findMany({
    where: { doctorId },
    orderBy: [{ weekday: 'asc' }, { startMinute: 'asc' }],
    select: ruleSelect,
  });
  return { timezone, slotDurationMinutes: SLOT_DURATION_MINUTES, rules: rules.map(toRuleDto) };
}

export async function createRule(doctorId: string, input: CreateRuleBody) {
  const rule = await prisma.$transaction(async (tx) => {
    await lockDoctor(tx, doctorId);
    await assertNoOverlap(tx, doctorId, input.weekday, input.startMinute, input.endMinute);
    return tx.availabilityRule.create({ data: { doctorId, ...input }, select: ruleSelect });
  });
  await bumpSlotsVersion(doctorId);
  return toRuleDto(rule);
}

export async function updateRule(doctorId: string, id: string, input: UpdateRuleBody) {
  const rule = await prisma.$transaction(async (tx) => {
    await lockDoctor(tx, doctorId);
    const existing = await tx.availabilityRule.findFirst({
      where: { id, doctorId },
      select: ruleSelect,
    });
    if (!existing) throw notFound('Availability rule');
    const next = {
      weekday: input.weekday ?? existing.weekday,
      startMinute: input.startMinute ?? existing.startMinute,
      endMinute: input.endMinute ?? existing.endMinute,
    };
    if (next.startMinute >= next.endMinute) {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
        'endMinute must be greater than startMinute',
      );
    }
    await assertNoOverlap(tx, doctorId, next.weekday, next.startMinute, next.endMinute, id);
    return tx.availabilityRule.update({ where: { id }, data: next, select: ruleSelect });
  });
  await bumpSlotsVersion(doctorId);
  return toRuleDto(rule);
}

export async function deleteRule(doctorId: string, id: string) {
  const { count } = await prisma.availabilityRule.deleteMany({ where: { id, doctorId } });
  if (count === 0) throw notFound('Availability rule');
  await bumpSlotsVersion(doctorId);
}

export async function createTimeOff(doctorId: string, input: CreateTimeOffBody) {
  const created = await prisma.$transaction(async (tx) => {
    await lockDoctor(tx, doctorId);

    const overlap = await tx.timeOff.findFirst({
      where: { doctorId, startTime: { lt: input.endTime }, endTime: { gt: input.startTime } },
      select: timeOffSelect,
    });
    if (overlap) {
      throw new AppError(
        httpStatus.CONFLICT,
        ErrorCode.TIME_OFF_CONFLICT,
        'Overlaps existing time off',
        {
          conflictingTimeOff: overlap,
        },
      );
    }

    const booked = await tx.appointment.findMany({
      where: {
        doctorId,
        status: 'BOOKED',
        startTime: { lt: input.endTime },
        endTime: { gt: input.startTime },
      },
      orderBy: { startTime: 'asc' },
      take: 20,
      select: { id: true, startTime: true, endTime: true },
    });
    if (booked.length > 0) {
      throw new AppError(
        httpStatus.CONFLICT,
        ErrorCode.TIME_OFF_CONFLICT,
        'Booked appointments fall inside this period. Cancel them first.',
        { appointments: booked },
      );
    }

    return tx.timeOff.create({ data: { doctorId, ...input }, select: timeOffSelect });
  });
  await bumpSlotsVersion(doctorId);
  return created;
}

export async function listTimeOff(doctorId: string, q: ListTimeOffQuery) {
  const where: Prisma.TimeOffWhereInput = {
    doctorId,
    endTime: { gte: q.from ?? new Date() },
    ...(q.to ? { startTime: { lte: q.to } } : {}),
  };
  const [items, total] = await prisma.$transaction([
    prisma.timeOff.findMany({
      where,
      orderBy: { startTime: 'asc' },
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
      select: timeOffSelect,
    }),
    prisma.timeOff.count({ where }),
  ]);
  return { items, total };
}

export async function deleteTimeOff(doctorId: string, id: string) {
  const { count } = await prisma.timeOff.deleteMany({ where: { id, doctorId } });
  if (count === 0) throw notFound('Time off');
  await bumpSlotsVersion(doctorId);
}
