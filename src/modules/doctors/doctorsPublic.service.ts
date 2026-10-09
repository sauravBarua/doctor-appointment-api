import { createHash } from 'node:crypto';
import httpStatus from 'http-status';
import { CACHE_TTL_SECONDS } from '../../config/constants.js';
import { prisma } from '../../config/prisma.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { cached } from '../../lib/cache.js';
import { AppError } from '../../utils/AppError.js';
import { ErrorCode } from '../../utils/errorCodes.js';
import type { SearchDoctorsQuery } from './doctorsPublic.schema.js';

const select = {
  id: true,
  bio: true,
  slotDurationMinutes: true,
  user: { select: { name: true, image: true } },
  specialty: { select: { id: true, name: true } },
  clinic: {
    select: { id: true, name: true, city: true, address: true, timezone: true, imageUrl: true },
  },
} satisfies Prisma.DoctorSelect;

type Row = Prisma.DoctorGetPayload<{ select: typeof select }>;

const toDto = (d: Row) => ({
  id: d.id,
  name: d.user.name,
  image: d.user.image,
  bio: d.bio,
  slotDurationMinutes: d.slotDurationMinutes,
  specialty: d.specialty,
  clinic: d.clinic,
});

const bookable: Prisma.DoctorWhereInput = { isActive: true, specialty: { isActive: true } };

export async function searchDoctors(q: SearchDoctorsQuery) {
  const fingerprint = JSON.stringify({
    q: q.q?.toLowerCase(),
    city: q.city?.toLowerCase(),
    s: q.specialtyId,
    c: q.clinicId,
    p: q.page,
    ps: q.pageSize,
  });
  const key = `doctors:search:${createHash('sha1').update(fingerprint).digest('hex')}`;

  return cached(key, CACHE_TTL_SECONDS, async () => {
    const where: Prisma.DoctorWhereInput = {
      ...bookable,
      ...(q.specialtyId ? { specialtyId: q.specialtyId } : {}),
      ...(q.clinicId ? { clinicId: q.clinicId } : {}),
      ...(q.city ? { clinic: { city: { equals: q.city, mode: 'insensitive' } } } : {}),
      ...(q.q ? { user: { name: { contains: q.q, mode: 'insensitive' } } } : {}),
    };
    const [rows, total] = await prisma.$transaction([
      prisma.doctor.findMany({
        where,
        select,
        orderBy: [{ user: { name: 'asc' } }, { id: 'asc' }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      prisma.doctor.count({ where }),
    ]);
    return { items: rows.map(toDto), total };
  });
}

export async function getDoctor(id: string) {
  const row = await prisma.doctor.findFirst({ where: { id, ...bookable }, select });
  if (!row) throw new AppError(httpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, 'Doctor not found');
  return toDto(row);
}
