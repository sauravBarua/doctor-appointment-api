import type { Role } from '../utils/roles.js';

declare global {
  namespace Express {
    interface Request {
      user?: { id: string; role: Role; mustChangePassword: boolean };
    }
  }
}

export {};
