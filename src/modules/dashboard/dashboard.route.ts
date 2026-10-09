import { Router } from 'express';
import { requireAuth } from '../../middleware/requireAuth.js';
import { requireRole } from '../../middleware/requireRole.js';
import * as controller from './dashboard.controller.js';

export const dashboardRouter = Router();

dashboardRouter.use(requireAuth);

dashboardRouter.get('/admin', requireRole('ADMIN'), controller.admin);
dashboardRouter.get('/doctor', requireRole('DOCTOR'), controller.doctor);
dashboardRouter.get('/patient', requireRole('PATIENT'), controller.patient);
