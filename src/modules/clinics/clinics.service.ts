import { randomUUID } from 'node:crypto';
import httpStatus from 'http-status';
import { prisma } from '../../config/prisma.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { uploadImageToCloudinary } from '../../lib/cloudinary.js';
import { AppError } from '../../utils/AppError.js';
import { ErrorCode } from '../../utils/errorCodes.js';
import { prismaErrorCode } from '../../utils/prismaErrors.js';
import { pageArgs } from '../../utils/schemas.js';
import type { AdminListQuery, CreateClinicBody, UpdateClinicBody } from './clinics.schema.js';

const select = {
  id: true,
  name: true,
  city: true,
  address: true,
  imageUrl: true,
  timezone: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ClinicSelect;

const notFound = () => new AppError(httpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, 'Clinic not found');

function mapWriteError(err: unknown): never {
  switch (prismaErrorCode(err)) {
    case 'P2003':
      throw new AppError(
        httpStatus.CONFLICT,
        ErrorCode.RESOURCE_IN_USE,
        'Clinic is in use. Deactivate it instead',
      );
    case 'P2025':
      throw notFound();
    default:
      throw err;
  }
}

export async function listClinics(q: AdminListQuery) {
  const where: Prisma.ClinicWhereInput = {
    ...(q.search ? { name: { contains: q.search, mode: 'insensitive' } } : {}),
    ...(q.city ? { city: { equals: q.city, mode: 'insensitive' } } : {}),
    ...(q.isActive !== undefined ? { isActive: q.isActive } : {}),
  };
  const [total, items] = await prisma.$transaction([
    prisma.clinic.count({ where }),
    prisma.clinic.findMany({
      where,
      select,
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      ...pageArgs(q),
    }),
  ]);
  return { items, total };
}

export async function getClinic(id: string, onlyActive = false) {
  const row = await prisma.clinic.findFirst({
    where: { id, ...(onlyActive ? { isActive: true } : {}) },
    select,
  });
  if (!row) throw notFound();
  return row;
}

export async function createClinic(body: CreateClinicBody, file?: Express.Multer.File) {
  const id = randomUUID();
  const imageUrl = file
    ? await uploadImageToCloudinary(file.buffer, { folder: 'clinics', publicId: `clinic-${id}` })
    : undefined;
  return prisma.clinic.create({ data: { id, ...body, imageUrl }, select });
}

export async function updateClinic(id: string, body: UpdateClinicBody, file?: Express.Multer.File) {
  const current = await getClinic(id);
  if (body.timezone && body.timezone !== current.timezone) {
    // Availability rules are stored as clinic-local minutes: changing the zone would shift them.
    const [rules, appointments] = await Promise.all([
      prisma.availabilityRule.count({ where: { doctor: { clinicId: id } } }),
      prisma.appointment.count({ where: { doctor: { clinicId: id } } }),
    ]);
    if (rules + appointments > 0) {
      throw new AppError(
        httpStatus.CONFLICT,
        ErrorCode.RESOURCE_IN_USE,
        'Timezone cannot change once doctors have availability or appointments',
      );
    }
  }
  const imageUrl = file
    ? await uploadImageToCloudinary(file.buffer, { folder: 'clinics', publicId: `clinic-${id}` })
    : undefined;
  return prisma.clinic
    .update({ where: { id }, data: { ...body, imageUrl }, select })
    .catch(mapWriteError);
}

export async function deleteClinic(id: string) {
  const doctors = await prisma.doctor.count({ where: { clinicId: id } });
  if (doctors > 0) {
    throw new AppError(
      httpStatus.CONFLICT,
      ErrorCode.RESOURCE_IN_USE,
      `Clinic has ${doctors} doctor(s). Deactivate it instead`,
    );
  }
  await prisma.clinic.delete({ where: { id } }).catch(mapWriteError);
}
