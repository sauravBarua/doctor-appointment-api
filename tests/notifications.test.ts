import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const sendEmail = vi.fn(async (..._args: unknown[]) => undefined);
vi.mock('../src/lib/mailer.js', () => ({
  sendOtpEmail: async () => undefined,
  sendEmail: (...args: unknown[]) => sendEmail(...args),
}));
const emitToUser = vi.fn();
vi.mock('../src/realtime/socket.js', () => ({
  emitToUser: (...args: unknown[]) => emitToUser(...args),
  attachRealtime: vi.fn(),
}));

import { app } from '../src/app.js';
import { prisma } from '../src/config/prisma.js';
import { redis } from '../src/config/redis.js';
import { processAppointmentEvent } from '../src/modules/notifications/notifications.handler.js';
import { loginAs } from './helpers/auth.js';
import { createVerifiedUser } from './helpers/users.js';

const run = randomUUID().slice(0, 8);
const base = '/api/v1/notifications';
const emails = {
  doctor: `note-doc-${run}@example.com`,
  patient: `note-pat-${run}@example.com`,
  other: `note-oth-${run}@example.com`,
};
let doctorUserId = '';
let patientId = '';
let doctorId = '';
let clinicId = '';
let specialtyId = '';
let appointmentId = '';
let patientToken = '';
let otherToken = '';
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

const event = (
  type: 'appointment.booked' | 'appointment.cancelled',
  actor: { id: string; role: 'PATIENT' | 'DOCTOR' | 'ADMIN' },
  reason?: string,
) => ({
  id: randomUUID(),
  type,
  occurredAt: new Date().toISOString(),
  appointmentId,
  actor,
  reason: reason ?? null,
});

beforeAll(async () => {
  const d = await createVerifiedUser({ email: emails.doctor, role: 'DOCTOR' });
  const p = await createVerifiedUser({ email: emails.patient });
  const o = await createVerifiedUser({ email: emails.other });
  doctorUserId = d.user.id;
  patientId = p.user.id;
  const clinic = await prisma.clinic.create({
    data: { name: `Note ${run}`, city: 'Paris', address: '1 Rue Test', timezone: 'Europe/Paris' },
  });
  const specialty = await prisma.specialty.create({ data: { name: `Note ${run}` } });
  clinicId = clinic.id;
  specialtyId = specialty.id;
  doctorId = (await prisma.doctor.create({ data: { userId: doctorUserId, clinicId, specialtyId } }))
    .id;
  const start = new Date(Date.now() + 2 * 86_400_000);
  appointmentId = (
    await prisma.appointment.create({
      data: {
        doctorId,
        patientId,
        startTime: start,
        endTime: new Date(start.getTime() + 1_800_000),
        status: 'BOOKED',
      },
    })
  ).id;
  patientToken = (await loginAs(p.user.email, p.password)).accessToken;
  otherToken = (await loginAs(o.user.email, o.password)).accessToken;
});

beforeEach(() => {
  sendEmail.mockClear();
  emitToUser.mockClear();
});

afterAll(async () => {
  await prisma.notification.deleteMany({
    where: { user: { email: { in: Object.values(emails) } } },
  });
  await prisma.appointment.deleteMany({ where: { doctorId } });
  await prisma.doctor.deleteMany({ where: { id: doctorId } });
  await prisma.user.deleteMany({ where: { email: { in: Object.values(emails) } } });
  await prisma.clinic.deleteMany({ where: { id: clinicId } });
  await prisma.specialty.deleteMany({ where: { id: specialtyId } });
  await prisma.$disconnect();
  redis.disconnect();
});

describe('consumer', () => {
  it('notifies patient and doctor of a booking by saving, pushing and emailing', async () => {
    await processAppointmentEvent(event('appointment.booked', { id: patientId, role: 'PATIENT' }));

    const rows = await prisma.notification.findMany({
      where: { userId: { in: [patientId, doctorUserId] } },
    });
    expect(rows.map((r) => r.userId).sort()).toEqual([patientId, doctorUserId].sort());
    expect(rows.every((r) => r.type === 'APPOINTMENT_BOOKED')).toBe(true);
    expect(emitToUser).toHaveBeenCalledTimes(2);
    expect(emitToUser).toHaveBeenCalledWith(
      patientId,
      'notification',
      expect.objectContaining({ title: 'Appointment confirmed' }),
    );
    expect(sendEmail).toHaveBeenCalledTimes(2);
  });

  it('does nothing when the same event is delivered twice', async () => {
    const e = event('appointment.booked', { id: patientId, role: 'PATIENT' });
    await processAppointmentEvent(e);
    emitToUser.mockClear();
    sendEmail.mockClear();

    await processAppointmentEvent(e);
    expect(emitToUser).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
    expect(await prisma.notification.count({ where: { eventId: e.id } })).toBe(2);
  });

  it('tells only the other side when a patient cancels, and both when an admin does', async () => {
    const byPatient = event(
      'appointment.cancelled',
      { id: patientId, role: 'PATIENT' },
      'Change of plans',
    );
    await processAppointmentEvent(byPatient);
    const rows = await prisma.notification.findMany({ where: { eventId: byPatient.id } });
    expect(rows.map((r) => r.userId)).toEqual([doctorUserId]);
    expect(rows[0]?.body).toContain('Reason: Change of plans');

    const byAdmin = event('appointment.cancelled', { id: randomUUID(), role: 'ADMIN' });
    await processAppointmentEvent(byAdmin);
    expect(await prisma.notification.count({ where: { eventId: byAdmin.id } })).toBe(2);
  });

  it('still saves the notification when the email fails', async () => {
    sendEmail.mockRejectedValueOnce(new Error('smtp down'));
    const e = event('appointment.booked', { id: patientId, role: 'PATIENT' });
    await expect(processAppointmentEvent(e)).resolves.toBeUndefined();
    expect(await prisma.notification.count({ where: { eventId: e.id } })).toBe(2);
  });

  it('rejects a malformed event so the broker can dead-letter it', async () => {
    await expect(processAppointmentEvent({ type: 'nope' })).rejects.toThrow();
  });
});

describe('notifications API', () => {
  it("lists the caller's notifications, newest first, with an unread filter and count", async () => {
    const list = await request(app).get(base).set(auth(patientToken));
    expect(list.status).toBe(200);
    expect(list.body.meta.total).toBeGreaterThan(0);
    expect(list.body.data.every((n: { readAt: unknown }) => n.readAt === null)).toBe(true);

    const count = await request(app).get(`${base}/unread-count`).set(auth(patientToken));
    expect(count.body.data.unread).toBe(list.body.meta.total);

    const stranger = await request(app).get(base).set(auth(otherToken));
    expect(stranger.body.meta.total).toBe(0);
  });

  it("marks one as read, hides others' notifications, then marks all", async () => {
    const first = (await request(app).get(base).set(auth(patientToken))).body.data[0].id as string;

    expect((await request(app).patch(`${base}/${first}/read`).set(auth(otherToken))).status).toBe(
      404,
    );

    const read = await request(app).patch(`${base}/${first}/read`).set(auth(patientToken));
    expect(read.status).toBe(200);
    expect(read.body.data.readAt).toEqual(expect.any(String));

    const unread = await request(app).get(base).query({ unread: 'true' }).set(auth(patientToken));
    expect(unread.body.data.map((n: { id: string }) => n.id)).not.toContain(first);

    const all = await request(app).post(`${base}/read-all`).set(auth(patientToken));
    expect(all.status).toBe(200);
    const after = await request(app).get(`${base}/unread-count`).set(auth(patientToken));
    expect(after.body.data.unread).toBe(0);
  });

  it('requires authentication', async () => {
    expect((await request(app).get(base)).status).toBe(401);
  });
});
