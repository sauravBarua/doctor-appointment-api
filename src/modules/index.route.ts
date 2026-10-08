import { Router } from 'express';
import { authRouter } from './auth/auth.route.js';
import { healthRouter } from './health/health.route.js';

export const apiRouter: Router = Router();

apiRouter.use('/health', healthRouter);
apiRouter.use('/auth', authRouter);
