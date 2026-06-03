import { NextResponse, type NextRequest } from 'next/server';
import { getDb } from '@/lib/db';
import { hashPassword, createSession, setSessionCookie } from '@/lib/auth';

export async function POST(req: NextRequest) {
  const { email, password } = await req.json().catch(() => ({}));
  if (!email || !password || typeof email !== 'string' || typeof password !== 'string') {
    return NextResponse.json({ error: 'Email and password are required.' }, { status: 400 });
  }
  if (password.length < 6) {
    return NextResponse.json({ error: 'Password must be at least 6 characters.' }, { status: 400 });
  }

  const db = getDb();
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) {
    return NextResponse.json({ error: 'An account with that email already exists.' }, { status: 409 });
  }

  const info = db
    .prepare('INSERT INTO users (email, password_hash) VALUES (?, ?)')
    .run(email, hashPassword(password));
  const userId = Number(info.lastInsertRowid);

  // Every user starts with a primary thread.
  db.prepare('INSERT INTO chats (user_id, title, is_primary) VALUES (?, ?, 1)').run(userId, 'Main thread');

  const { token, expires } = createSession(userId);
  const res = NextResponse.json({ user: { id: userId, email } });
  setSessionCookie(res, token, expires);
  return res;
}
