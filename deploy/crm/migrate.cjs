#!/usr/bin/env node
'use strict';
/**
 * Apply (or inspect) Hiraia CRM migrations. Safe to run any number of times.
 *
 *   node migrate.cjs [--db /var/lib/hiraia-crm/crm.db] [--status]
 *
 * Defaults to HIRAIA_CRM_DB_PATH. The service also runs migrate() at startup, so this CLI is
 * for operators: pre-flighting a schema change, or checking a restored database.
 */
const { openDatabase, migrate, migrationStatus } = require('./db.cjs');

const args = process.argv.slice(2);
const dbIdx = args.indexOf('--db');
const dbPath = dbIdx >= 0 ? args[dbIdx + 1] : process.env.HIRAIA_CRM_DB_PATH || '/var/lib/hiraia-crm/crm.db';
const db = openDatabase(dbPath);
if (args.includes('--status')) {
  for (const m of migrationStatus(db)) console.log(`${m.applied_at ? 'applied' : 'pending'}\t${m.name}\t${m.applied_at || ''}`);
} else {
  const done = migrate(db);
  console.log(done.length ? `applied: ${done.join(', ')}` : 'up to date (no pending migrations)');
}
db.close();
