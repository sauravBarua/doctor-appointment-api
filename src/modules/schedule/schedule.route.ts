import { Router } from 'express';
import { requireAuth } from '../../middleware/requireAuth.js';
import { requireRole } from '../../middleware/requireRole.js';
import { validate } from '../../middleware/validate.js';
import * as controller from './schedule.controller.js';
import {
  createRuleBody,
  createTimeOffBody,
  idParams,
  listTimeOffQuery,
  updateRuleBody,
} from './schedule.schema.js';

export const scheduleRouter = Router();

scheduleRouter.use(requireAuth, requireRole('DOCTOR'));

scheduleRouter.get('/availability', controller.listRules);
scheduleRouter.post('/availability', validate({ body: createRuleBody }), controller.createRule);
scheduleRouter.patch(
  '/availability/:id',
  validate({ params: idParams, body: updateRuleBody }),
  controller.updateRule,
);
scheduleRouter.delete('/availability/:id', validate({ params: idParams }), controller.deleteRule);

scheduleRouter.get('/time-off', validate({ query: listTimeOffQuery }), controller.listTimeOff);
scheduleRouter.post('/time-off', validate({ body: createTimeOffBody }), controller.createTimeOff);
scheduleRouter.delete('/time-off/:id', validate({ params: idParams }), controller.deleteTimeOff);
