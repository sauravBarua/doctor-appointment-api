import { Router } from 'express';
import { requireAuthAllowingPasswordChange } from '../../middleware/requireAuth.js';
import {
  loginLimiter,
  otpResendLimiter,
  otpVerifyLimiter,
  registerLimiter,
} from '../../middleware/rateLimiters.js';
import { validate } from '../../middleware/validate.js';
import * as controller from './auth.controller.js';
import {
  changePasswordBody,
  loginBody,
  logoutBody,
  refreshBody,
  registerBody,
  resendOtpBody,
  verifyEmailBody,
} from './auth.schema.js';

export const authRouter: Router = Router();

authRouter.post(
  '/register',
  registerLimiter,
  validate({ body: registerBody }),
  controller.register,
);
authRouter.post(
  '/verify-email',
  otpVerifyLimiter,
  validate({ body: verifyEmailBody }),
  controller.verifyEmail,
);
authRouter.post(
  '/resend-otp',
  otpResendLimiter,
  validate({ body: resendOtpBody }),
  controller.resendOtp,
);
authRouter.post('/login', loginLimiter, validate({ body: loginBody }), controller.login);
authRouter.post('/refresh', validate({ body: refreshBody }), controller.refresh);

authRouter.post(
  '/logout',
  requireAuthAllowingPasswordChange,
  validate({ body: logoutBody }),
  controller.logout,
);
authRouter.post(
  '/change-password',
  requireAuthAllowingPasswordChange,
  validate({ body: changePasswordBody }),
  controller.changePassword,
);
authRouter.get('/me', requireAuthAllowingPasswordChange, controller.me);
