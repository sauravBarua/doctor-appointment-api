import { Router } from 'express';
import { auditRouter } from './audit/audit.route.js';
import { authRouter } from './auth/auth.route.js';
import { googleRouter } from './auth/google.route.js';
import { clinicsAdminRouter, clinicsPublicRouter } from './clinics/clinics.route.js';
import { doctorsAdminRouter } from './doctors/doctors.route.js';
import { healthRouter } from './health/health.route.js';
import {
  specialtiesAdminRouter,
  specialtiesPublicRouter,
} from './specialties/specialties.route.js';
import { usersRouter } from './users/users.route.js';
import { scheduleRouter } from './schedule/schedule.route.js';
import { doctorsPublicRouter } from './doctors/doctorsPublic.route.js';

export const apiRouter: Router = Router();

apiRouter.use('/health', healthRouter);
apiRouter.use('/auth', authRouter);
apiRouter.use('/auth/google', googleRouter);
apiRouter.use('/users', usersRouter);
apiRouter.use('/specialties', specialtiesPublicRouter);
apiRouter.use('/clinics', clinicsPublicRouter);
apiRouter.use('/admin/audit-logs', auditRouter);
apiRouter.use('/admin/specialties', specialtiesAdminRouter);
apiRouter.use('/admin/clinics', clinicsAdminRouter);
apiRouter.use('/admin/doctors', doctorsAdminRouter);
apiRouter.use('/doctor', scheduleRouter);
apiRouter.use('/doctors', doctorsPublicRouter);
