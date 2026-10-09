import { Router } from 'express';
import { requireAuth } from '../../middleware/requireAuth.js';
import { validate } from '../../middleware/validate.js';
import * as controller from './notifications.controller.js';
import { idParams, listNotificationsQuery } from './notifications.schema.js';

export const notificationsRouter = Router();

notificationsRouter.use(requireAuth);

notificationsRouter.get('/', validate({ query: listNotificationsQuery }), controller.list);
notificationsRouter.get('/unread-count', controller.unreadCount);
notificationsRouter.post('/read-all', controller.markAllRead);
notificationsRouter.patch('/:id/read', validate({ params: idParams }), controller.markRead);
