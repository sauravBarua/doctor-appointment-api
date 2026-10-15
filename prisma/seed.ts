import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import dotenv from 'dotenv';
import { z } from 'zod';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { hashPassword } from '../src/lib/password.js';

dotenv.config({ quiet: true });

const seedEnv = z
  .object({
    NODE_ENV: z.string().default('development'),
    DATABASE_URL: z.url(),
    ADMIN_EMAIL: z.email().transform((v) => v.toLowerCase()),
    ADMIN_PASSWORD: z.string().min(8).max(72),
    E2E_SEED: z.stringbool().default(false),
    E2E_DOCTOR_ID: z.uuid().optional(),
    E2E_DOCTOR_EMAIL: z
      .email()
      .transform((v) => v.toLowerCase())
      .optional(),
    E2E_DOCTOR_PASSWORD: z.string().min(8).max(72).optional(),
    E2E_PATIENT_EMAIL: z
      .email()
      .transform((v) => v.toLowerCase())
      .optional(),
    E2E_PATIENT_PASSWORD: z.string().min(8).max(72).optional(),
  })
  .parse(process.env);

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: seedEnv.DATABASE_URL }),
});

// const DEMO_PASSWORD = 'Demo#Pass123'; // dev only, never seeded in production

function log(message: string): void {
  process.stdout.write(`${message}\n`);
}

async function createUser(input: {
  name: string;
  email: string;
  role: 'ADMIN' | 'DOCTOR' | 'PATIENT';
  password: string;
}) {
  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) {
    log(`exists:  ${input.email}`);
    return existing;
  }
  const id = randomUUID();
  const user = await prisma.user.create({
    data: {
      id,
      name: input.name,
      email: input.email,
      role: input.role,
      emailVerified: true,
      mustChangePassword: false,
      accounts: {
        create: {
          id: randomUUID(),
          accountId: id,
          providerId: 'credential',
          password: await hashPassword(input.password),
        },
      },
    },
  });
  log(`created: ${input.email} (${input.role})`);
  return user;
}

type E2eFixtures = {
  doctorId?: string;
  doctorEmail: string;
  doctorPassword: string;
  patientEmail: string;
  patientPassword: string;
};

function e2eFixtures(): E2eFixtures | null {
  if (!seedEnv.E2E_SEED) return null;
  if (seedEnv.NODE_ENV === 'production') {
    throw new Error('E2E_SEED must not be used in production');
  }
  const doctorEmail = seedEnv.E2E_DOCTOR_EMAIL;
  const doctorPassword = seedEnv.E2E_DOCTOR_PASSWORD;
  const patientEmail = seedEnv.E2E_PATIENT_EMAIL;
  const patientPassword = seedEnv.E2E_PATIENT_PASSWORD;
  if (!doctorEmail || !doctorPassword || !patientEmail || !patientPassword) {
    throw new Error(
      'E2E_SEED needs E2E_DOCTOR_EMAIL, E2E_DOCTOR_PASSWORD, E2E_PATIENT_EMAIL, E2E_PATIENT_PASSWORD',
    );
  }
  return {
    doctorId: seedEnv.E2E_DOCTOR_ID,
    doctorEmail,
    doctorPassword,
    patientEmail,
    patientPassword,
  };
}

async function seedE2e(f: E2eFixtures): Promise<void> {
  const specialty = await prisma.specialty.upsert({
    where: { name: 'Cardiologie' },
    update: {},
    create: { name: 'Cardiologie' },
  });

  const clinic =
    (await prisma.clinic.findFirst({ where: { name: 'Clinique Centrale' } })) ??
    (await prisma.clinic.create({
      data: {
        name: 'Clinique Centrale',
        city: 'Paris',
        address: '12 rue de Rivoli',
        timezone: 'Europe/Paris',
      },
    }));

  const doctorUser = await createUser({
    name: 'Claire Martin',
    email: f.doctorEmail,
    role: 'DOCTOR',
    password: f.doctorPassword,
  });

  const existing = await prisma.doctor.findUnique({ where: { userId: doctorUser.id } });
  if (existing) {
    if (f.doctorId && existing.id !== f.doctorId) {
      log(`warning: doctor id is ${existing.id}, not E2E_DOCTOR_ID`);
    }
  } else {
    await prisma.doctor.create({
      data: {
        ...(f.doctorId ? { id: f.doctorId } : {}),
        userId: doctorUser.id,
        clinicId: clinic.id,
        specialtyId: specialty.id,
        slotDurationMinutes: 30,
        bio: 'Cardiologue.',
        // every weekday, so the booking test passes whatever day CI runs
        availabilityRules: {
          create: [1, 2, 3, 4, 5, 6, 7].flatMap((weekday) => [
            { weekday, startMinute: 9 * 60, endMinute: 12 * 60 },
            { weekday, startMinute: 14 * 60, endMinute: 17 * 60 },
          ]),
        },
      },
    });
    log('created: doctor profile + weekly availability');
  }

  await createUser({
    name: 'Paul Patient',
    email: f.patientEmail,
    role: 'PATIENT',
    password: f.patientPassword,
  });
}

async function main() {
  // const specialtyNames = ['Cardiology', 'Dermatology', 'Pediatrics', 'Neurology', 'Orthopedics'];
  // const specialties = [];
  // for (const name of specialtyNames) {
  //   specialties.push(
  //     await prisma.specialty.upsert({ where: { name }, update: {}, create: { name } }),
  //   );
  // }

  await createUser({
    name: 'Platform Admin',
    email: seedEnv.ADMIN_EMAIL,
    role: 'ADMIN',
    password: seedEnv.ADMIN_PASSWORD,
  });

  const e2e = e2eFixtures();
  if (e2e) await seedE2e(e2e);

  // if (seedEnv.NODE_ENV === 'production') {
  //   log('production: skipping demo data');
  //   return;
  // }

  // const clinic =
  //   (await prisma.clinic.findFirst({ where: { name: 'Central Clinic' } })) ??
  //   (await prisma.clinic.create({
  //     data: {
  //       name: 'Central Clinic',
  //       city: 'Paris',
  //       address: '12 Rue de Rivoli',
  //       timezone: 'Europe/Paris',
  //     },
  //   }));

  // const doctorUser = await createUser({
  //   name: 'Dr. Claire Martin',
  //   email: 'doctor@demo.local',
  //   role: 'DOCTOR',
  //   password: DEMO_PASSWORD,
  // });

  // const cardiology = specialties.find((s) => s.name === 'Cardiology');
  // if (!cardiology) throw new Error('Cardiology specialty missing');

  // const existingDoctor = await prisma.doctor.findUnique({ where: { userId: doctorUser.id } });
  // if (!existingDoctor) {
  //   await prisma.doctor.create({
  //     data: {
  //       userId: doctorUser.id,
  //       clinicId: clinic.id,
  //       specialtyId: cardiology.id,
  //       slotDurationMinutes: 30,
  //       bio: 'Cardiologist with 10 years of experience.',
  //       availabilityRules: {
  //         create: [1, 2, 3, 4, 5].flatMap((weekday) => [
  //           { weekday, startMinute: 9 * 60, endMinute: 12 * 60 },
  //           { weekday, startMinute: 14 * 60, endMinute: 17 * 60 },
  //         ]),
  //       },
  //     },
  //   });
  //   log('created: doctor profile + Mon-Fri availability');
  // }

  // await createUser({
  //   name: 'Paul Patient',
  //   email: 'patient@demo.local',
  //   role: 'PATIENT',
  //   password: DEMO_PASSWORD,
  // });
}

main()
  .catch((err: unknown) => {
    process.stderr.write(`Seed failed: ${String(err)}\n`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
