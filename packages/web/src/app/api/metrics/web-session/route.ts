import { NextResponse, type NextRequest } from 'next/server';
import { getDb } from '@/lib/db';
import { clientIp, geoFrom, ipHash } from '@/lib/geo';

/**
 * Landing/FAQ page sessions. One row per IP-hash per UTC day. No raw IP.
 * Country/city come from nginx GeoIP headers when those are configured.
 */

export async function POST(req: NextRequest) {
  const day = new Date().toISOString().slice(0, 10);
  const hash = ipHash(clientIp(req));
  const { country, city } = geoFrom(req);
  getDb()
    .prepare(
      `INSERT INTO web_sessions (day, ip_hash, country, city) VALUES (?, ?, ?, ?)
       ON CONFLICT(day, ip_hash) DO UPDATE SET
         country = COALESCE(excluded.country, web_sessions.country),
         city = COALESCE(excluded.city, web_sessions.city)`,
    )
    .run(day, hash, country, city);
  return NextResponse.json({ ok: true });
}
