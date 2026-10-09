import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { DateTime } from 'luxon';
import { app } from '../src/app.js';
import { prisma } from '../src/config/prisma.js';
import { loginAs } from './helpers/auth.js';
import { createVerifiedUser } from './helpers/users.js';

vi.mock('../src/lib/mailer.js');
vi.mock('../src/lib/cloudinary.js');

const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

describe('end-to-end booking journey', () => {
  it('admin sets up → doctor opens hours → patient books → dashboards → cancel → slot reopens', async () => {
    if (!ADMIN_EMAIL || !ADMIN_PASSWORD)
      throw new Error('ADMIN_EMAIL/ADMIN_PASSWORD missing in test env');
    const stamp = Date.now();

    // 1. Admin creates specialty, clinic, doctor (multipart)
    const admin = await loginAs(ADMIN_EMAIL, ADMIN_PASSWORD);
    const specialty = await request(app)
      .post('/api/v1/admin/specialties')
      .set(bearer(admin.accessToken))
      .field('data', JSON.stringify({ name: `E2E Cardio ${stamp}` }));
    expect(specialty.status).toBe(201);

    const clinic = await request(app)
      .post('/api/v1/admin/clinics')
      .set(bearer(admin.accessToken))
      .field(
        'data',
        JSON.stringify({
          name: `E2E Clinic ${stamp}`,
          city: 'Paris',
          address: '1 Rue Test',
          timezone: 'Europe/Paris',
        }),
      );
    expect(clinic.status).toBe(201);

    const doctorEmail = `e2e-doc-${stamp}@test.dev`;
    const doctor = await request(app)
      .post('/api/v1/admin/doctors')
      .set(bearer(admin.accessToken))
      .field(
        'data',
        JSON.stringify({
          name: 'Dr. E2E',
          email: doctorEmail,
          clinicId: clinic.body.data.id,
          specialtyId: specialty.body.data.id,
          slotDurationMinutes: 30,
        }),
      );
    expect(doctor.status).toBe(201);
    const doctorId: string = doctor.body.data.doctor.id;

    // 2. Give the doctor a known password (the real one is emailed, and email is mocked).
    //    Copy the hash from a throwaway verified user. Assumes Better Auth's default `account.password`.
    const donor = await createVerifiedUser({ email: `e2e-donor-${stamp}@test.dev` });
    const donorAccount = await prisma.account.findFirstOrThrow({
      where: { userId: donor.user.id },
    });
    const docUser = await prisma.user.findUniqueOrThrow({ where: { email: doctorEmail } });
    await prisma.account.updateMany({
      where: { userId: docUser.id },
      data: { password: donorAccount.password },
    });
    await prisma.user.update({ where: { id: docUser.id }, data: { mustChangePassword: false } });
    const doc = await loginAs(doctorEmail, donor.password);

    // 3. Doctor opens tomorrow's weekday, 09:00-12:00 Paris
    const weekday = DateTime.now().setZone('Europe/Paris').plus({ days: 1 }).weekday;
    const rule = await request(app)
      .post('/api/v1/doctor/availability')
      .set(bearer(doc.accessToken))
      .send({ weekday, startMinute: 540, endMinute: 720 });
    expect(rule.status).toBe(201);

    // 4. Public slots show it
    const slots = await request(app).get(`/api/v1/doctors/${doctorId}/slots`);
    expect(slots.status).toBe(200);
    const first = (slots.body.data.days as { slots: { startTime: string }[] }[]).flatMap(
      (d) => d.slots,
    )[0];
    expect(first).toBeDefined();
    const startTime = first!.startTime;

    // 5. Patient books
    const patient = await createVerifiedUser({ email: `e2e-pat-${stamp}@test.dev` });
    const pat = await loginAs(patient.user.email, patient.password);
    const booked = await request(app)
      .post('/api/v1/appointments')
      .set(bearer(pat.accessToken))
      .send({ doctorId, startTime });
    expect(booked.status).toBe(201);
    const apptId: string = booked.body.data.id;

    // 6. Slot is gone; a second patient cannot take it
    const after = await request(app).get(`/api/v1/doctors/${doctorId}/slots`);
    const left = (after.body.data.days as { slots: { startTime: string }[] }[])
      .flatMap((d) => d.slots)
      .map((s) => s.startTime);
    expect(left).not.toContain(startTime);

    const other = await createVerifiedUser({ email: `e2e-pat2-${stamp}@test.dev` });
    const oth = await loginAs(other.user.email, other.password);
    const clash = await request(app)
      .post('/api/v1/appointments')
      .set(bearer(oth.accessToken))
      .send({ doctorId, startTime });
    expect(clash.status).toBe(409);

    // 7. Each role sees the appointment; dashboards respond
    const mine = await request(app).get('/api/v1/appointments').set(bearer(pat.accessToken));
    expect((mine.body.data as { id: string }[]).map((a) => a.id)).toContain(apptId);
    const theirs = await request(app).get('/api/v1/appointments').set(bearer(doc.accessToken));
    expect((theirs.body.data as { id: string }[]).map((a) => a.id)).toContain(apptId);
    for (const [path, token] of [
      ['admin', admin.accessToken],
      ['doctor', doc.accessToken],
      ['patient', pat.accessToken],
    ] as const) {
      expect((await request(app).get(`/api/v1/dashboard/${path}`).set(bearer(token))).status).toBe(
        200,
      );
    }

    // 8. Patient cancels; slot reopens; the other patient can now book it
    const cancel = await request(app)
      .post(`/api/v1/appointments/${apptId}/cancel`)
      .set(bearer(pat.accessToken))
      .send({ reason: 'e2e' });
    expect(cancel.status).toBe(200);
    const rebook = await request(app)
      .post('/api/v1/appointments')
      .set(bearer(oth.accessToken))
      .send({ doctorId, startTime });
    expect(rebook.status).toBe(201);
  });
});
