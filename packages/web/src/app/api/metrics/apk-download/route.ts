import { NextResponse, type NextRequest } from 'next/server';
import { getDb } from '@/lib/db';
import { clientIp, geoFrom, ipHash } from '@/lib/geo';

/**
 * Homepage APK-button hits. POST records one (day, ip-hash); GET returns the count
 * for the landing-page confidence line. This is origin-button traffic only — not
 * Pears copies, not wget of /models/hiraia.apk.
 *
 * Unique per IP per UTC day so a double-click does not inflate the public number.
 * Hash is not stored as IP. Country/city come from nginx GeoIP headers when present.
 */

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
  const { country, city } = geoFrom(req);
  getDb()
    .prepare(
      `INSERT INTO apk_download_hits (day, ip_hash, country, city) VALUES (?, ?, ?, ?)
       ON CONFLICT(day, ip_hash) DO UPDATE SET
         country = COALESCE(excluded.country, apk_download_hits.country),
         city = COALESCE(excluded.city, apk_download_hits.city)`,
    )
    .run(day, hash, country, city);
  const row = getDb().prepare('SELECT COUNT(*) AS n FROM apk_download_hits').get() as { n: number };
  return NextResponse.json({ ok: true, count: row.n });
}
