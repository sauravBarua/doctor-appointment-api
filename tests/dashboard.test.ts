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
const zone = 'Europe/Paris';
const base = '/api/v1/dashboard';
const doctorEmail = `dash-doc-${run}@example.com`;
const patientEmail = `dash-pat-${run}@example.com`;

let clinicId = '';
let specialtyId = '';
let doctorId = '';
let doctorToken = '';
let patientToken = '';
let adminToken = '';
const appt: Record<'a1' | 'a2' | 'cancelled' | 'past', string> = {
  a1: '',
  a2: '',
  cancelled: '',
  past: '',
};

const tomorrow = DateTime.now().setZone(zone).plus({ days: 1 }).startOf('day');
const yesterday = tomorrow.minus({ days: 2 });
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const get = (role: string, token: string) => request(app).get(`${base}/${role}`).set(auth(token));

async function makeAppointment(start: DateTime, status: 'BOOKED' | 'CANCELLED', patientId: string) {
  const row = await prisma.appointment.create({
    data: {
      doctorId,
      patientId,
      startTime: start.toJSDate(),
      endTime: start.plus({ minutes: 30 }).toJSDate(),
      status,
    },
  });
  return row.id;
}

beforeAll(async () => {
  const d = await createVerifiedUser({ email: doctorEmail, role: 'DOCTOR' });
  const p = await createVerifiedUser({ email: patientEmail });
  const clinic = await prisma.clinic.create({
    data: { name: `Dash ${run}`, city: 'Paris', address: '1 Rue Test', timezone: zone },
  });
  const specialty = await prisma.specialty.create({ data: { name: `Dash ${run}` } });
  clinicId = clinic.id;
  specialtyId = specialty.id;
  doctorId = (await prisma.doctor.create({ data: { userId: d.user.id, clinicId, specialtyId } }))
    .id;

  appt.a1 = await makeAppointment(tomorrow.set({ hour: 9 }), 'BOOKED', p.user.id);
  appt.a2 = await makeAppointment(tomorrow.set({ hour: 9, minute: 30 }), 'BOOKED', p.user.id);
  appt.cancelled = await makeAppointment(tomorrow.set({ hour: 10 }), 'CANCELLED', p.user.id);
  appt.past = await makeAppointment(yesterday.set({ hour: 9 }), 'BOOKED', p.user.id);

  doctorToken = (await loginAs(d.user.email, d.password)).accessToken;
  patientToken = (await loginAs(p.user.email, p.password)).accessToken;
  const adminEmail = process.env.ADMIN_EMAIL;
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminEmail || !adminPassword)
    throw new Error('ADMIN_EMAIL and ADMIN_PASSWORD must be set in .env');
  adminToken = (await loginAs(adminEmail, adminPassword)).accessToken;
});

afterAll(async () => {
  await prisma.appointment.deleteMany({ where: { doctorId } });
  await prisma.doctor.deleteMany({ where: { id: doctorId } });
  await prisma.user.deleteMany({ where: { email: { in: [doctorEmail, patientEmail] } } });
  await prisma.clinic.deleteMany({ where: { id: clinicId } });
  await prisma.specialty.deleteMany({ where: { id: specialtyId } });
  await prisma.$disconnect();
  redis.disconnect();
});

describe('dashboards', () => {
  it('patient: next appointment, upcoming list and counts', async () => {
    const res = await get('patient', patientToken);
    expect(res.status).toBe(200);
    const d = res.body.data;
    expect(d.timezone).toBe(zone);
    expect(d.counts).toEqual({ upcoming: 2, past: 1, cancelled: 1 });
    expect(d.nextAppointment.id).toBe(appt.a1);
    expect(d.upcoming).toHaveLength(2);
  });

  it('doctor: counts, 7-day view, patients served', async () => {
    const res = await get('doctor', doctorToken);
    expect(res.status).toBe(200);
    const d = res.body.data;
    expect(d.upcoming).toBe(2);
    expect(d.byStatus).toEqual({ BOOKED: 3, CANCELLED: 1, COMPLETED: 0 });
    expect(d.next7Days).toHaveLength(7);
    expect(d.next7Days.reduce((n: number, x: { count: number }) => n + x.count, 0)).toBe(2);
    expect(d.patientsServed).toBe(1);
    expect(d.upcomingTimeOff).toBe(0);
    expect(d.nextAppointment.id).toBe(appt.a1);
  });

  it('admin: platform blocks, a 30-day series and a safe activity feed', async () => {
    const res = await get('admin', adminToken);
    expect(res.status).toBe(200);
    const d = res.body.data;
    expect(d.users.patients).toBeGreaterThanOrEqual(1);
    expect(d.appointments.byStatus.BOOKED).toBeGreaterThanOrEqual(3);
    expect(d.dailyBookings).toHaveLength(30);
    expect(d.recentActivity.length).toBeLessThanOrEqual(10);
    for (const a of d.recentActivity) {
      expect(a).not.toHaveProperty('ip');
      expect(a).not.toHaveProperty('metadata');
      expect(a).not.toHaveProperty('userAgent');
    }
  });

  it('enforces roles', async () => {
    expect((await get('admin', patientToken)).status).toBe(403);
    expect((await get('patient', doctorToken)).status).toBe(403);
    expect((await get('doctor', adminToken)).status).toBe(403);
    expect((await request(app).get(`${base}/patient`)).status).toBe(401);
  });

  it('serves from the cache, and a cancellation refreshes the affected dashboards', async () => {
    const first = await get('patient', patientToken);
    const second = await get('patient', patientToken);
    expect(second.body.data.generatedAt).toBe(first.body.data.generatedAt);

    const cancel = await request(app)
      .post(`/api/v1/appointments/${appt.a2}/cancel`)
      .set(auth(patientToken))
      .send({});
    expect(cancel.status).toBe(200);

    const third = await get('patient', patientToken);
    expect(third.body.data.counts).toEqual({ upcoming: 1, past: 1, cancelled: 2 });
    expect(third.body.data.generatedAt).not.toBe(first.body.data.generatedAt);

    const doctor = await get('doctor', doctorToken);
    expect(doctor.body.data.upcoming).toBe(1);
  });
});
