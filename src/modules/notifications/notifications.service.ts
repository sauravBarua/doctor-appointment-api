import httpStatus from 'http-status';
import { prisma } from '../../config/prisma.js';
import { AppError } from '../../utils/AppError.js';
import { ErrorCode } from '../../utils/errorCodes.js';
import type { ListNotificationsQuery } from './notifications.schema.js';

const select = {
  id: true,
  type: true,
  title: true,
  body: true,
  data: true,
  readAt: true,
  createdAt: true,
} as const;

export async function listNotifications(userId: string, q: ListNotificationsQuery) {
  const where = { userId, ...(q.unread ? { readAt: null } : {}) };
  const [items, total] = await prisma.$transaction([
    prisma.notification.findMany({
      where,
      select,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    }),
    prisma.notification.count({ where }),
  ]);
  return { items, total };
}

export async function unreadCount(userId: string) {
  return { unread: await prisma.notification.count({ where: { userId, readAt: null } }) };
}

export async function markRead(userId: string, id: string) {
  const existing = await prisma.notification.findFirst({ where: { id, userId }, select });
  if (!existing)
    throw new AppError(httpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, 'Notification not found');
  if (existing.readAt) return existing;
  return prisma.notification.update({ where: { id }, data: { readAt: new Date() }, select });
}

export async function markAllRead(userId: string) {
  const { count } = await prisma.notification.updateMany({
    where: { userId, readAt: null },
    data: { readAt: new Date() },
  });
  return { updated: count };
}
