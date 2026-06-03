import { NextResponse, type NextRequest } from 'next/server';
import { getDb } from '@/lib/db';
import { getUser } from '@/lib/auth';

// GET /api/chats — list the user's chat threads (primary first).
export async function GET(req: NextRequest) {
  const user = getUser(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const db = getDb();

  // Safety net: ensure the user always has a primary thread.
  const hasPrimary = db.prepare('SELECT 1 FROM chats WHERE user_id = ? AND is_primary = 1').get(user.id);
  if (!hasPrimary) {
    db.prepare('INSERT INTO chats (user_id, title, is_primary) VALUES (?, ?, 1)').run(user.id, 'Main thread');
  }

  const chats = db
    .prepare(
      `SELECT id, title, is_primary, created_at
         FROM chats WHERE user_id = ?
        ORDER BY is_primary DESC, created_at ASC`
    )
    .all(user.id);
  return NextResponse.json({ chats });
}

// POST /api/chats — create a new thread, optional title.
export async function POST(req: NextRequest) {
  const user = getUser(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { title } = await req.json().catch(() => ({}));
  const info = getDb()
    .prepare('INSERT INTO chats (user_id, title, is_primary) VALUES (?, ?, 0)')
    .run(user.id, typeof title === 'string' && title.trim() ? title.trim() : null);
  const chat = getDb()
    .prepare('SELECT id, title, is_primary, created_at FROM chats WHERE id = ?')
    .get(Number(info.lastInsertRowid));
  return NextResponse.json({ chat });
}
