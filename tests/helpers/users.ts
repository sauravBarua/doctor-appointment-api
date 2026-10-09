import { randomUUID } from 'node:crypto';
import { prisma } from '../../src/config/prisma.js';
import { hashPassword } from '../../src/lib/password.js';

export interface CreateVerifiedUserInput {
  email: string;
  password?: string;
  name?: string;
  role?: 'PATIENT' | 'DOCTOR' | 'ADMIN';
}
// in the destructuring: role = 'PATIENT',
// in prisma.user.create data: role,

export async function createVerifiedUser(input: {
  email: string;
  password?: string;
  role?: 'PATIENT' | 'DOCTOR' | 'ADMIN';
  mustChangePassword?: boolean;
  isActive?: boolean;
}) {
  const id = randomUUID();
  const password = input.password ?? 'Str0ngPassw0rd';
  const user = await prisma.user.create({
    data: {
      id,
      name: 'Test User',
      email: input.email,
      emailVerified: true,
      role: input.role ?? 'PATIENT',
      mustChangePassword: input.mustChangePassword ?? false,
      tempPasswordExpiresAt: input.mustChangePassword ? new Date(Date.now() + 60 * 60_000) : null,
      isActive: input.isActive ?? true,
      accounts: {
        create: {
          id: randomUUID(),
          accountId: id,
          providerId: 'credential',
          password: await hashPassword(password),
        },
      },
    },
  });
  return { user, password };
}
