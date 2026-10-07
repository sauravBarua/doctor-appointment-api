import type { RequestHandler, Response } from 'express';
import httpStatus from 'http-status';
import type { ZodType } from 'zod';
import { ErrorCode } from '../utils/errorCodes.js';
import { sendResponse } from '../utils/sendResponse.js';

const SOURCES = ['params', 'query', 'body'] as const;
type Source = (typeof SOURCES)[number];
type Schemas = Partial<Record<Source, ZodType>>;

export type Validated<B = unknown, Q = unknown, P = unknown> = { body: B; query: Q; params: P };

export function validate(schemas: Schemas): RequestHandler {
  return (req, res, next) => {
    const parsed: Partial<Record<Source, unknown>> = {};
    const details: { source: Source; field: string; message: string }[] = [];

    for (const source of SOURCES) {
      const schema = schemas[source];
      if (!schema) continue;
      const result = schema.safeParse(req[source]);
      if (result.success) {
        parsed[source] = result.data;
      } else {
        for (const issue of result.error.issues) {
          details.push({ source, field: issue.path.map(String).join('.'), message: issue.message });
        }
      }
    }

    if (details.length > 0) {
      sendResponse(res, {
        statusCode: httpStatus.BAD_REQUEST,
        success: false,
        message: 'Validation failed',
        error: { code: ErrorCode.VALIDATION_ERROR, details },
      });
      return;
    }

    // Express 5 makes req.query read-only, so parsed values live on res.locals.
    res.locals.validated = parsed;
    next();
  };
}

export function getValidated<B = unknown, Q = unknown, P = unknown>(
  res: Response,
): Validated<B, Q, P> {
  return res.locals.validated as Validated<B, Q, P>;
}
