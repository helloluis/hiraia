import { NextResponse, type NextRequest } from 'next/server';
import { getDb } from '@/lib/db';

/**
 * Anonymous transcript log for the public "Try the web demo" lightbox.
 *
 * No auth: the demo has no accounts. Rows are keyed only by a client-generated
 * session id (kept in the visitor's localStorage), so a returning visitor on the
 * same browser can pick their thread back up, but switching browsers starts
 * fresh. We persist everything — visitor questions, our canned replies, and the
 * opening factoid — for product insight into what people actually try.
 */

const LANGUAGES = new Set(['tagalog', 'english', 'cebuano']);
const MAX_SESSION_ID = 100;
const MAX_CONTENT = 8000;

// GET /api/demo/messages?sessionId=… — restore a session's transcript (oldest first).
export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get('sessionId');
  if (!sessionId || sessionId.length > MAX_SESSION_ID) {
    return NextResponse.json({ messages: [] });
  }
  const messages = getDb()
    .prepare(
      `SELECT id, role, content, kind, language, created_at
         FROM demo_messages WHERE session_id = ? ORDER BY id ASC`
    )
    .all(sessionId);
  return NextResponse.json({ messages });
}

// POST /api/demo/messages — append one demo message; returns the stored row.
export async function POST(req: NextRequest) {
  const { sessionId, role, content, kind, language } = await req.json().catch(() => ({}));

  if (typeof sessionId !== 'string' || !sessionId || sessionId.length > MAX_SESSION_ID) {
    return NextResponse.json({ error: 'Invalid session' }, { status: 400 });
  }
  if (!['user', 'assistant'].includes(role) || typeof content !== 'string' || !content) {
    return NextResponse.json({ error: 'Invalid message' }, { status: 400 });
  }

  const safeContent = content.slice(0, MAX_CONTENT);
  const safeKind = kind === 'factoid' ? 'factoid' : null;
  const safeLanguage = typeof language === 'string' && LANGUAGES.has(language) ? language : null;

  const info = getDb()
    .prepare(
      'INSERT INTO demo_messages (session_id, role, kind, language, content) VALUES (?, ?, ?, ?, ?)'
    )
    .run(sessionId, role, safeKind, safeLanguage, safeContent);
  const message = getDb()
    .prepare('SELECT id, role, content, kind, language, created_at FROM demo_messages WHERE id = ?')
    .get(Number(info.lastInsertRowid));
  return NextResponse.json({ message });
}
