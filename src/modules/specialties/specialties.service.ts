import { randomUUID } from 'node:crypto';
import httpStatus from 'http-status';
import { prisma } from '../../config/prisma.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { uploadImageToCloudinary } from '../../lib/cloudinary.js';
import { AppError } from '../../utils/AppError.js';
import { ErrorCode } from '../../utils/errorCodes.js';
import { prismaErrorCode } from '../../utils/prismaErrors.js';
import { pageArgs } from '../../utils/schemas.js';
import type {
  AdminListQuery,
  CreateSpecialtyBody,
  UpdateSpecialtyBody,
} from './specialties.schema.js';

const select = {
  id: true,
  name: true,
  iconUrl: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.SpecialtySelect;

const notFound = () =>
  new AppError(httpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, 'Specialty not found');

function mapWriteError(err: unknown): never {
  switch (prismaErrorCode(err)) {
    case 'P2002':
      throw new AppError(
        httpStatus.CONFLICT,
        ErrorCode.ALREADY_EXISTS,
        'A specialty with this name already exists',
      );
    case 'P2003':
      throw new AppError(
        httpStatus.CONFLICT,
        ErrorCode.RESOURCE_IN_USE,
        'Specialty is in use. Deactivate it instead',
      );
    case 'P2025':
      throw notFound();
    default:
      throw err;
  }
}

async function assertNameFree(name: string, exceptId?: string) {
  const clash = await prisma.specialty.findFirst({
    where: {
      name: { equals: name, mode: 'insensitive' },
      ...(exceptId ? { id: { not: exceptId } } : {}),
    },
    select: { id: true },
  });
  if (clash) {
    throw new AppError(
      httpStatus.CONFLICT,
      ErrorCode.ALREADY_EXISTS,
      'A specialty with this name already exists',
    );
  }
}

export async function listSpecialties(q: AdminListQuery) {
  const where: Prisma.SpecialtyWhereInput = {
    ...(q.search ? { name: { contains: q.search, mode: 'insensitive' } } : {}),
    ...(q.isActive !== undefined ? { isActive: q.isActive } : {}),
  };
  const [total, items] = await prisma.$transaction([
    prisma.specialty.count({ where }),
    prisma.specialty.findMany({ where, select, orderBy: { name: 'asc' }, ...pageArgs(q) }),
  ]);
  return { items, total };
}

export async function getSpecialty(id: string, onlyActive = false) {
  const row = await prisma.specialty.findFirst({
    where: { id, ...(onlyActive ? { isActive: true } : {}) },
    select,
  });
  if (!row) throw notFound();
  return row;
}

export async function createSpecialty(body: CreateSpecialtyBody, file?: Express.Multer.File) {
  await assertNameFree(body.name);
  const id = randomUUID();
  const iconUrl = file
    ? await uploadImageToCloudinary(file.buffer, {
        folder: 'specialties',
        publicId: `specialty-${id}`,
      })
    : undefined;
  return prisma.specialty
    .create({ data: { id, name: body.name, iconUrl }, select })
    .catch(mapWriteError);
}

export async function updateSpecialty(
  id: string,
  body: UpdateSpecialtyBody,
  file?: Express.Multer.File,
) {
  await getSpecialty(id); // 404 before anything is uploaded
  if (body.name) await assertNameFree(body.name, id);
  const iconUrl = file
    ? await uploadImageToCloudinary(file.buffer, {
        folder: 'specialties',
        publicId: `specialty-${id}`,
      })
    : undefined;
  return prisma.specialty
    .update({ where: { id }, data: { name: body.name, isActive: body.isActive, iconUrl }, select })
    .catch(mapWriteError);
}

export async function deleteSpecialty(id: string) {
  const doctors = await prisma.doctor.count({ where: { specialtyId: id } });
  if (doctors > 0) {
    throw new AppError(
      httpStatus.CONFLICT,
      ErrorCode.RESOURCE_IN_USE,
      `Specialty is used by ${doctors} doctor(s). Deactivate it instead`,
    );
  }
  await prisma.specialty.delete({ where: { id } }).catch(mapWriteError);
}
