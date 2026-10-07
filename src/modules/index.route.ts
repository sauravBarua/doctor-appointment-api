import { Router } from 'express';
import { healthRouter } from './health/health.route.js';

export const apiRouter: Router = Router();

apiRouter.use('/health', healthRouter);
