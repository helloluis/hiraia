import { NextResponse, type NextRequest } from 'next/server';
import { getDb } from '@/lib/db';
import { getUser } from '@/lib/auth';

// PATCH /api/chats/:id — rename a thread's title.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getUser(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const chatId = Number(id);

  const owned = getDb().prepare('SELECT id FROM chats WHERE id = ? AND user_id = ?').get(chatId, user.id);
  if (!owned) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const { title } = await req.json().catch(() => ({}));
  const newTitle = typeof title === 'string' && title.trim() ? title.trim() : null;
  getDb().prepare('UPDATE chats SET title = ? WHERE id = ?').run(newTitle, chatId);

  const chat = getDb()
    .prepare('SELECT id, title, is_primary, created_at FROM chats WHERE id = ?')
    .get(chatId);
  return NextResponse.json({ chat });
}
