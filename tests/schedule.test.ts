import { randomUUID } from 'node:crypto';
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
const doctorEmail = `sched-doc-${run}@example.com`;
const patientEmail = `sched-pat-${run}@example.com`;
const base = '/api/v1/doctor';
let doctorToken = '';
let patientToken = '';
let doctorId = '';
let patientId = '';
let clinicId = '';
let specialtyId = '';

const doc = () => ({ Authorization: `Bearer ${doctorToken}` });
const day = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString();

beforeAll(async () => {
  const d = await createVerifiedUser({ email: doctorEmail, role: 'DOCTOR' });
  const p = await createVerifiedUser({ email: patientEmail });
  patientId = p.user.id;
  const clinic = await prisma.clinic.create({
    data: { name: `Sched ${run}`, city: 'Paris', address: '1 Rue Test', timezone: 'Europe/Paris' },
  });
  const specialty = await prisma.specialty.create({ data: { name: `Sched ${run}` } });
  clinicId = clinic.id;
  specialtyId = specialty.id;
  const doctor = await prisma.doctor.create({ data: { userId: d.user.id, clinicId, specialtyId } });
  doctorId = doctor.id;
  doctorToken = (await loginAs(d.user.email, d.password)).accessToken;
  patientToken = (await loginAs(p.user.email, p.password)).accessToken;
});

afterAll(async () => {
  await prisma.appointment.deleteMany({ where: { doctorId } });
  await prisma.timeOff.deleteMany({ where: { doctorId } });
  await prisma.availabilityRule.deleteMany({ where: { doctorId } });
  await prisma.doctor.deleteMany({ where: { id: doctorId } });
  await prisma.user.deleteMany({ where: { email: { in: [doctorEmail, patientEmail] } } });
  await prisma.clinic.deleteMany({ where: { id: clinicId } });
  await prisma.specialty.deleteMany({ where: { id: specialtyId } });
  await prisma.$disconnect();
  redis.disconnect();
});

describe('availability rules', () => {
  let firstId = '';
  let secondId = '';

  it('creates a rule and returns HH:MM labels', async () => {
    const res = await request(app)
      .post(`${base}/availability`)
      .set(doc())
      .send({ weekday: 1, startMinute: 540, endMinute: 720 });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ weekday: 1, start: '09:00', end: '12:00' });
    firstId = res.body.data.id;
  });

  it('allows an adjacent window', async () => {
    const res = await request(app)
      .post(`${base}/availability`)
      .set(doc())
      .send({ weekday: 1, startMinute: 720, endMinute: 900 });
    expect(res.status).toBe(201);
    secondId = res.body.data.id;
  });

  it('rejects an overlapping window with 409', async () => {
    const res = await request(app)
      .post(`${base}/availability`)
      .set(doc())
      .send({ weekday: 1, startMinute: 600, endMinute: 660 });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('AVAILABILITY_OVERLAP');
  });

  it('rejects minutes that are not multiples of 30', async () => {
    const res = await request(app)
      .post(`${base}/availability`)
      .set(doc())
      .send({ weekday: 2, startMinute: 545, endMinute: 720 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('lists rules with the clinic timezone and 30-minute slots', async () => {
    const res = await request(app).get(`${base}/availability`).set(doc());
    expect(res.status).toBe(200);
    expect(res.body.data.timezone).toBe('Europe/Paris');
    expect(res.body.data.slotDurationMinutes).toBe(30);
    expect(res.body.data.rules).toHaveLength(2);
  });

  it('moves a rule to another weekday, and rejects a move that overlaps', async () => {
    const ok = await request(app)
      .patch(`${base}/availability/${secondId}`)
      .set(doc())
      .send({ weekday: 2 });
    expect(ok.status).toBe(200);
    expect(ok.body.data.weekday).toBe(2);
    const clash = await request(app)
      .patch(`${base}/availability/${secondId}`)
      .set(doc())
      .send({ weekday: 1, startMinute: 600 });
    expect(clash.status).toBe(409);
  });

  it('only one of two parallel identical creates succeeds', async () => {
    const send = () =>
      request(app)
        .post(`${base}/availability`)
        .set(doc())
        .send({ weekday: 5, startMinute: 480, endMinute: 600 });
    const results = await Promise.all([send(), send()]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
  });

  it('deletes a rule, then 404s on the same id', async () => {
    expect((await request(app).delete(`${base}/availability/${firstId}`).set(doc())).status).toBe(
      200,
    );
    expect((await request(app).delete(`${base}/availability/${firstId}`).set(doc())).status).toBe(
      404,
    );
  });

  it('blocks non-doctors and anonymous callers', async () => {
    expect((await request(app).get(`${base}/availability`)).status).toBe(401);
    const res = await request(app)
      .get(`${base}/availability`)
      .set({ Authorization: `Bearer ${patientToken}` });
    expect(res.status).toBe(403);
  });
});

describe('time-off', () => {
  const start = Date.now() + 7 * day;
  let id = '';

  it('creates time off and lists it as upcoming with meta', async () => {
    const res = await request(app)
      .post(`${base}/time-off`)
      .set(doc())
      .send({ startTime: iso(start), endTime: iso(start + 2 * 3_600_000), reason: 'Conference' });
    expect(res.status).toBe(201);
    id = res.body.data.id;
    const list = await request(app).get(`${base}/time-off`).set(doc());
    expect(list.status).toBe(200);
    expect(list.body.meta.total).toBe(1);
  });

  it('rejects overlapping time off', async () => {
    const res = await request(app)
      .post(`${base}/time-off`)
      .set(doc())
      .send({ startTime: iso(start + 3_600_000), endTime: iso(start + 3 * 3_600_000) });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('TIME_OFF_CONFLICT');
  });

  it('rejects an end before the start, and time off that is already over', async () => {
    const a = await request(app)
      .post(`${base}/time-off`)
      .set(doc())
      .send({ startTime: iso(start), endTime: iso(start - 1000) });
    const b = await request(app)
      .post(`${base}/time-off`)
      .set(doc())
      .send({ startTime: iso(Date.now() - 2 * day), endTime: iso(Date.now() - day) });
    expect([a.status, b.status]).toEqual([400, 400]);
  });

  it('rejects time off over a booked appointment and lists the conflict', async () => {
    const s = start + 3 * day;
    await prisma.appointment.create({
      data: {
        doctorId,
        patientId,
        startTime: new Date(s),
        endTime: new Date(s + 1_800_000),
        status: 'BOOKED',
      },
    });
    const res = await request(app)
      .post(`${base}/time-off`)
      .set(doc())
      .send({ startTime: iso(s - 3_600_000), endTime: iso(s + 3_600_000) });
    expect(res.status).toBe(409);
    expect(res.body.error.details.appointments).toHaveLength(1);
  });

  it('deletes time off, then 404s', async () => {
    expect((await request(app).delete(`${base}/time-off/${id}`).set(doc())).status).toBe(200);
    expect((await request(app).delete(`${base}/time-off/${id}`).set(doc())).status).toBe(404);
  });
});
