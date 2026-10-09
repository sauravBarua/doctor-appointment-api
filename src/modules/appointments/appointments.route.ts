import { Router } from 'express';
import { bookingLimiter } from '../../middleware/rateLimiters.js';
import { requireAuth } from '../../middleware/requireAuth.js';
import { requireRole } from '../../middleware/requireRole.js';
import { validate } from '../../middleware/validate.js';
import * as controller from './appointments.controller.js';
import { bookBody, cancelBody, idParams, listQuery } from './appointments.schema.js';

export const appointmentsRouter = Router();

appointmentsRouter.use(requireAuth);

appointmentsRouter.post(
  '/',
  requireRole('PATIENT'),
  bookingLimiter,
  validate({ body: bookBody }),
  controller.book,
);
appointmentsRouter.get('/', validate({ query: listQuery }), controller.list);
appointmentsRouter.get('/:id', validate({ params: idParams }), controller.getOne);
appointmentsRouter.post(
  '/:id/cancel',
  validate({ params: idParams, body: cancelBody }),
  controller.cancel,
);
