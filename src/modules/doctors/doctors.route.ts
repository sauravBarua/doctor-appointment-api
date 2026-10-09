import { Router } from 'express';
import { requireAuth } from '../../middleware/requireAuth.js';
import { requireRole } from '../../middleware/requireRole.js';
import { multipartData } from '../../middleware/upload.js';
import { validate } from '../../middleware/validate.js';
import { idParams } from '../../utils/schemas.js';
import * as controller from './doctors.controller.js';
import { adminListQuery, createDoctorBody, updateDoctorBody } from './doctors.schema.js';

export const doctorsAdminRouter: Router = Router();
doctorsAdminRouter.use(requireAuth, requireRole('ADMIN'));
doctorsAdminRouter.post(
  '/',
  multipartData(),
  validate({ body: createDoctorBody }),
  controller.create,
);
doctorsAdminRouter.get('/', validate({ query: adminListQuery }), controller.list);
doctorsAdminRouter.get('/:id', validate({ params: idParams }), controller.get);
doctorsAdminRouter.patch(
  '/:id',
  multipartData(),
  validate({ params: idParams, body: updateDoctorBody }),
  controller.update,
);
