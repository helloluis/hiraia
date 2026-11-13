/**
 * API mount: every method under /api/v1 is delegated to `createTalaServer().handle(request)` from
 * @hiraia/tala-server (worker A's kernel). One server instance per process; configuration comes from the
 * environment (TALA_ENV, TALA_DB_PATH, TALA_PUBLIC_ORIGIN, … — names only, see the server's kernel README).
 */
import { createTalaServer, type TalaServer } from '@hiraia/tala-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const g = globalThis as unknown as { __talaServer?: TalaServer };

function server(): TalaServer {
  return (g.__talaServer ??= createTalaServer());
}

const handler = (request: Request) => server().handle(request);

export { handler as GET, handler as POST, handler as PUT, handler as DELETE, handler as PATCH };
