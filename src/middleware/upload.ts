import type { RequestHandler } from 'express';
import httpStatus from 'http-status';
import multer from 'multer';
import { IMAGE_MIME_TYPES, MAX_IMAGE_BYTES } from '../config/constants.js';
import { AppError } from '../utils/AppError.js';
import { ErrorCode } from '../utils/errorCodes.js';

const allowed: readonly string[] = IMAGE_MIME_TYPES;

const parser = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
      return;
    }
    cb(
      new AppError(
        httpStatus.UNSUPPORTED_MEDIA_TYPE,
        ErrorCode.UPLOAD_ERROR,
        'Only JPEG, PNG or WebP images are allowed',
      ),
    );
  },
});

function mapUploadError(err: unknown, field: string): unknown {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return new AppError(
        httpStatus.REQUEST_ENTITY_TOO_LARGE,
        ErrorCode.PAYLOAD_TOO_LARGE,
        'Image must be 2 MB or smaller',
      );
    }
    return new AppError(
      httpStatus.BAD_REQUEST,
      ErrorCode.UPLOAD_ERROR,
      `Upload error: send at most one file, in the form field "${field}"`,
    );
  }
  return err;
}

function parseData(raw: unknown): Record<string, unknown> {
  const invalid = () =>
    new AppError(
      httpStatus.BAD_REQUEST,
      ErrorCode.VALIDATION_ERROR,
      'Form field "data" must contain a JSON object',
    );
  if (raw === undefined) return {};
  if (typeof raw !== 'string') throw invalid();
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // fall through to the error below
  }
  throw invalid();
}

/**
 * multipart/form-data: text field `data` (a JSON object) becomes req.body, file field `image` becomes req.file.
 * Any other content type (application/json) passes through untouched.
 */
export function multipartData(fileField = 'image'): RequestHandler {
  const handler = parser.single(fileField);
  return (req, res, next) => {
    if (!req.is('multipart/form-data')) {
      next();
      return;
    }
    handler(req, res, (err: unknown) => {
      if (err) {
        next(mapUploadError(err, fileField));
        return;
      }
      let body: Record<string, unknown>;
      try {
        body = parseData((req.body as Record<string, unknown> | undefined)?.data);
      } catch (parseErr) {
        next(parseErr);
        return;
      }
      req.body = body;
      next();
    });
  };
}

/** Call after validation: an update must change a field or replace the image. */
export function assertHasChanges(body: object, file?: Express.Multer.File): void {
  if (Object.keys(body).length === 0 && !file) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      ErrorCode.VALIDATION_ERROR,
      'Provide at least one field or an image',
    );
  }
}
