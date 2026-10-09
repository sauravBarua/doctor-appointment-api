import httpStatus from 'http-status';
import { prisma } from '../../config/prisma.js';
import type { Role } from '../../generated/prisma/client.js';
import { uploadImageToCloudinary } from '../../lib/cloudinary.js';
import { AppError } from '../../utils/AppError.js';
import { ErrorCode } from '../../utils/errorCodes.js';
import { me } from '../auth/auth.service.js';
import type { UpdateProfileBody } from './users.schema.js';

export async function updateMyProfile(
  userId: string,
  role: Role,
  body: UpdateProfileBody,
  file?: Express.Multer.File,
) {
  if (body.bio !== undefined && role !== 'DOCTOR') {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      ErrorCode.VALIDATION_ERROR,
      'Only doctors can set a bio',
    );
  }
  const image = file
    ? await uploadImageToCloudinary(file.buffer, { folder: 'users', publicId: `user-${userId}` })
    : undefined;

  await prisma.$transaction(async (tx) => {
    if (body.name !== undefined || image !== undefined) {
      await tx.user.update({ where: { id: userId }, data: { name: body.name, image } });
    }
    if (body.bio !== undefined) {
      await tx.doctor.update({ where: { userId }, data: { bio: body.bio } });
    }
  });

  return me(userId);
}
