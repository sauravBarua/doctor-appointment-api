import { SLOT_DURATION_MINUTES } from '../config/constants.js';
import type { Prisma } from '../generated/prisma/client.js';

/**
 * Takes the doctor's row lock until the transaction ends. Anything that changes a doctor's
 * schedule or bookings must call this first, so those changes run one after the other.
 */
export async function lockDoctorRow(tx: Prisma.TransactionClient, doctorId: string) {
  await tx.doctor.update({
    where: { id: doctorId },
    data: { slotDurationMinutes: SLOT_DURATION_MINUTES },
  });
}
