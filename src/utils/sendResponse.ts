import type { Response } from 'express';

type Meta = { page?: number; pageSize?: number; total: number };
type ErrorPayload = { code: string; details?: unknown };

type SendResponseInput<T> = {
  statusCode: number;
  success: boolean;
  message: string;
  meta?: Meta;
  data?: T;
  error?: ErrorPayload;
};

export function sendResponse<T>(res: Response, input: SendResponseInput<T>) {
  res.status(input.statusCode).json({
    success: input.success,
    message: input.message,
    meta: input.meta ?? null,
    data: input.data ?? null,
    ...(input.error ? { error: input.error } : {}),
  });
}
