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
