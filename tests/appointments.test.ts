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
const base = '/api/v1/appointments';
const RACERS = 8;

let clinicId = '';
let specialtyId = '';
const emails: string[] = [];
const doctorIds: string[] = [];

// first Monday at least two days ahead, in clinic time
const monday = (() => {
  let d = DateTime.now().setZone(zone).plus({ days: 2 }).startOf('day');
  while (d.weekday !== 1) d = d.plus({ days: 1 });
  return d;
})();
const date = monday.toISODate()!;
const at = (hour: number, minute = 0) => monday.set({ hour, minute }).toUTC().toISO()!;
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

async function makeDoctor(label: string) {
  const email = `appt-doc-${label}-${run}@example.com`;
  emails.push(email);
  const u = await createVerifiedUser({ email, role: 'DOCTOR' });
  const doctor = await prisma.doctor.create({ data: { userId: u.user.id, clinicId, specialtyId } });
  await prisma.availabilityRule.create({
    data: { doctorId: doctor.id, weekday: 1, startMinute: 540, endMinute: 660 },
  });
  doctorIds.push(doctor.id);
  const token = (await loginAs(u.user.email, u.password)).accessToken;
  return { id: doctor.id, token };
}

async function makePatient(label: string) {
  const email = `appt-pat-${label}-${run}@example.com`;
  emails.push(email);
  const u = await createVerifiedUser({ email });
  const token = (await loginAs(u.user.email, u.password)).accessToken;
  return { id: u.user.id, token };
}

const book = (token: string, doctorId: string, startTime: string) =>
  request(app).post(base).set(auth(token)).send({ doctorId, startTime });

beforeAll(async () => {
  const clinic = await prisma.clinic.create({
    data: { name: `Appt ${run}`, city: 'Paris', address: '1 Rue Test', timezone: zone },
  });
  const specialty = await prisma.specialty.create({ data: { name: `Appt ${run}` } });
  clinicId = clinic.id;
  specialtyId = specialty.id;
});

afterAll(async () => {
  await prisma.appointment.deleteMany({ where: { doctorId: { in: doctorIds } } });
  await prisma.timeOff.deleteMany({ where: { doctorId: { in: doctorIds } } });
  await prisma.availabilityRule.deleteMany({ where: { doctorId: { in: doctorIds } } });
  await prisma.doctor.deleteMany({ where: { id: { in: doctorIds } } });
  await prisma.user.deleteMany({ where: { email: { in: emails } } });
  await prisma.clinic.deleteMany({ where: { id: clinicId } });
  await prisma.specialty.deleteMany({ where: { id: specialtyId } });
  await prisma.$disconnect();
  redis.disconnect();
});

describe('booking', () => {
  it('books a slot, shows Paris time and removes it from the slot list', async () => {
    const doc = await makeDoctor('book');
    const pat = await makePatient('book');

    const res = await book(pat.token, doc.id, at(9));
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ status: 'BOOKED', timezone: zone });
    expect(res.body.data.startLocal.startsWith(`${date}T09:00:00`)).toBe(true);

    const slots = await request(app)
      .get(`/api/v1/doctors/${doc.id}/slots`)
      .query({ from: date, to: date });
    expect(slots.body.data.days[0].slots).toHaveLength(3);
  });

  it('rejects a slot that is already taken, and a patient double-booking the same time', async () => {
    const docA = await makeDoctor('taken-a');
    const docB = await makeDoctor('taken-b');
    const p1 = await makePatient('taken-1');
    const p2 = await makePatient('taken-2');

    expect((await book(p1.token, docA.id, at(10))).status).toBe(201);
    const taken = await book(p2.token, docA.id, at(10));
    expect(taken.status).toBe(409);
    expect(taken.body.error.code).toBe('SLOT_TAKEN');

    const busy = await book(p1.token, docB.id, at(10));
    expect(busy.status).toBe(409);
    expect(busy.body.error.code).toBe('PATIENT_BUSY');
  });

  it('rejects times off the grid, outside the windows and in the past', async () => {
    const doc = await makeDoctor('invalid');
    const pat = await makePatient('invalid');
    for (const t of [
      at(9, 15),
      at(12),
      at(8, 30),
      DateTime.now().minus({ days: 1 }).toUTC().toISO()!,
    ]) {
      const res = await book(pat.token, doc.id, t);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_SLOT');
    }
  });

  it('rejects a slot inside time-off', async () => {
    const doc = await makeDoctor('off');
    const pat = await makePatient('off');
    await prisma.timeOff.create({
      data: { doctorId: doc.id, startTime: new Date(at(10, 30)), endTime: new Date(at(11)) },
    });
    const res = await book(pat.token, doc.id, at(10, 30));
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SLOT_UNAVAILABLE');
  });

  it('only patients can book, and only when signed in', async () => {
    const doc = await makeDoctor('roles');
    expect((await book(doc.token, doc.id, at(9))).status).toBe(403);
    expect(
      (
        await request(app)
          .post(base)
          .send({ doctorId: doc.id, startTime: at(9) })
      ).status,
    ).toBe(401);
  });
});

describe('race conditions', () => {
  it('lets exactly one of many simultaneous patients book the same slot', async () => {
    const doc = await makeDoctor('race');
    const patients = await Promise.all(
      Array.from({ length: RACERS }, (_, i) => makePatient(`race-${i}`)),
    );

    const results = await Promise.all(patients.map((p) => book(p.token, doc.id, at(9, 30))));
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([201, ...Array<number>(RACERS - 1).fill(409)]);
    for (const r of results.filter((x) => x.status === 409))
      expect(r.body.error.code).toBe('SLOT_TAKEN');

    const rows = await prisma.appointment.count({
      where: { doctorId: doc.id, status: 'BOOKED', startTime: new Date(at(9, 30)) },
    });
    expect(rows).toBe(1);
  });

  it('stops one patient booking two doctors at the same time', async () => {
    const docA = await makeDoctor('dual-a');
    const docB = await makeDoctor('dual-b');
    const pat = await makePatient('dual');

    const [a, b] = await Promise.all([
      book(pat.token, docA.id, at(9)),
      book(pat.token, docB.id, at(9)),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    const loser = a.status === 409 ? a : b;
    expect(loser.body.error.code).toBe('PATIENT_BUSY');
  });
});

describe('cancelling', () => {
  it('frees the slot so someone else can book it', async () => {
    const doc = await makeDoctor('cancel');
    const p1 = await makePatient('cancel-1');
    const p2 = await makePatient('cancel-2');

    const booked = await book(p1.token, doc.id, at(9));
    const id = booked.body.data.id as string;

    const cancelled = await request(app)
      .post(`${base}/${id}/cancel`)
      .set(auth(p1.token))
      .send({ reason: 'Change of plans' });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.data).toMatchObject({
      status: 'CANCELLED',
      cancelReason: 'Change of plans',
    });

    const slots = await request(app)
      .get(`/api/v1/doctors/${doc.id}/slots`)
      .query({ from: date, to: date });
    expect(slots.body.data.days[0].slots).toHaveLength(4);
    expect((await book(p2.token, doc.id, at(9))).status).toBe(201);
  });

  it('hides appointments from strangers and refuses a second cancel', async () => {
    const doc = await makeDoctor('perm');
    const otherDoc = await makeDoctor('perm-other');
    const owner = await makePatient('perm-owner');
    const stranger = await makePatient('perm-stranger');
    const id = (await book(owner.token, doc.id, at(10))).body.data.id as string;

    expect((await request(app).post(`${base}/${id}/cancel`).set(auth(stranger.token))).status).toBe(
      404,
    );
    expect((await request(app).get(`${base}/${id}`).set(auth(stranger.token))).status).toBe(404);
    expect((await request(app).post(`${base}/${id}/cancel`).set(auth(otherDoc.token))).status).toBe(
      404,
    );

    expect((await request(app).post(`${base}/${id}/cancel`).set(auth(doc.token))).status).toBe(200);
    const again = await request(app).post(`${base}/${id}/cancel`).set(auth(owner.token));
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('APPOINTMENT_NOT_CANCELLABLE');
  });

  it('lets only one of two simultaneous cancels win', async () => {
    const doc = await makeDoctor('dblcancel');
    const pat = await makePatient('dblcancel');
    const id = (await book(pat.token, doc.id, at(9))).body.data.id as string;

    const send = () => request(app).post(`${base}/${id}/cancel`).set(auth(pat.token)).send({});
    const results = await Promise.all([send(), send()]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
  });
});

describe('listing', () => {
  it('scopes the list to the caller', async () => {
    const doc = await makeDoctor('list');
    const mine = await makePatient('list-mine');
    const other = await makePatient('list-other');
    await book(mine.token, doc.id, at(9));
    await book(other.token, doc.id, at(9, 30));

    const patientList = await request(app).get(base).set(auth(mine.token));
    expect(patientList.status).toBe(200);
    expect(patientList.body.meta.total).toBe(1);
    expect(patientList.body.data[0].patient.id).toBe(mine.id);

    const doctorList = await request(app).get(base).set(auth(doc.token));
    expect(doctorList.body.meta.total).toBe(2);

    const filtered = await request(app)
      .get(base)
      .query({ status: 'CANCELLED' })
      .set(auth(mine.token));
    expect(filtered.body.meta.total).toBe(0);
  });
});

describe('booking limiter', () => {
  it('limits per user: 429 after 20 attempts, while other users are unaffected', async () => {
    const pat = await makePatient('limit');
    const other = await makePatient('limit-other');
    let last = 0;
    for (let i = 0; i < 21; i++) {
      last = (await request(app).post(base).set(auth(pat.token)).send({})).status;
    }
    expect(last).toBe(429);

    const fresh = await request(app).post(base).set(auth(other.token)).send({});
    expect(fresh.status).toBe(400); // validation error, not 429
  });
});
