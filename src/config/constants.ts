export const API_PREFIX = '/api/v1';

export const ACCESS_TOKEN_TTL = '10m';
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;
export const SESSION_UPDATE_AGE_SECONDS = 60 * 60 * 24;

export const OTP_LENGTH = 6;
export const OTP_TTL_SECONDS = 300;
export const OTP_MAX_ATTEMPTS = 3;
export const OTP_RESEND_COOLDOWN_SECONDS = 60;
export const GOOGLE_HANDOFF_TTL_SECONDS = 60;
export const TEMP_PASSWORD_TTL_HOURS = 24;
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
export const IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const SLOT_DURATION_MINUTES = 30;
