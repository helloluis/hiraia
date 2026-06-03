import { NextResponse, type NextRequest } from 'next/server';
import { getUser } from '@/lib/auth';

export async function GET(req: NextRequest) {
  const user = getUser(req);
  return NextResponse.json({ user });
}
