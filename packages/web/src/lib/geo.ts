import { createHash } from 'node:crypto';
import type { NextRequest } from 'next/server';

/** Same salt as APK-button hits so one visitor hashes the same way in both tables. */
const SALT = process.env.HIT_SALT || 'hiraia-apk-hit';

export function clientIp(req: NextRequest): string {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) {
    const hops = forwarded.split(',').map((s) => s.trim()).filter(Boolean);
    return hops[hops.length - 1] ?? 'unknown';
  }
  return req.headers.get('x-real-ip') ?? 'unknown';
}

export function ipHash(ip: string): string {
  return createHash('sha256').update(`${SALT}:${ip}`).digest('hex').slice(0, 32);
}

export function geoFrom(req: NextRequest): { country: string | null; city: string | null } {
  const rawCountry =
    req.headers.get('cf-ipcountry') ??
    req.headers.get('x-country-code') ??
    req.headers.get('x-geo-country');
  const country = rawCountry?.trim().toUpperCase() ?? '';
  const okCountry = /^[A-Z]{2}$/.test(country) && country !== 'XX' ? country : null;

  const rawCity =
    req.headers.get('cf-ipcity') ??
    req.headers.get('x-vercel-ip-city') ??
    req.headers.get('x-geo-city');
  let city: string | null = null;
  if (rawCity) {
    try {
      const decoded = decodeURIComponent(rawCity.replace(/\+/g, ' ')).trim();
      if (decoded.length >= 1 && decoded.length <= 64 && /^[\p{L}\p{M}\d .'-]+$/u.test(decoded)) {
        city = decoded;
      }
    } catch {
      /* malformed percent-encoding — skip city, keep country */
    }
  }
  return { country: okCountry, city };
}
