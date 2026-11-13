/**
 * Hiraia staff switch for community escalations (PRD §11.6 step 4). There is no admin HTTP route in V1.0.
 *
 *   TALA_DB_PATH=/path/to/tala.db pnpm --filter @hiraia/tala-server exec tsx src/modules/community/staff-cli.ts <command>
 *
 *   show <artifactId>        status, version, copy count and the moderation history (no lesson content)
 *   takedown <artifactId>    hide from everyone but the author until restored
 *   restore <artifactId>     make visible again (undoes a takedown, a report hide, or a model return)
 *   pending                  how many posts and report checks are waiting for a model
 *
 * Every takedown and restore is written to the moderation log with provider 'staff'.
 * The database path comes from the TALA_DB_PATH environment variable; nothing else is read.
 */
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { getArtifact } from './store';
import { staffRestore, staffTakedown } from './service';

export function runStaffCommand(
  db: Database.Database,
  argv: string[],
  out: (line: string) => void,
  env: Record<string, string | undefined> = {}
): number {
  const [command, id] = argv;
  const exists = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'community_artifacts'")
    .get();
  if (!exists) {
    out('This database has no community tables. Start the server once so its migrations run.');
    return 2;
  }
  const deps = {
    db,
    now: () => new Date(),
    newId: () => randomUUID(),
    guidelineVersion: Number(env['TALA_MODERATION_GUIDELINE_VERSION'] ?? 1) || 1,
  };
  const describe = (artifactId: string) => {
    const a = getArtifact(db, artifactId);
    if (!a) return false;
    const v = db
      .prepare('SELECT number, status FROM community_versions WHERE id = ?')
      .get(a.current_version_id) as { number: number; status: string } | undefined;
    out(`artifact ${a.id}`);
    out(`  title       ${a.title}`);
    out(`  author      ${a.author_display_name} (${a.author_id})`);
    out(`  status      ${a.status}${a.hidden_by ? ` (hidden by ${a.hidden_by})` : ''}`);
    out(`  version     ${v?.number ?? '?'} (${v?.status ?? 'missing'})`);
    out(`  copies      ${a.copy_count}`);
    const reports = db
      .prepare(
        'SELECT reason, check_status, outcome FROM community_reports WHERE artifact_id = ? ORDER BY created_at'
      )
      .all(a.id) as Array<Record<string, string | null>>;
    out(
      `  reports     ${reports.length ? reports.map((r) => `${r['reason']}:${r['check_status']}${r['outcome'] ? `:${r['outcome']}` : ''}`).join(', ') : 'none'}`
    );
    const log = db
      .prepare(
        'SELECT created_at, trigger, decision, categories, provider, model, guideline_version FROM community_moderation_log WHERE artifact_id = ? ORDER BY created_at, rowid'
      )
      .all(a.id) as Array<Record<string, string | number | null>>;
    for (const l of log)
      out(
        `  ${l['created_at']}  ${l['trigger']}  ${l['decision']}  [${l['categories'] || '-'}]  ${l['provider']}${l['model'] ? `/${l['model']}` : ''}  g${l['guideline_version']}`
      );
    return true;
  };
  try {
    switch (command) {
      case 'show':
        if (!id || !describe(id)) throw new Error(`No artifact ${id ?? '(missing id)'}`);
        return 0;
      case 'takedown':
        if (!id) throw new Error('Usage: takedown <artifactId>');
        staffTakedown(deps, id);
        out(`Taken down: ${id}`);
        describe(id);
        return 0;
      case 'restore':
        if (!id) throw new Error('Usage: restore <artifactId>');
        staffRestore(deps, id);
        out(`Restored: ${id}`);
        describe(id);
        return 0;
      case 'pending': {
        const v = db
          .prepare("SELECT COUNT(*) n FROM community_versions WHERE status = 'pending'")
          .get() as { n: number };
        const r = db
          .prepare("SELECT COUNT(*) n FROM community_reports WHERE check_status = 'pending'")
          .get() as { n: number };
        out(`posts waiting for a check: ${v.n}`);
        out(`report checks waiting:     ${r.n}`);
        return 0;
      }
      default:
        out('Commands: show <artifactId> | takedown <artifactId> | restore <artifactId> | pending');
        return 1;
    }
  } catch (e) {
    out(e instanceof Error ? e.message : String(e));
    return 1;
  }
}

// Run only when executed directly, never on import.
if (process.argv[1] && /staff-cli\.(ts|js|mjs)$/.test(process.argv[1])) {
  const path = process.env['TALA_DB_PATH'];
  if (!path) {
    console.error('Set TALA_DB_PATH to the server database file.');
    process.exit(2);
  }
  const db = new Database(path, { fileMustExist: true });
  try {
    process.exitCode = runStaffCommand(
      db,
      process.argv.slice(2),
      (line) => console.log(line),
      process.env
    );
  } finally {
    db.close();
  }
}
