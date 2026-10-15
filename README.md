# Doctor Appointment Booking: API

REST and realtime API for booking doctor appointments. Race-safe booking, role-based access, audit trail.

**Web client:** [doctor-appointment-web](../doctor-appointment-web)

## Highlights

- **Booking without double-booking.** Exactly one of many simultaneous patients gets a slot (`SLOT_TAKEN` for the rest). Covered by concurrency tests.
- **Clinic time.** Slots are generated from weekly availability rules and time off in Europe/Paris.
- **Auth.** Email and password with OTP email verification, Google sign-in, short-lived access tokens with refresh sessions (Better Auth).
- **Roles.** Patient, doctor, admin. Admins create doctors with a temporary password that expires and must be changed.
- **Realtime.** Notifications pushed over socket.io to the right user only.
- **Rate limiting.** Redis-backed limiters per route family (login, registration, booking per user, ...). A dev-only `RATE_LIMIT_DISABLED` flag exists for E2E and is refused in production.
- **Audit log.** Sensitive actions are recorded without passwords.
- **Consistent envelope.** `{ success, message, meta, data }` plus `error.code` for failures.

## Stack

Node 24 · Express 5 · TypeScript · Prisma · PostgreSQL · Redis (rate limits, caches) · RabbitMQ (messaging) · Better Auth · socket.io · Zod · Cloudinary · Nodemailer · Vitest and Supertest · Docker · GitHub Actions

## Quick start

```bash
pnpm install
cp .env.example .env     # fill in the values
docker compose up -d     # TODO: confirm service names: postgres, redis, rabbitmq
pnpm db:migrate
pnpm dev                 # http://localhost:3000/api/v1
```

## Scripts

| Command                                        | Purpose                                 |
| ---------------------------------------------- | --------------------------------------- |
| `pnpm dev`                                     | Watch mode                              |
| `pnpm test`                                    | Full test suite against a real database |
| `pnpm db:generate` / `db:migrate` / `db:reset` | Prisma                                  |

## API

Base path `/api/v1`. Interactive documentation: TODO path.

| Area          | Examples                                                                |
| ------------- | ----------------------------------------------------------------------- |
| Auth          | register, verify email, login, refresh, logout, change password, Google |
| Catalogue     | doctors, clinics, specialties, free slots                               |
| Appointments  | book, list, cancel                                                      |
| Doctor        | availability rules, time off                                            |
| Admin         | dashboard, doctors, clinics, specialties, audit logs                    |
| Notifications | list, mark read, realtime                                               |

## Design notes

- **Concurrency.** Booking and cancelling rely on database constraints and transactions, not on application-level checks, so parallel requests cannot both win.
- **Fail-open limiters.** If Redis is unreachable, most limiters let traffic through; sensitive ones can opt into fail-closed.
- **Layers.** routes, controllers, services, Prisma; validation with Zod at the edge.

## Testing

```bash
pnpm test
```

Integration tests cover registration and login, booking races, cancellation, scheduling, catalogue, realtime, audit, dashboards and rate limits.

## Deployment

Environment variables are validated at startup (see `src/config/env.ts`); the process exits on a bad configuration. Set `TRUST_PROXY_HOPS` behind a reverse proxy and `FRONTEND_URL` to the web origin.
