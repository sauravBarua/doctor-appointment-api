import { Router } from 'express';
import { authRouter } from './auth/auth.route.js';
import { healthRouter } from './health/health.route.js';
import { googleRouter } from './auth/google.route.js';
import { auditRouter } from './audit/audit.route.js';

export const apiRouter: Router = Router();

apiRouter.use('/health', healthRouter);
apiRouter.use('/auth', authRouter);
apiRouter.use('/auth/google', googleRouter);
apiRouter.use('/admin/audit-logs', auditRouter);
