import { createHash } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { getDb } from '@/lib/db';

/**
 * Homepage APK-button hits. POST records one (day, ip-hash); GET returns the count
 * for the landing-page confidence line. This is origin-button traffic only — not
 * Pears copies, not wget of /models/hiraia.apk. Geo lives in GA (`apk_download`).
 *
 * Unique per IP per UTC day so a double-click does not inflate the public number.
 * Hash is not stored as IP. Country is taken only from a proxy header if present.
 */

const SALT = process.env.HIT_SALT || 'hiraia-apk-hit';

function clientIp(req: NextRequest): string {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) {
    const hops = forwarded.split(',').map((s) => s.trim()).filter(Boolean);
    return hops[hops.length - 1] ?? 'unknown';
  }
  return req.headers.get('x-real-ip') ?? 'unknown';
}

function ipHash(ip: string): string {
  return createHash('sha256').update(`${SALT}:${ip}`).digest('hex').slice(0, 32);
}

function countryCode(req: NextRequest): string | null {
  const raw =
    req.headers.get('cf-ipcountry') ??
    req.headers.get('x-country-code') ??
    req.headers.get('x-geo-country');
  if (!raw) return null;
  const code = raw.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) && code !== 'XX' ? code : null;
}

export async function GET() {
  const row = getDb().prepare('SELECT COUNT(*) AS n FROM apk_download_hits').get() as { n: number };
  return NextResponse.json(
    { count: row.n },
    { headers: { 'Cache-Control': 'public, max-age=60' } },
  );
}

export async function POST(req: NextRequest) {
  const day = new Date().toISOString().slice(0, 10);
  const hash = ipHash(clientIp(req));
  const country = countryCode(req);
  getDb()
    .prepare(
      'INSERT OR IGNORE INTO apk_download_hits (day, ip_hash, country) VALUES (?, ?, ?)',
    )
    .run(day, hash, country);
  const row = getDb().prepare('SELECT COUNT(*) AS n FROM apk_download_hits').get() as { n: number };
  return NextResponse.json({ ok: true, count: row.n });
}
