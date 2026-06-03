import { NextResponse, type NextRequest } from 'next/server';
import { getDb } from '@/lib/db';
import { getUser } from '@/lib/auth';

// POST /api/messages/:id/feedback — { feedback: 1 | -1 | null } (thumbs up/down/clear).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getUser(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const messageId = Number((await params).id);

  // Verify the message belongs to a chat owned by this user.
  const owned = getDb()
    .prepare(
      `SELECT m.id FROM messages m JOIN chats c ON c.id = m.chat_id
        WHERE m.id = ? AND c.user_id = ?`
    )
    .get(messageId, user.id);
  if (!owned) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const { feedback } = await req.json().catch(() => ({}));
  if (feedback !== 1 && feedback !== -1 && feedback !== null) {
    return NextResponse.json({ error: 'feedback must be 1, -1, or null' }, { status: 400 });
  }

  getDb().prepare('UPDATE messages SET message_feedback = ? WHERE id = ?').run(feedback, messageId);
  return NextResponse.json({ ok: true });
}
