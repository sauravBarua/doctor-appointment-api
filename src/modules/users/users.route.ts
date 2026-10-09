import { Router } from 'express';
import { requireAuth } from '../../middleware/requireAuth.js';
import { multipartData } from '../../middleware/upload.js';
import { validate } from '../../middleware/validate.js';
import * as controller from './users.controller.js';
import { updateProfileBody } from './users.schema.js';

export const usersRouter: Router = Router();

usersRouter.patch(
  '/me',
  requireAuth,
  multipartData(),
  validate({ body: updateProfileBody }),
  controller.updateMe,
);
