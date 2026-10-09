import type { Request, Response } from 'express';
import httpStatus from 'http-status';
import { getValidated } from '../../middleware/validate.js';
import { sendResponse } from '../../utils/sendResponse.js';
import { getSlots } from '../slots/slots.service.js';
import type { SearchDoctorsQuery, SlotsQuery } from './doctorsPublic.schema.js';
import * as service from './doctorsPublic.service.js';

type IdParams = { id: string };

export async function search(_req: Request, res: Response) {
  const { query } = getValidated<unknown, SearchDoctorsQuery>(res);
  const { items, total } = await service.searchDoctors(query);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Doctors',
    meta: { page: query.page, pageSize: query.pageSize, total },
    data: items,
  });
}

export async function getOne(_req: Request, res: Response) {
  const { params } = getValidated<unknown, unknown, IdParams>(res);
  const data = await service.getDoctor(params.id);
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Doctor', data });
}

export async function slots(_req: Request, res: Response) {
  const { params, query } = getValidated<unknown, SlotsQuery, IdParams>(res);
  const data = await getSlots(params.id, query);
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Available slots', data });
}
