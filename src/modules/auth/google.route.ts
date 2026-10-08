import { Router } from 'express';
import { googleLimiter } from '../../middleware/rateLimiters.js';
import { validate } from '../../middleware/validate.js';
import * as controller from './google.controller.js';
import { googleErrorQuery, googleExchangeBody } from './google.schema.js';

export const googleRouter: Router = Router();

googleRouter.get('/', googleLimiter, controller.googleSignIn);
googleRouter.get('/signup', googleLimiter, controller.googleSignUp);
googleRouter.get('/success', controller.googleSuccess);
googleRouter.get('/error', validate({ query: googleErrorQuery }), controller.googleError);
googleRouter.post(
  '/exchange',
  googleLimiter,
  validate({ body: googleExchangeBody }),
  controller.googleExchange,
);
