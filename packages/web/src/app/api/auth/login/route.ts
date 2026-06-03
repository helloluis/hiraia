import { NextResponse, type NextRequest } from 'next/server';
import { getDb } from '@/lib/db';
import { verifyPassword, createSession, setSessionCookie } from '@/lib/auth';

export async function POST(req: NextRequest) {
  const { email, password } = await req.json().catch(() => ({}));
  if (!email || !password) {
    return NextResponse.json({ error: 'Email and password are required.' }, { status: 400 });
  }

  const user = getDb()
    .prepare('SELECT id, email, password_hash FROM users WHERE email = ?')
    .get(email) as { id: number; email: string; password_hash: string } | undefined;

  if (!user || !verifyPassword(password, user.password_hash)) {
    return NextResponse.json({ error: 'Invalid email or password.' }, { status: 401 });
  }

  const { token, expires } = createSession(user.id);
  const res = NextResponse.json({ user: { id: user.id, email: user.email } });
  setSessionCookie(res, token, expires);
  return res;
}
