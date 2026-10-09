import { v2 as cloudinary, type UploadApiResponse } from 'cloudinary';
import httpStatus from 'http-status';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { AppError } from '../utils/AppError.js';
import { ErrorCode } from '../utils/errorCodes.js';

cloudinary.config({
  cloud_name: env.CLOUDINARY_CLOUD_NAME,
  api_key: env.CLOUDINARY_API_KEY,
  api_secret: env.CLOUDINARY_API_SECRET,
  secure: true,
});

/** Uploads to doctor-booking/<folder>/<publicId>. Same publicId overwrites, so no orphans. */
export async function uploadImageToCloudinary(
  buffer: Buffer,
  opts: { folder: string; publicId: string },
): Promise<string> {
  try {
    const result = await new Promise<UploadApiResponse>((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          folder: `doctor-booking/${opts.folder}`,
          public_id: opts.publicId,
          overwrite: true,
          invalidate: true,
          resource_type: 'image',
          allowed_formats: ['jpg', 'png', 'webp'],
          transformation: [{ width: 512, height: 512, crop: 'limit' }],
        },
        (error, res) => {
          if (error || !res) {
            reject(
              Object.assign(new Error(error?.message ?? 'Empty Cloudinary response'), {
                httpCode: error?.http_code,
              }),
            );
            return;
          }
          resolve(res);
        },
      );
      stream.end(buffer);
    });
    return result.secure_url;
  } catch (err) {
    logger.error({ err }, 'Cloudinary upload failed');
    // Cloudinary answers 400 when the bytes are not a valid image of an allowed format.
    if ((err as { httpCode?: number }).httpCode === httpStatus.BAD_REQUEST) {
      throw new AppError(httpStatus.BAD_REQUEST, ErrorCode.UPLOAD_ERROR, 'Invalid image file');
    }
    throw new AppError(httpStatus.BAD_GATEWAY, ErrorCode.UPLOAD_ERROR, 'Image upload failed');
  }
}
