import type { Request, Response } from 'express';
import httpStatus from 'http-status';
import { getValidated } from '../../middleware/validate.js';
import { sendResponse } from '../../utils/sendResponse.js';
import type { ListNotificationsQuery } from './notifications.schema.js';
import * as service from './notifications.service.js';

type IdParams = { id: string };

// requireAuth guarantees req.user.
export async function list(req: Request, res: Response) {
  const { query } = getValidated<unknown, ListNotificationsQuery>(res);
  const { items, total } = await service.listNotifications(req.user!.id, query);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Notifications',
    meta: { page: query.page, pageSize: query.pageSize, total },
    data: items,
  });
}

export async function unreadCount(req: Request, res: Response) {
  const data = await service.unreadCount(req.user!.id);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Unread notifications',
    data,
  });
}

export async function markRead(req: Request, res: Response) {
  const { params } = getValidated<unknown, unknown, IdParams>(res);
  const data = await service.markRead(req.user!.id, params.id);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Notification marked as read',
    data,
  });
}

export async function markAllRead(req: Request, res: Response) {
  const data = await service.markAllRead(req.user!.id);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Notifications marked as read',
    data,
  });
}
