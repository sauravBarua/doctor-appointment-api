type Role = 'ADMIN' | 'DOCTOR' | 'PATIENT';
type Method = 'get' | 'post' | 'patch' | 'delete';
type Json = Record<string, unknown>;

export interface Op {
  m: Method;
  p: string; // OpenAPI-style path, e.g. /appointments/{id}
  tag: string;
  s: string; // summary
  roles?: Role[]; // omitted = public
  q?: string[]; // query param names
  body?: Json; // JSON body schema
  form?: Json; // multipart: fields inside the "data" JSON part (+ optional "image")
  ok?: number; // success status, default 200
  note?: string;
}

const ALL: Role[] = ['ADMIN', 'DOCTOR', 'PATIENT'];
const str = { type: 'string' };
const email = { type: 'string', format: 'email' };
const uuid = { type: 'string', format: 'uuid' };
const int = { type: 'integer' };
const obj = (properties: Json, required: string[] = []): Json => ({
  type: 'object',
  properties,
  required,
});
const PAGE = ['page', 'pageSize'];

export const OPS: Op[] = [
  // Platform
  { m: 'get', p: '/health', tag: 'Platform', s: 'Health check (database + Redis)' },

  // Auth
  {
    m: 'post',
    p: '/auth/register',
    tag: 'Auth',
    s: 'Register a patient and email an OTP',
    ok: 201,
    body: obj({ name: str, email, password: { type: 'string', minLength: 8 } }, [
      'name',
      'email',
      'password',
    ]),
  },
  {
    m: 'post',
    p: '/auth/resend-otp',
    tag: 'Auth',
    s: 'Resend the verification OTP',
    body: obj({ email }, ['email']),
  },
  {
    m: 'post',
    p: '/auth/verify-email',
    tag: 'Auth',
    s: 'Verify email with the OTP',
    body: obj({ email, otp: str }, ['email', 'otp']),
  },
  {
    m: 'post',
    p: '/auth/login',
    tag: 'Auth',
    s: 'Log in; returns accessToken (JWT, 10 min) and sessionToken (7 days)',
    body: obj({ email, password: str }, ['email', 'password']),
  },
  { m: 'get', p: '/auth/me', tag: 'Auth', s: 'Current user', roles: ALL },
  {
    m: 'post',
    p: '/auth/refresh',
    tag: 'Auth',
    s: 'Exchange a session token for a new access token',
    body: obj({ sessionToken: str }, ['sessionToken']),
  },
  {
    m: 'post',
    p: '/auth/change-password',
    tag: 'Auth',
    s: 'Change password (also used to replace a temporary password)',
    note: 'Authenticated by the session token in the body, so temporary-password users can call it.',
    body: obj({ currentPassword: str, newPassword: str, sessionToken: str }, [
      'currentPassword',
      'newPassword',
      'sessionToken',
    ]),
  },
  {
    m: 'post',
    p: '/auth/logout',
    tag: 'Auth',
    s: 'Revoke the session',
    body: obj({ sessionToken: str }, ['sessionToken']),
  },
  { m: 'get', p: '/auth/google', tag: 'Auth', s: 'Start Google sign-in (302 redirect)', ok: 302 },
  {
    m: 'get',
    p: '/auth/google/signup',
    tag: 'Auth',
    s: 'Start Google sign-up (302 redirect)',
    ok: 302,
  },

  // Users
  {
    m: 'patch',
    p: '/users/me',
    tag: 'Users',
    s: 'Update own profile (multipart: data + image)',
    roles: ALL,
    form: obj({ name: str, bio: str }),
    note: 'Email cannot be changed. bio applies to doctors.',
  },

  // Specialties
  {
    m: 'get',
    p: '/specialties',
    tag: 'Specialties',
    s: 'List active specialties',
    q: [...PAGE, 'search'],
  },
  { m: 'get', p: '/specialties/{id}', tag: 'Specialties', s: 'Get a specialty' },
  {
    m: 'get',
    p: '/admin/specialties',
    tag: 'Specialties',
    s: 'List specialties incl. inactive',
    roles: ['ADMIN'],
    q: [...PAGE, 'search'],
  },
  {
    m: 'post',
    p: '/admin/specialties',
    tag: 'Specialties',
    s: 'Create a specialty (multipart)',
    roles: ['ADMIN'],
    ok: 201,
    form: obj({ name: str }, ['name']),
  },
  {
    m: 'get',
    p: '/admin/specialties/{id}',
    tag: 'Specialties',
    s: 'Get a specialty (admin)',
    roles: ['ADMIN'],
  },
  {
    m: 'patch',
    p: '/admin/specialties/{id}',
    tag: 'Specialties',
    s: 'Update a specialty (multipart)',
    roles: ['ADMIN'],
    form: obj({ name: str, isActive: { type: 'boolean' } }),
  },
  {
    m: 'delete',
    p: '/admin/specialties/{id}',
    tag: 'Specialties',
    s: 'Delete a specialty',
    roles: ['ADMIN'],
  },

  // Clinics
  { m: 'get', p: '/clinics', tag: 'Clinics', s: 'List clinics', q: [...PAGE, 'city', 'search'] },
  { m: 'get', p: '/clinics/{id}', tag: 'Clinics', s: 'Get a clinic' },
  {
    m: 'get',
    p: '/admin/clinics',
    tag: 'Clinics',
    s: 'List clinics (admin)',
    roles: ['ADMIN'],
    q: [...PAGE, 'search'],
  },
  {
    m: 'post',
    p: '/admin/clinics',
    tag: 'Clinics',
    s: 'Create a clinic (multipart)',
    roles: ['ADMIN'],
    ok: 201,
    form: obj(
      { name: str, city: str, address: str, timezone: { type: 'string', example: 'Europe/Paris' } },
      ['name', 'city', 'address'],
    ),
  },
  {
    m: 'patch',
    p: '/admin/clinics/{id}',
    tag: 'Clinics',
    s: 'Update a clinic (multipart)',
    roles: ['ADMIN'],
    form: obj({ name: str, city: str, address: str, timezone: str }),
  },
  { m: 'delete', p: '/admin/clinics/{id}', tag: 'Clinics', s: 'Delete a clinic', roles: ['ADMIN'] },

  // Doctors (admin)
  {
    m: 'post',
    p: '/admin/doctors',
    tag: 'Doctors (admin)',
    s: 'Create a doctor; a temporary password is emailed (multipart)',
    roles: ['ADMIN'],
    ok: 201,
    form: obj(
      {
        name: str,
        email,
        clinicId: uuid,
        specialtyId: uuid,
        slotDurationMinutes: { type: 'integer', example: 30 },
        bio: str,
      },
      ['name', 'email', 'clinicId', 'specialtyId'],
    ),
  },
  {
    m: 'get',
    p: '/admin/doctors',
    tag: 'Doctors (admin)',
    s: 'List doctors',
    roles: ['ADMIN'],
    q: [...PAGE, 'clinicId', 'specialtyId', 'search'],
  },
  {
    m: 'get',
    p: '/admin/doctors/{id}',
    tag: 'Doctors (admin)',
    s: 'Get a doctor',
    roles: ['ADMIN'],
  },
  {
    m: 'patch',
    p: '/admin/doctors/{id}',
    tag: 'Doctors (admin)',
    s: 'Update a doctor (multipart)',
    roles: ['ADMIN'],
    form: obj({ bio: str, isActive: { type: 'boolean' } }),
  },

  // Schedule
  {
    m: 'get',
    p: '/doctor/availability',
    tag: 'Schedule',
    s: 'List my weekly windows',
    roles: ['DOCTOR'],
  },
  {
    m: 'post',
    p: '/doctor/availability',
    tag: 'Schedule',
    s: 'Add a weekly window (clinic-local minutes, multiples of 30)',
    roles: ['DOCTOR'],
    ok: 201,
    body: obj(
      { weekday: { type: 'integer', minimum: 1, maximum: 7 }, startMinute: int, endMinute: int },
      ['weekday', 'startMinute', 'endMinute'],
    ),
  },
  {
    m: 'patch',
    p: '/doctor/availability/{id}',
    tag: 'Schedule',
    s: 'Update a window',
    roles: ['DOCTOR'],
    body: obj({ weekday: int, startMinute: int, endMinute: int }),
  },
  {
    m: 'delete',
    p: '/doctor/availability/{id}',
    tag: 'Schedule',
    s: 'Delete a window',
    roles: ['DOCTOR'],
  },
  {
    m: 'get',
    p: '/doctor/time-off',
    tag: 'Schedule',
    s: 'List my time off',
    roles: ['DOCTOR'],
    q: [...PAGE],
  },
  {
    m: 'post',
    p: '/doctor/time-off',
    tag: 'Schedule',
    s: 'Add time off (UTC instants)',
    roles: ['DOCTOR'],
    ok: 201,
    body: obj(
      {
        startTime: { type: 'string', format: 'date-time' },
        endTime: { type: 'string', format: 'date-time' },
        reason: str,
      },
      ['startTime', 'endTime'],
    ),
  },
  {
    m: 'delete',
    p: '/doctor/time-off/{id}',
    tag: 'Schedule',
    s: 'Delete time off',
    roles: ['DOCTOR'],
  },

  // Doctor search
  {
    m: 'get',
    p: '/doctors',
    tag: 'Doctor search',
    s: 'Search doctors',
    q: [...PAGE, 'q', 'specialtyId', 'clinicId'],
  },
  { m: 'get', p: '/doctors/{id}', tag: 'Doctor search', s: 'Doctor profile' },
  {
    m: 'get',
    p: '/doctors/{id}/slots',
    tag: 'Doctor search',
    s: 'Bookable slots (default: next 7 days, max range 14)',
    q: ['from', 'to'],
  },

  // Appointments
  {
    m: 'post',
    p: '/appointments',
    tag: 'Appointments',
    s: 'Book a slot (limited to 20/hour per user)',
    roles: ['PATIENT'],
    ok: 201,
    body: obj({ doctorId: uuid, startTime: { type: 'string', format: 'date-time' } }, [
      'doctorId',
      'startTime',
    ]),
  },
  {
    m: 'get',
    p: '/appointments',
    tag: 'Appointments',
    s: 'List appointments (scoped by role)',
    roles: ALL,
    q: [...PAGE, 'status', 'doctorId'],
  },
  { m: 'get', p: '/appointments/{id}', tag: 'Appointments', s: 'Get an appointment', roles: ALL },
  {
    m: 'post',
    p: '/appointments/{id}/cancel',
    tag: 'Appointments',
    s: 'Cancel an appointment',
    roles: ALL,
    body: obj({ reason: str }),
  },

  // Dashboards
  { m: 'get', p: '/dashboard/admin', tag: 'Dashboards', s: 'Admin dashboard', roles: ['ADMIN'] },
  { m: 'get', p: '/dashboard/doctor', tag: 'Dashboards', s: 'Doctor dashboard', roles: ['DOCTOR'] },
  {
    m: 'get',
    p: '/dashboard/patient',
    tag: 'Dashboards',
    s: 'Patient dashboard',
    roles: ['PATIENT'],
  },

  // Notifications
  {
    m: 'get',
    p: '/notifications',
    tag: 'Notifications',
    s: 'My notifications',
    roles: ALL,
    q: [...PAGE, 'unread'],
  },
  {
    m: 'get',
    p: '/notifications/unread-count',
    tag: 'Notifications',
    s: 'Unread count',
    roles: ALL,
  },
  {
    m: 'post',
    p: '/notifications/read-all',
    tag: 'Notifications',
    s: 'Mark all as read',
    roles: ALL,
  },
  {
    m: 'patch',
    p: '/notifications/{id}/read',
    tag: 'Notifications',
    s: 'Mark one as read',
    roles: ALL,
  },

  // Admin
  {
    m: 'get',
    p: '/admin/audit-logs',
    tag: 'Audit logs',
    s: 'List audit logs',
    roles: ['ADMIN'],
    q: [...PAGE, 'action'],
  },
];

const errorRef = (description: string) => ({
  description,
  content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorEnvelope' } } },
});

function buildOperation(op: Op): Json {
  const params: Json[] = [...op.p.matchAll(/\{(\w+)\}/g)].map((x) => ({
    name: x[1],
    in: 'path',
    required: true,
    schema: uuid,
  }));
  for (const name of op.q ?? []) params.push({ name, in: 'query', schema: str });

  const responses: Json = {
    [String(op.ok ?? 200)]: {
      description: op.ok === 302 ? 'Redirect' : 'Success',
      content: { 'application/json': { schema: { $ref: '#/components/schemas/Envelope' } } },
    },
    ...(op.body || op.form || op.q || op.p.includes('{')
      ? { 400: errorRef('Validation error') }
      : {}),
    ...(op.roles
      ? { 401: errorRef('Missing or invalid token'), 403: errorRef('Role not allowed') }
      : {}),
    ...(op.p.includes('{') ? { 404: errorRef('Not found') } : {}),
    429: errorRef('Rate limited'),
  };

  const description = [
    op.roles ? `**Roles:** ${op.roles.join(', ')}` : '**Public**',
    op.note,
    op.form ? 'Send `data` as a JSON string. Optionally attach `image`.' : undefined,
  ]
    .filter(Boolean)
    .join('\n\n');

  return {
    tags: [op.tag],
    summary: op.s,
    description,
    ...(op.roles ? { security: [{ bearerAuth: [] }] } : {}),
    parameters: params,
    ...(op.body
      ? { requestBody: { required: true, content: { 'application/json': { schema: op.body } } } }
      : {}),
    ...(op.form
      ? {
          requestBody: {
            required: true,
            content: {
              'multipart/form-data': {
                schema: obj(
                  {
                    data: {
                      type: 'string',
                      description: 'JSON text',
                      example: JSON.stringify(
                        Object.fromEntries(
                          Object.keys((op.form.properties ?? {}) as Json).map((k) => [k, '...']),
                        ),
                      ),
                    },
                    image: { type: 'string', format: 'binary' },
                  },
                  ['data'],
                ),
              },
            },
          },
        }
      : {}),
    responses,
  };
}

export function buildOpenApi(): Json {
  const paths: Record<string, Json> = {};
  for (const op of OPS) (paths[op.p] ??= {})[op.m] = buildOperation(op);

  return {
    openapi: '3.1.0',
    info: {
      title: 'Doctor Appointment Booking API',
      version: '1.0.0',
      description:
        'All routes are under `/api/v1`. Every response uses the envelope `{ success, message, meta, data }`; failures add `error: { code, details? }`. Times are UTC ISO strings; appointment and slot responses also carry clinic-local (Europe/Paris) fields. Use the **Authorize** button with the `accessToken` from `POST /auth/login`.',
    },
    servers: [{ url: '/api/v1' }],
    tags: [...new Set(OPS.map((o) => o.tag))].map((name) => ({ name })),
    paths,
    components: {
      securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
      schemas: {
        Envelope: obj({
          success: { type: 'boolean' },
          message: str,
          meta: obj({ page: int, pageSize: int, total: int }),
          data: {},
        }),
        ErrorEnvelope: obj({
          success: { type: 'boolean', example: false },
          message: str,
          meta: { type: ['object', 'null'] },
          data: { type: 'null' },
          error: obj({ code: str, details: {} }, ['code']),
        }),
      },
    },
  };
}
