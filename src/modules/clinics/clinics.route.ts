import { Router } from 'express';
import { requireAuth } from '../../middleware/requireAuth.js';
import { requireRole } from '../../middleware/requireRole.js';
import { multipartData } from '../../middleware/upload.js';
import { validate } from '../../middleware/validate.js';
import { idParams } from '../../utils/schemas.js';
import * as controller from './clinics.controller.js';
import {
  adminListQuery,
  createClinicBody,
  publicListQuery,
  updateClinicBody,
} from './clinics.schema.js';

export const clinicsPublicRouter: Router = Router();
clinicsPublicRouter.get('/', validate({ query: publicListQuery }), controller.listPublic);
clinicsPublicRouter.get('/:id', validate({ params: idParams }), controller.getPublic);

export const clinicsAdminRouter: Router = Router();
clinicsAdminRouter.use(requireAuth, requireRole('ADMIN'));
clinicsAdminRouter.get('/', validate({ query: adminListQuery }), controller.listAdmin);
clinicsAdminRouter.post(
  '/',
  multipartData(),
  validate({ body: createClinicBody }),
  controller.create,
);
clinicsAdminRouter.get('/:id', validate({ params: idParams }), controller.getAdmin);
clinicsAdminRouter.patch(
  '/:id',
  multipartData(),
  validate({ params: idParams, body: updateClinicBody }),
  controller.update,
);
clinicsAdminRouter.delete('/:id', validate({ params: idParams }), controller.remove);
