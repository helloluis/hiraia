import 'server-only';
import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';
import type { NextRequest, NextResponse } from 'next/server';
import { getDb } from './db';

export const SESSION_COOKIE = 'hiraia_session';
const SESSION_DAYS = 30;

export interface SessionUser {
  id: number;
  email: string;
}

// --- password hashing (scrypt, salt:hash hex) ---

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [saltHex, hashHex] = stored.split(':');
  if (!saltHex || !hashHex) return false;
  const hash = scryptSync(password, Buffer.from(saltHex, 'hex'), 64);
  const expected = Buffer.from(hashHex, 'hex');
  return hash.length === expected.length && timingSafeEqual(hash, expected);
}

// --- sessions ---

export function createSession(userId: number): { token: string; expires: Date } {
  const token = randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + SESSION_DAYS * 86400_000);
  getDb()
    .prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)')
    .run(token, userId, expires.toISOString());
  return { token, expires };
}

export function destroySession(token: string): void {
  getDb().prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

/** Resolve the logged-in user from the session cookie, or null. */
export function getUser(req: NextRequest): SessionUser | null {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const row = getDb()
    .prepare(
      `SELECT u.id AS id, u.email AS email, s.expires_at AS expires_at
         FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.token = ?`
    )
    .get(token) as { id: number; email: string; expires_at: string } | undefined;
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    destroySession(token);
    return null;
  }
  return { id: row.id, email: row.email };
}

/** Attach (or clear) the session cookie on a response. */
export function setSessionCookie(res: NextResponse, token: string, expires: Date): void {
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    expires,
  });
}

export function clearSessionCookie(res: NextResponse): void {
  res.cookies.set(SESSION_COOKIE, '', { httpOnly: true, path: '/', maxAge: 0 });
}
