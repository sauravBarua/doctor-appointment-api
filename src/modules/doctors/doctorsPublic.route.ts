import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import * as controller from './doctorsPublic.controller.js';
import { idParams, searchDoctorsQuery, slotsQuery } from './doctorsPublic.schema.js';

export const doctorsPublicRouter = Router();

doctorsPublicRouter.get('/', validate({ query: searchDoctorsQuery }), controller.search);
doctorsPublicRouter.get('/:id', validate({ params: idParams }), controller.getOne);
doctorsPublicRouter.get(
  '/:id/slots',
  validate({ params: idParams, query: slotsQuery }),
  controller.slots,
);
