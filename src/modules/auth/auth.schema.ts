import { z } from 'zod';

const email = z.string().trim().toLowerCase().pipe(z.email());

const withinBcryptLimit = (value: string) => Buffer.byteLength(value, 'utf8') <= 72;

const newPassword = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .refine(withinBcryptLimit, 'Password must be at most 72 bytes')
  .refine((v) => /[A-Za-z]/.test(v) && /\d/.test(v), 'Password must contain a letter and a digit');

const existingPassword = z.string().min(1).refine(withinBcryptLimit, 'Password is too long');

const sessionToken = z.string().min(10);

export const registerBody = z.object({
  name: z.string().trim().min(2).max(80),
  email,
  password: newPassword,
});

export const verifyEmailBody = z.object({
  email,
  otp: z.string().regex(/^\d{6}$/, 'OTP must be 6 digits'),
});

export const resendOtpBody = z.object({ email });

export const loginBody = z.object({ email, password: existingPassword });

export const refreshBody = z.object({ sessionToken });

export const logoutBody = z.object({ sessionToken });

export const changePasswordBody = z
  .object({ currentPassword: existingPassword, newPassword, sessionToken })
  .refine((v) => v.currentPassword !== v.newPassword, {
    message: 'New password must differ from the current one',
    path: ['newPassword'],
  });

export type RegisterBody = z.infer<typeof registerBody>;
export type VerifyEmailBody = z.infer<typeof verifyEmailBody>;
export type ResendOtpBody = z.infer<typeof resendOtpBody>;
export type LoginBody = z.infer<typeof loginBody>;
export type RefreshBody = z.infer<typeof refreshBody>;
export type LogoutBody = z.infer<typeof logoutBody>;
export type ChangePasswordBody = z.infer<typeof changePasswordBody>;
