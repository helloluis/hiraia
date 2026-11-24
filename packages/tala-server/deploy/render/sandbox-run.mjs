#!/usr/bin/env node
/**
 * Run ANY program in the drawing job's box, to test the box itself: "suppose LibreOffice has been taken over; what
 * can it do?" (hostile.py is such a program). The program gets exactly the [Service] lines of the unit file, as a
 * one-off transient unit, and this script prints what it wrote and how systemd says it ended.
 *
 *   on a server, as root (the box that is installed):
 *       node sandbox-run.mjs [--unit /etc/systemd/system/tala-render@.service] [--set Key=Value]... -- /usr/bin/python3 /usr/local/lib/tala-render/hostile.py survey
 *   on a developer's machine (per-user service manager, the lines dev-units.mjs derives):
 *       node sandbox-run.mjs --user [--soffice-dir DIR] [--fonts-dir DIR] [--set Key=Value]... [--bind SRC:DST]... -- /usr/bin/python3 /opt/tala-render/hostile.py survey
 *
 * --set changes one line for a test (for example MemoryMax=64M); it cannot add a line the unit does not have.
 * Exit code: the program's own, or 1 when systemd killed it. The last line printed is a JSON summary:
 *   {"result":"success|exit-code|signal|oom-kill|timeout|...","exitCode":N,"signal":"KILL|null", "ms":N}
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { developerLines, readArgs, serviceLines } from './units.mjs';

function fail(message) {
  console.error(`sandbox-run: ${message}`);
  process.exit(2);
}
let parsed;
try {
  parsed = readArgs(process.argv.slice(2), ['set', 'drop', 'bind', 'add']);
} catch (err) {
  fail(err.message);
}
const { options, rest: program } = parsed;
if (!program.length || !program[0].startsWith('/')) fail('give the program after "--" with an absolute path (as it is inside the box)');
const user = options.user === true;
if (user && process.getuid() === 0) fail('--user is the developer set-up and does not run as root');
if (!user && process.getuid() !== 0) fail('without --user this runs the installed unit\'s box and needs root');

let lines;
try {
  if (user) {
    const runtime = process.env.XDG_RUNTIME_DIR;
    if (!runtime) fail('no XDG_RUNTIME_DIR');
    lines = developerLines({ sofficeDir: options.sofficeDir, fontsDir: options.fontsDir, userland: options.userland, set: options.set, drop: options.drop, add: options.add, binds: options.bind, stateDir: path.join(runtime, 'tala-render-run') }).lines;
  } else {
    const unit = options.unit ?? '/etc/systemd/system/tala-render@.service';
    if (!fs.existsSync(unit)) fail(`${unit} is not there (install.sh puts it there), or give --unit`);
    lines = serviceLines(unit);
    for (const pair of options.set) {
      const key = pair.slice(0, pair.indexOf('='));
      const at = lines.findIndex((line) => line.startsWith(`${key}=`));
      if (at < 0) fail(`--set ${key}: the unit has no such line`);
      lines[at] = pair;
    }
    for (const b of options.bind) lines.push(`BindReadOnlyPaths=${b}`);
  }
} catch (err) {
  fail(err.message);
}
// The program replaces ExecStart; its output comes back on the pipe instead of going to the journal.
const SKIP = /^(ExecStart|StandardInput|StandardOutput|StandardError|SyslogIdentifier|Slice)=/;
const slice = lines.find((l) => l.startsWith('Slice='))?.slice(6);
const unitName = `tala-render-run-${process.pid}-${Date.now().toString(36)}.service`;
const args = [
  ...(user ? ['--user'] : []),
  '--wait', '--pipe', '--collect', `--unit=${unitName}`,
  // In the developer set-up the slice is not installed; the job's own ceilings are the same numbers.
  ...(slice && !user ? [`--slice=${slice}`] : []),
  ...lines.filter((l) => !SKIP.test(l)).flatMap((l) => ['-p', l]),
  '--', ...program,
];
const started = Date.now();
const run = spawnSync('systemd-run', args, { stdio: ['ignore', 'inherit', 'pipe'], encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
// `systemd-run --wait` says on its own error stream how the unit ended; the rest of that stream is the program's.
const stderr = run.stderr ?? '';
const SUMMARY = /^(Running as unit: |Finished with result: |Main processes terminated with: |Service runtime: |CPU time consumed: |IP traffic |IO bytes |Memory peak: |Memory swap peak: )/;
const programStderr = stderr.split('\n').filter((line) => !SUMMARY.test(line)).join('\n').trim();
if (programStderr && !options.quiet) console.error(programStderr);
const result = stderr.match(/^Finished with result: (\S+)/m)?.[1] ?? (/Failed to start transient service unit/.test(stderr) ? 'not-started' : run.status === 0 ? 'success' : 'unknown');
const ended = stderr.match(/^Main processes terminated with: code=(\w+)\/status=(\S+)/m);
const summary = {
  result,
  exitCode: ended?.[1] === 'exited' ? Number(ended[2]) : null,
  signal: ended && ended[1] !== 'exited' ? ended[2] : null,
  cpu: stderr.match(/^CPU time consumed: (.+)$/m)?.[1] ?? null,
  ms: Date.now() - started,
};
console.log(JSON.stringify(summary));
process.exit(result === 'success' ? 0 : summary.exitCode && summary.exitCode > 0 ? summary.exitCode : 1);
