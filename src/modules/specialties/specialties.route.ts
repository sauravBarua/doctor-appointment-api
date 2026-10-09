import { Router } from 'express';
import { requireAuth } from '../../middleware/requireAuth.js';
import { requireRole } from '../../middleware/requireRole.js';
import { multipartData } from '../../middleware/upload.js';
import { validate } from '../../middleware/validate.js';
import { idParams } from '../../utils/schemas.js';
import * as controller from './specialties.controller.js';
import {
  adminListQuery,
  createSpecialtyBody,
  publicListQuery,
  updateSpecialtyBody,
} from './specialties.schema.js';

export const specialtiesPublicRouter: Router = Router();
specialtiesPublicRouter.get('/', validate({ query: publicListQuery }), controller.listPublic);
specialtiesPublicRouter.get('/:id', validate({ params: idParams }), controller.getPublic);

export const specialtiesAdminRouter: Router = Router();
specialtiesAdminRouter.use(requireAuth, requireRole('ADMIN'));
specialtiesAdminRouter.get('/', validate({ query: adminListQuery }), controller.listAdmin);
specialtiesAdminRouter.post(
  '/',
  multipartData(),
  validate({ body: createSpecialtyBody }),
  controller.create,
);
specialtiesAdminRouter.get('/:id', validate({ params: idParams }), controller.getAdmin);
specialtiesAdminRouter.patch(
  '/:id',
  multipartData(),
  validate({ params: idParams, body: updateSpecialtyBody }),
  controller.update,
);
specialtiesAdminRouter.delete('/:id', validate({ params: idParams }), controller.remove);
