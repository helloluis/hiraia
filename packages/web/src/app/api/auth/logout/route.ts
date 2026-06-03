import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE, destroySession, clearSessionCookie } from '@/lib/auth';

export async function POST(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (token) destroySession(token);
  const res = NextResponse.json({ ok: true });
  clearSessionCookie(res);
  return res;
}
