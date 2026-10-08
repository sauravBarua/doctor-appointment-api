import { randomUUID } from 'node:crypto';
import { prisma } from '../../src/config/prisma.js';
import { hashPassword } from '../../src/lib/password.js';

export async function createVerifiedUser(input: {
  email: string;
  password: string;
  role?: 'PATIENT' | 'DOCTOR' | 'ADMIN';
  mustChangePassword?: boolean;
  isActive?: boolean;
}): Promise<string> {
  const id = randomUUID();
  await prisma.user.create({
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
          password: await hashPassword(input.password),
        },
      },
    },
  });
  return id;
}
