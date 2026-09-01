import { NextResponse, type NextRequest } from 'next/server';
import { getDb } from '@/lib/db';

/**
 * Anonymous transcript log for the public "Try the web demo" lightbox.
 *
 * WRITE-ONLY. Rows are keyed only by a client-generated session id (kept in the visitor's
 * localStorage) and no auth is involved, because the demo has no accounts. We persist what
 * visitors type for product insight into what people actually try.
 *
 * The matching GET (restore this session's transcript, oldest first) is GONE along with the
 * demo chat: its one caller was useDemoStore.openDemo re-rendering a prior thread, and there
 * is no thread surface any more. It is not left behind as a convenience — an unauthenticated
 * read of anyone's transcript by session id is not something to keep around with no reader.
 */

const LANGUAGES = new Set(['tagalog', 'english', 'cebuano']);
const MAX_SESSION_ID = 100;
const MAX_CONTENT = 8000;

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
