import { NextResponse } from 'next/server';

// Donor records are listed in exactly one place: the admin dashboard (/admin/donations, same sign-in
// as /admin/crm). This old address only points there; it serves no data.
export const runtime = 'nodejs';
export function GET() {
  return NextResponse.redirect('https://hiraia.org/admin/donations', { status: 308, headers: { 'Cache-Control': 'no-store' } });
}
