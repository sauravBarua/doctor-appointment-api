import { randomUUID } from 'node:crypto';
import { DateTime } from 'luxon';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/mailer.js', () => ({
  sendOtpEmail: async () => undefined,
  sendEmail: async () => undefined,
}));

import { app } from '../src/app.js';
import { prisma } from '../src/config/prisma.js';
import { redis } from '../src/config/redis.js';
import { loginAs } from './helpers/auth.js';
import { createVerifiedUser } from './helpers/users.js';

const run = randomUUID().slice(0, 8);
const doctorEmail = `pub-doc-${run}@example.com`;
const doctorName = `Slotty ${run}`;
const zone = 'Europe/Paris';
const base = '/api/v1/doctors';
let doctorId = '';
let clinicId = '';
let specialtyId = '';
let doctorToken = '';

// first Monday at least two days ahead, in clinic time
const monday = (() => {
  let d = DateTime.now().setZone(zone).plus({ days: 2 }).startOf('day');
  while (d.weekday !== 1) d = d.plus({ days: 1 });
  return d;
})();
const date = monday.toISODate()!;
const at = (hour: number, minute = 0) => monday.set({ hour, minute });

beforeAll(async () => {
  const d = await createVerifiedUser({ email: doctorEmail, role: 'DOCTOR' });
  await prisma.user.update({ where: { id: d.user.id }, data: { name: doctorName } });
  const clinic = await prisma.clinic.create({
    data: { name: `Pub ${run}`, city: `Testville ${run}`, address: '1 Rue Test', timezone: zone },
  });
  const specialty = await prisma.specialty.create({ data: { name: `Pub ${run}` } });
  clinicId = clinic.id;
  specialtyId = specialty.id;
  const doctor = await prisma.doctor.create({ data: { userId: d.user.id, clinicId, specialtyId } });
  doctorId = doctor.id;
  await prisma.availabilityRule.create({
    data: { doctorId, weekday: 1, startMinute: 540, endMinute: 660 },
  });
  doctorToken = (await loginAs(d.user.email, d.password)).accessToken;
});

afterAll(async () => {
  await prisma.timeOff.deleteMany({ where: { doctorId } });
  await prisma.availabilityRule.deleteMany({ where: { doctorId } });
  await prisma.doctor.deleteMany({ where: { id: doctorId } });
  await prisma.user.deleteMany({ where: { email: doctorEmail } });
  await prisma.clinic.deleteMany({ where: { id: clinicId } });
  await prisma.specialty.deleteMany({ where: { id: specialtyId } });
  await prisma.$disconnect();
  redis.disconnect();
});

describe('doctor search', () => {
  it('finds the doctor by name, with pagination meta and no email', async () => {
    const res = await request(app).get(base).query({ q: doctorName });
    expect(res.status).toBe(200);
    expect(res.body.meta).toMatchObject({ page: 1, total: 1 });
    expect(res.body.data[0]).toMatchObject({ id: doctorId, name: doctorName });
    expect(res.body.data[0].email).toBeUndefined();
  });

  it('filters by specialty, clinic and city', async () => {
    const ok = await request(app)
      .get(base)
      .query({ specialtyId, clinicId, city: `testville ${run}` });
    expect(ok.body.meta.total).toBe(1);
    const none = await request(app)
      .get(base)
      .query({ city: `nowhere-${run}` });
    expect(none.body.meta.total).toBe(0);
  });

  it('returns the profile, and 404 once the doctor is deactivated', async () => {
    const ok = await request(app).get(`${base}/${doctorId}`);
    expect(ok.status).toBe(200);
    expect(ok.body.data.clinic.timezone).toBe(zone);

    await prisma.doctor.update({ where: { id: doctorId }, data: { isActive: false } });
    const gone = await request(app).get(`${base}/${doctorId}`);
    await prisma.doctor.update({ where: { id: doctorId }, data: { isActive: true } });
    expect(gone.status).toBe(404);
  });
});

describe('slots', () => {
  const slotsUrl = () => `${base}/${doctorId}/slots`;

  it('returns four 30-minute slots for a 09:00-11:00 window', async () => {
    const res = await request(app).get(slotsUrl()).query({ from: date, to: date });
    expect(res.status).toBe(200);
    expect(res.body.data.timezone).toBe(zone);
    const slots = res.body.data.days[0].slots;
    expect(slots).toHaveLength(4);
    expect(DateTime.fromISO(slots[0].startTime).toMillis()).toBe(at(9).toMillis());
  });

  it('drops blocked slots right after time-off is created (cache invalidated)', async () => {
    const warm = await request(app).get(slotsUrl()).query({ from: date, to: date });
    expect(warm.body.data.days[0].slots).toHaveLength(4);

    const off = await request(app)
      .post('/api/v1/doctor/time-off')
      .set({ Authorization: `Bearer ${doctorToken}` })
      .send({ startTime: at(9, 30).toUTC().toISO(), endTime: at(10, 30).toUTC().toISO() });
    expect(off.status).toBe(201);

    const after = await request(app).get(slotsUrl()).query({ from: date, to: date });
    const starts = after.body.data.days[0].slots.map((s: { startTime: string }) =>
      DateTime.fromISO(s.startTime).toMillis(),
    );
    expect(starts).toEqual([at(9).toMillis(), at(10, 30).toMillis()]);
  });

  it('rejects bad ranges', async () => {
    const yesterday = DateTime.now().setZone(zone).minus({ days: 1 }).toISODate()!;
    const tooLong = monday.plus({ days: 20 }).toISODate()!;
    const tooFar = DateTime.now().setZone(zone).plus({ days: 90 }).toISODate()!;
    expect((await request(app).get(slotsUrl()).query({ from: yesterday })).status).toBe(400);
    expect((await request(app).get(slotsUrl()).query({ from: date, to: tooLong })).status).toBe(
      400,
    );
    expect((await request(app).get(slotsUrl()).query({ from: tooFar, to: tooFar })).status).toBe(
      400,
    );
  });
});
