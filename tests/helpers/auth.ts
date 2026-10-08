import { auth } from '../../src/lib/auth.js';

export const DEMO_PASSWORD = 'Demo#Pass123';

export async function loginAs(email: string, password: string) {
  const session = await auth.api.signInEmail({ body: { email, password } });
  const { token } = await auth.api.getToken({
    headers: new Headers({ authorization: `Bearer ${session.token}` }),
  });
  return { accessToken: token, sessionToken: session.token };
}
