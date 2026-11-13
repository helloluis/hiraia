/**
 * Print the mail the local or staging server "sent" (it writes mail to a table instead of sending it).
 * OWNER: workstream A. A developer tool: this is how you get a verification or reset link while testing.
 *
 *   pnpm --filter @hiraia/tala-server exec tsx src/modules/core/tools/outbox.ts        # newest 5
 *   pnpm --filter @hiraia/tala-server exec tsx src/modules/core/tools/outbox.ts 20
 *
 * It reads the database named by TALA_DB_PATH (or the local default). The links it prints sign someone in,
 * so it refuses to run against production, where nothing is written to this table anyway.
 */
import { existsSync } from 'node:fs';
import { loadConfig } from '../../../kernel/config';
import { openDatabase } from '../../../kernel/db';
import { readOutbox } from '../mailer';

const config = loadConfig();
if (config.environment === 'production') {
  console.error('The mail outbox is a local and staging tool. It does not run against production.');
  process.exit(1);
}
if (!existsSync(config.dbPath)) {
  console.error(`No database at ${config.dbPath} yet. Start the server once, then try again.`);
  process.exit(1);
}
const limit = /^\d{1,3}$/.test(process.argv[2] ?? '') ? Number(process.argv[2]) : 5;
const db = openDatabase(config.dbPath);
try {
  const mails = readOutbox(db, limit);
  if (mails.length === 0) console.log('The outbox is empty.');
  for (const mail of mails.reverse()) {
    console.log(`\n--- ${mail.createdAt}  ${mail.template} (${mail.lang})  to ${mail.to}\nSubject: ${mail.subject}\n\n${mail.body}`);
  }
} finally {
  db.close();
}
