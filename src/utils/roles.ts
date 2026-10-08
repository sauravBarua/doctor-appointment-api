export const ROLES = ['PATIENT', 'DOCTOR', 'ADMIN'] as const;
export type Role = (typeof ROLES)[number];
