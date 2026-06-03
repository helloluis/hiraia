import { NextResponse, type NextRequest } from 'next/server';
import { getDb } from '@/lib/db';
import { getUser } from '@/lib/auth';

function ownsChat(userId: number, chatId: number): boolean {
  return !!getDb().prepare('SELECT 1 FROM chats WHERE id = ? AND user_id = ?').get(chatId, userId);
}

// GET /api/chats/:id/messages — full thread history.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getUser(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const chatId = Number((await params).id);
  if (!ownsChat(user.id, chatId)) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const messages = getDb()
    .prepare(
      `SELECT id, role, content, message_feedback, created_at
         FROM messages WHERE chat_id = ? ORDER BY id ASC`
    )
    .all(chatId);
  return NextResponse.json({ messages });
}

// POST /api/chats/:id/messages — append a message; returns the stored row.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getUser(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const chatId = Number((await params).id);
  if (!ownsChat(user.id, chatId)) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const { role, content } = await req.json().catch(() => ({}));
  if (!['user', 'assistant', 'system'].includes(role) || typeof content !== 'string') {
    return NextResponse.json({ error: 'Invalid message' }, { status: 400 });
  }

  const info = getDb()
    .prepare('INSERT INTO messages (chat_id, role, content) VALUES (?, ?, ?)')
    .run(chatId, role, content);
  const message = getDb()
    .prepare('SELECT id, role, content, message_feedback, created_at FROM messages WHERE id = ?')
    .get(Number(info.lastInsertRowid));
  return NextResponse.json({ message });
}
