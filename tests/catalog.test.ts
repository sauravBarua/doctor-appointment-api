import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/mailer.js', () => ({
  sendOtpEmail: async () => undefined,
  sendEmail: async () => undefined,
}));
vi.mock('../src/lib/cloudinary.js', () => ({
  uploadImageToCloudinary: async (_buffer: Buffer, opts: { publicId: string }) =>
    `https://res.cloudinary.test/${opts.publicId}.png`,
}));

import { app } from '../src/app.js';
import { prisma } from '../src/config/prisma.js';
import { redis } from '../src/config/redis.js';
import { loginAs } from './helpers/auth.js';
import { createVerifiedUser } from './helpers/users.js';

const api = '/api/v1';
const run = randomUUID().slice(0, 8);
const doctorEmail = `doc-${run}@example.com`;
const patientEmail = `patient-${run}@example.com`;
const specialtyName = `Test Spec ${run}`;
const ids = { specialty: '', clinic: '', doctor: '' };
let adminToken = '';
let patientToken = '';
let tempPassword = '';

const as = (token: string) => ({ Authorization: `Bearer ${token}` });
const png = { filename: 'icon.png', contentType: 'image/png' };

beforeAll(async () => {
  adminToken = (await loginAs(String(process.env.ADMIN_EMAIL), String(process.env.ADMIN_PASSWORD)))
    .accessToken;
  const { user, password } = await createVerifiedUser({ email: patientEmail });
  patientToken = (await loginAs(user.email, password)).accessToken;
});

afterAll(async () => {
  await prisma.doctor.deleteMany({ where: { user: { email: doctorEmail } } });
  await prisma.user.deleteMany({ where: { email: { in: [doctorEmail, patientEmail] } } });
  await prisma.clinic.deleteMany({ where: { name: { endsWith: run } } });
  await prisma.specialty.deleteMany({ where: { name: { endsWith: run } } });
  await prisma.$disconnect();
  await redis.quit();
});

describe('access control', () => {
  it('rejects a missing token', async () => {
    const res = await request(app).post(`${api}/admin/specialties`).send({ name: specialtyName });
    expect(res.status).toBe(401);
  });

  it('rejects a patient', async () => {
    const res = await request(app)
      .post(`${api}/admin/specialties`)
      .set(as(patientToken))
      .send({ name: specialtyName });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });
});

describe('specialties', () => {
  it('creates a specialty', async () => {
    const res = await request(app)
      .post(`${api}/admin/specialties`)
      .set(as(adminToken))
      .send({ name: specialtyName });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      success: true,
      data: { name: specialtyName, isActive: true, iconUrl: null },
    });
    ids.specialty = res.body.data.id;
  });

  it('rejects the same name in a different case', async () => {
    const res = await request(app)
      .post(`${api}/admin/specialties`)
      .set(as(adminToken))
      .send({ name: specialtyName.toUpperCase() });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ALREADY_EXISTS');
  });

  it('validates the body', async () => {
    const res = await request(app)
      .post(`${api}/admin/specialties`)
      .set(as(adminToken))
      .send({ name: 'a' });
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('lists publicly with pagination meta', async () => {
    const res = await request(app).get(`${api}/specialties?search=${run}`);
    expect(res.status).toBe(200);
    expect(res.body.meta).toMatchObject({ page: 1, pageSize: 20, total: 1 });
    expect(res.body.data[0].id).toBe(ids.specialty);
  });

  it('creates a specialty with an icon via form-data', async () => {
    const res = await request(app)
      .post(`${api}/admin/specialties`)
      .set(as(adminToken))
      .field('data', JSON.stringify({ name: `Form Spec ${run}` }))
      .attach('image', Buffer.from('fake'), png);
    expect(res.status).toBe(201);
    expect(res.body.data.iconUrl).toContain('specialty-');
  });

  it('updates the icon via form-data', async () => {
    const res = await request(app)
      .patch(`${api}/admin/specialties/${ids.specialty}`)
      .set(as(adminToken))
      .field('data', '{}')
      .attach('image', Buffer.from('fake'), png);
    expect(res.status).toBe(200);
    expect(res.body.data.iconUrl).toContain(`specialty-${ids.specialty}`);
  });

  it('rejects a non-image, invalid JSON and an empty update', async () => {
    const url = `${api}/admin/specialties/${ids.specialty}`;
    const bad = await request(app)
      .patch(url)
      .set(as(adminToken))
      .field('data', '{}')
      .attach('image', Buffer.from('x'), { filename: 'a.txt', contentType: 'text/plain' });
    expect(bad.status).toBe(415);
    expect(bad.body.error.code).toBe('UPLOAD_ERROR');

    const json = await request(app).patch(url).set(as(adminToken)).field('data', 'not json');
    expect(json.status).toBe(400);
    expect(json.body.error.code).toBe('VALIDATION_ERROR');

    const empty = await request(app).patch(url).set(as(adminToken)).send({});
    expect(empty.status).toBe(400);
    expect(empty.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('hides an inactive specialty from the public', async () => {
    await request(app)
      .patch(`${api}/admin/specialties/${ids.specialty}`)
      .set(as(adminToken))
      .send({ isActive: false })
      .expect(200);
    const hidden = await request(app).get(`${api}/specialties/${ids.specialty}`);
    expect(hidden.status).toBe(404);
    await request(app)
      .patch(`${api}/admin/specialties/${ids.specialty}`)
      .set(as(adminToken))
      .send({ isActive: true })
      .expect(200);
  });
});

describe('clinics', () => {
  it('rejects an invalid timezone', async () => {
    const res = await request(app)
      .post(`${api}/admin/clinics`)
      .set(as(adminToken))
      .send({
        name: `Bad ${run}`,
        city: 'Lyon',
        address: '5 Place Bellecour',
        timezone: 'Mars/Olympus',
      });
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('creates and publicly reads a clinic', async () => {
    const created = await request(app)
      .post(`${api}/admin/clinics`)
      .set(as(adminToken))
      .send({
        name: `Test Clinic ${run}`,
        city: 'Lyon',
        address: '5 Place Bellecour',
        timezone: 'Europe/Paris',
      });
    expect(created.status).toBe(201);
    ids.clinic = created.body.data.id;
    const read = await request(app).get(`${api}/clinics/${ids.clinic}`);
    expect(read.status).toBe(200);
  });

  it('creates a clinic with an image via form-data', async () => {
    const res = await request(app)
      .post(`${api}/admin/clinics`)
      .set(as(adminToken))
      .field(
        'data',
        JSON.stringify({
          name: `Form Clinic ${run}`,
          city: 'Nice',
          address: '1 Promenade des Anglais',
          timezone: 'Europe/Paris',
        }),
      )
      .attach('image', Buffer.from('fake'), png);
    expect(res.status).toBe(201);
    expect(res.body.data.imageUrl).toContain('clinic-');
  });
});

describe('doctors', () => {
  it('creates a doctor with a temporary password', async () => {
    const res = await request(app).post(`${api}/admin/doctors`).set(as(adminToken)).send({
      name: 'Dr. Test',
      email: doctorEmail,
      clinicId: ids.clinic,
      specialtyId: ids.specialty,
    });
    expect(res.status).toBe(201);
    expect(res.body.data.doctor.user).toMatchObject({
      email: doctorEmail,
      mustChangePassword: true,
    });
    expect(res.body.data.credentialsEmailed).toBe(true);
    expect(typeof res.body.data.temporaryPassword).toBe('string');
    ids.doctor = res.body.data.doctor.id;
    tempPassword = res.body.data.temporaryPassword;
  });

  it('rejects a duplicate email and an unknown clinic', async () => {
    const dup = await request(app).post(`${api}/admin/doctors`).set(as(adminToken)).send({
      name: 'Dr. Copy',
      email: doctorEmail,
      clinicId: ids.clinic,
      specialtyId: ids.specialty,
    });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('EMAIL_ALREADY_REGISTERED');

    const missing = await request(app)
      .post(`${api}/admin/doctors`)
      .set(as(adminToken))
      .send({
        name: 'Dr. None',
        email: `none-${run}@example.com`,
        clinicId: randomUUID(),
        specialtyId: ids.specialty,
      });
    expect(missing.status).toBe(404);
  });

  it('gates the new doctor until the password is changed', async () => {
    const { accessToken } = await loginAs(doctorEmail, tempPassword);
    const res = await request(app).get(`${api}/admin/specialties`).set(as(accessToken));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');
  });

  it('updates the photo via form-data', async () => {
    const res = await request(app)
      .patch(`${api}/admin/doctors/${ids.doctor}`)
      .set(as(adminToken))
      .field('data', '{}')
      .attach('image', Buffer.from('fake'), png);
    expect(res.status).toBe(200);
    expect(res.body.data.user.image).toContain('user-');
  });

  it('blocks deleting a clinic or specialty that has doctors', async () => {
    const clinic = await request(app)
      .delete(`${api}/admin/clinics/${ids.clinic}`)
      .set(as(adminToken));
    expect(clinic.status).toBe(409);
    expect(clinic.body.error.code).toBe('RESOURCE_IN_USE');
    const specialty = await request(app)
      .delete(`${api}/admin/specialties/${ids.specialty}`)
      .set(as(adminToken));
    expect(specialty.body.error.code).toBe('RESOURCE_IN_USE');
  });

  it('deactivating a doctor blocks login', async () => {
    await request(app)
      .patch(`${api}/admin/doctors/${ids.doctor}`)
      .set(as(adminToken))
      .send({ isActive: false })
      .expect(200);
    const login = await request(app)
      .post(`${api}/auth/login`)
      .send({ email: doctorEmail, password: tempPassword });
    expect(login.status).toBe(401);
  });
});
