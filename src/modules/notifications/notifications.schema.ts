import { z } from 'zod';
import { booleanQuery, idParams, paginationShape } from '../../utils/schemas.js';

export { idParams };

export const listNotificationsQuery = z.object({
  ...paginationShape,
  unread: booleanQuery.optional(),
});

export type ListNotificationsQuery = z.infer<typeof listNotificationsQuery>;
