import { randomUUID } from 'node:crypto';
import httpStatus from 'http-status';
import { TEMP_PASSWORD_TTL_HOURS } from '../../config/constants.js';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { prisma } from '../../config/prisma.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { uploadImageToCloudinary } from '../../lib/cloudinary.js';
import { sendEmail } from '../../lib/mailer.js';
import { hashPassword } from '../../lib/password.js';
import { AppError } from '../../utils/AppError.js';
import { ErrorCode } from '../../utils/errorCodes.js';
import { prismaErrorCode } from '../../utils/prismaErrors.js';
import { pageArgs } from '../../utils/schemas.js';
import { generateTempPassword } from '../../utils/tempPassword.js';
import type { AdminListQuery, CreateDoctorBody, UpdateDoctorBody } from './doctors.schema.js';

const select = {
  id: true,
  slotDurationMinutes: true,
  bio: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
  user: {
    select: {
      id: true,
      name: true,
      email: true,
      image: true,
      isActive: true,
      mustChangePassword: true,
    },
  },
  clinic: { select: { id: true, name: true, city: true, timezone: true } },
  specialty: { select: { id: true, name: true } },
} satisfies Prisma.DoctorSelect;

const notFound = () => new AppError(httpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, 'Doctor not found');
const emailTaken = () =>
  new AppError(
    httpStatus.CONFLICT,
    ErrorCode.EMAIL_ALREADY_REGISTERED,
    'Email is already registered',
  );

async function assertActiveSpecialty(id: string) {
  const row = await prisma.specialty.findFirst({
    where: { id, isActive: true },
    select: { id: true },
  });
  if (!row)
    throw new AppError(
      httpStatus.NOT_FOUND,
      ErrorCode.NOT_FOUND,
      'Specialty not found or inactive',
    );
}

export async function createDoctor(input: CreateDoctorBody, file?: Express.Multer.File) {
  const [clinic, specialty, existing] = await Promise.all([
    prisma.clinic.findFirst({
      where: { id: input.clinicId, isActive: true },
      select: { id: true },
    }),
    prisma.specialty.findFirst({
      where: { id: input.specialtyId, isActive: true },
      select: { id: true },
    }),
    prisma.user.findUnique({ where: { email: input.email }, select: { id: true } }),
  ]);
  if (!clinic)
    throw new AppError(httpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, 'Clinic not found or inactive');
  if (!specialty)
    throw new AppError(
      httpStatus.NOT_FOUND,
      ErrorCode.NOT_FOUND,
      'Specialty not found or inactive',
    );
  if (existing) throw emailTaken();

  const temporaryPassword = generateTempPassword();
  const passwordHash = await hashPassword(temporaryPassword);
  const userId = randomUUID();
  const image = file
    ? await uploadImageToCloudinary(file.buffer, { folder: 'users', publicId: `user-${userId}` })
    : undefined;
  const expiresAt = new Date(Date.now() + TEMP_PASSWORD_TTL_HOURS * 3_600_000);

  const doctor = await prisma
    .$transaction(async (tx) => {
      await tx.user.create({
        data: {
          id: userId,
          name: input.name,
          email: input.email,
          image,
          emailVerified: true,
          role: 'DOCTOR',
          mustChangePassword: true,
          tempPasswordExpiresAt: expiresAt,
        },
      });
      await tx.account.create({
        data: {
          id: randomUUID(),
          accountId: userId,
          providerId: 'credential',
          userId,
          password: passwordHash,
        },
      });
      return tx.doctor.create({
        data: {
          userId,
          clinicId: input.clinicId,
          specialtyId: input.specialtyId,
          slotDurationMinutes: input.slotDurationMinutes,
          bio: input.bio,
        },
        select,
      });
    })
    .catch((err: unknown) => {
      if (prismaErrorCode(err) === 'P2002') throw emailTaken();
      throw err;
    });

  let credentialsEmailed = true;
  try {
    await sendEmail({
      to: input.email,
      subject: 'Your doctor account',
      text: [
        `Hello ${input.name},`,
        '',
        'An administrator created a doctor account for you.',
        `Sign in at ${env.FRONTEND_URL}/login`,
        `Email: ${input.email}`,
        `Temporary password: ${temporaryPassword}`,
        '',
        `You must change this password at your first sign-in. It expires in ${TEMP_PASSWORD_TTL_HOURS} hours.`,
      ].join('\n'),
    });
  } catch (err) {
    credentialsEmailed = false;
    logger.error({ err, userId }, 'Failed to send doctor credentials email');
  }

  return {
    doctor,
    credentialsEmailed,
    ...(env.NODE_ENV !== 'production' ? { temporaryPassword } : {}),
  };
}

export async function listDoctors(q: AdminListQuery) {
  const where: Prisma.DoctorWhereInput = {
    ...(q.clinicId ? { clinicId: q.clinicId } : {}),
    ...(q.specialtyId ? { specialtyId: q.specialtyId } : {}),
    ...(q.isActive !== undefined ? { isActive: q.isActive } : {}),
    ...(q.search
      ? {
          user: {
            OR: [
              { name: { contains: q.search, mode: 'insensitive' } },
              { email: { contains: q.search, mode: 'insensitive' } },
            ],
          },
        }
      : {}),
  };
  const [total, items] = await prisma.$transaction([
    prisma.doctor.count({ where }),
    prisma.doctor.findMany({
      where,
      select,
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      ...pageArgs(q),
    }),
  ]);
  return { items, total };
}

export async function getDoctor(id: string) {
  const row = await prisma.doctor.findUnique({ where: { id }, select });
  if (!row) throw notFound();
  return row;
}

export async function updateDoctor(id: string, body: UpdateDoctorBody, file?: Express.Multer.File) {
  const existing = await prisma.doctor.findUnique({ where: { id }, select: { userId: true } });
  if (!existing) throw notFound();
  if (body.specialtyId) await assertActiveSpecialty(body.specialtyId);
  const image = file
    ? await uploadImageToCloudinary(file.buffer, {
        folder: 'users',
        publicId: `user-${existing.userId}`,
      })
    : undefined;

  return prisma.$transaction(async (tx) => {
    if (body.isActive !== undefined || image !== undefined) {
      await tx.user.update({
        where: { id: existing.userId },
        data: { isActive: body.isActive, image },
      });
      if (body.isActive === false) {
        await tx.session.deleteMany({ where: { userId: existing.userId } });
      }
    }
    return tx.doctor.update({
      where: { id },
      data: { specialtyId: body.specialtyId, bio: body.bio, isActive: body.isActive },
      select,
    });
  });
}
