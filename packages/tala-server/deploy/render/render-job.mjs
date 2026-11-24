#!/usr/bin/env node
/**
 * Tala slide pictures: ONE drawing job.
 *
 * systemd starts this file once per connection of the web app (tala-render.socket, Accept=yes) inside the sandbox
 * that tala-render@.service describes, and removes everything of the job when it ends. The job reads one
 * PowerPoint file from the connection, lets LibreOffice turn it into a PDF, turns each page into a JPEG and writes
 * the pictures back on the same connection.
 *
 * The file is untrusted and LibreOffice is assumed to be exploitable. So before a byte of the file is read, this
 * program looks at the box it is in (selfCheck) and refuses to draw unless ALL of it holds: not root, no
 * capabilities, no new privileges, a system-call filter, no network device, nothing of the host visible beyond
 * programs and fonts, nowhere to write but a small scratch space in memory, no other user's or job's process in
 * sight, and ceilings on memory, processes, processor time and file size that the kernel enforces. There is no
 * switch that turns the check off, and no other way to start a drawing: run from a shell, this file exits.
 *
 * No dependencies: only Node's own modules, so it can be installed as a single file. It logs one line per job
 * (numbers only); never a file name, a path inside the file or a word of a slide.
 *
 * The protocol (version 1, all integers big-endian) is small on purpose; the web app's side is
 * packages/tala-server/src/modules/decks/upload-render.ts.
 *   request   "TALARND1" · op u8 (1 draw, 2 probe) · 0 u8 · width u16 · pages u16 · 0 u16 · length u32 · the file
 *   response  "TALARND1" · frames of: type u8 · length u32 · payload
 *             0x01 report   JSON: what selfCheck found (always first)
 *             0x02 picture  one JPEG, in slide order
 *             0x03 stats    JSON: timings and peak memory (once, after the pictures)
 *             0x7e failed   status u8: why there are no pictures
 *             0x7f done     u32: how many pictures were sent
 *           A response that does not end with "done" or "failed" is a job that was killed: the web app treats it
 *           as failed.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';

const MAGIC = Buffer.from('TALARND1', 'latin1');
const OP_DRAW = 1;
const OP_PROBE = 2;
const FRAME = { report: 0x01, picture: 0x02, stats: 0x03, failed: 0x7e, done: 0x7f };
/** Why a job ended without pictures. For the server's log; a teacher is told only that the picture could not be drawn. */
const STATUS = { ok: 0, badRequest: 1, tooLarge: 2, sandbox: 3, setup: 4, archive: 5, convert: 6, timeout: 7, pages: 8, output: 9, internal: 10 };

const KiB = 1024;
const MiB = 1024 * KiB;
const GiB = 1024 * MiB;
/** Ceilings no setting can raise. */
const HARD = { inputBytes: 64 * MiB, pages: 400, width: 2048, height: 4096, pictureBytes: 4 * MiB, deadlineSec: 110, pdfBytes: 256 * MiB };
/** What the box may be at most for a drawing to start (selfCheck). The unit file sets far less. */
const BOX = { memoryBytes: 4 * GiB, processes: 1024, scratchBytes: GiB, otherWritableBytes: MiB, fileBytes: GiB, openFiles: 4096, cpuSeconds: 600 };
/** The archive that arrives is one the web app wrote itself, so the rules can be strict. */
const ARCHIVE = { entries: 6000, inflatedBytes: 512 * MiB, ratio: 200, directoryBytes: 8 * MiB, nameBytes: 512 };

const env = process.env;
const intEnv = (name, fallback, max) => {
  const raw = env[name];
  const n = raw && /^\d{1,10}$/.test(raw) ? Number(raw) : fallback;
  return Math.max(1, Math.min(n, max));
};
const CONFIG = {
  soffice: env.TALA_RENDER_SOFFICE || '/usr/lib/libreoffice/program/soffice.bin',
  pdftoppm: env.TALA_RENDER_PDFTOPPM || '/usr/bin/pdftoppm',
  pdfinfo: env.TALA_RENDER_PDFINFO || '/usr/bin/pdfinfo',
  scratch: env.TALA_RENDER_SCRATCH || '/tmp',
  fontconfig: env.TALA_RENDER_FONTCONFIG_FILE || '',
  inputBytes: intEnv('TALA_RENDER_MAX_INPUT_BYTES', 48 * MiB, HARD.inputBytes),
  deadlineSec: intEnv('TALA_RENDER_DEADLINE_SEC', 100, HARD.deadlineSec),
  /** The whole request has to be here this soon: a connection that says nothing does not hold the one place for long. */
  requestSec: intEnv('TALA_RENDER_REQUEST_SEC', 20, 60),
  /** Things of the host a job must not be able to see. A path that is absent, unreadable or an empty folder passes. */
  forbidden: (env.TALA_RENDER_FORBIDDEN_PATHS || '/var/lib/tala:/etc/tala:/opt/tala:/home:/root:/srv:/mnt:/media:/boot:/var/lib:/var/log:/var/backups:/var/www:/etc/passwd:/etc/shadow:/etc/ssh:/etc/ssl/private:/run/tala-render')
    .split(':')
    .filter((p) => p.startsWith('/')),
  /**
   * A developer's machine only (dev-units.sh): the job runs as the developer's own user, so it can see that user's
   * other processes. The report then says `isolation: "shared-user"`, which the web app refuses in production.
   */
  devSharedUser: env.TALA_RENDER_DEV_SHARED_USER === '1',
};
/**
 * Environment names a job may carry: what systemd itself sets for a unit, and this program's own settings.
 * Anything else could be a secret (a job's environment can be read by whatever takes LibreOffice over) and stops
 * the job.
 */
const ENV_OK = new Set(['PATH', 'LANG', 'LANGUAGE', 'TZ', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'PWD', 'INVOCATION_ID', 'MANAGERPID', 'REMOTE_ADDR', 'REMOTE_PORT']);
const ENV_OK_PREFIXES = ['TALA_RENDER_', 'LC_', 'LISTEN_', 'SYSTEMD_', 'JOURNAL_', 'MEMORY_PRESSURE_', 'TRIGGER_'];

class Fail extends Error {
  constructor(status, why) {
    super(why);
    this.status = status;
  }
}

/* ------------------------------------------------------------------ the box ------------------------------------------------------------------ */

const readText = (file) => {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
};
const isCount = (s) => typeof s === 'string' && /^\d{1,15}$/.test(s);

/** Can a file be created in this folder? (Created and removed at once.) */
function writable(dir) {
  const probe = path.join(dir, `.tala-w-${process.pid}`);
  try {
    fs.closeSync(fs.openSync(probe, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600));
  } catch {
    return false;
  }
  try {
    fs.unlinkSync(probe);
  } catch {
    /* it stays in a place of the job's own */
  }
  return true;
}

/** A forbidden path counts as hidden when it is absent, cannot be read, or is an empty folder (links are followed). */
function hidden(p) {
  let st;
  try {
    st = fs.statSync(p);
  } catch {
    return true;
  }
  try {
    if (st.isDirectory()) return fs.readdirSync(p).length === 0;
    fs.closeSync(fs.openSync(p, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK));
    return false;
  } catch {
    return true;
  }
}

/** Tries to reach an address outside. Anything but an immediate refusal by the kernel is a failure. */
function reachOut() {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      sock.destroy();
      resolve(v);
    };
    const sock = new net.Socket();
    const timer = setTimeout(() => done('no answer'), 400);
    sock.once('error', (err) => done(`refused (${err.code ?? 'error'})`));
    sock.once('connect', () => done('connected'));
    try {
      // 192.0.2.1 is a documentation address: with any route at all the attempt hangs instead of failing at once.
      sock.connect({ host: '192.0.2.1', port: 9, family: 4 });
    } catch (err) {
      done(`refused (${err.code ?? 'error'})`);
    }
  });
}

async function selfCheck() {
  const failed = [];
  const need = (ok, name) => {
    if (!ok) failed.push(name);
  };
  const facts = { v: 1 };

  // Who the job is.
  const status = readText('/proc/self/status') ?? '';
  const field = (name) => (status.match(new RegExp(`^${name}:\\s*(.+)$`, 'm')) ?? [])[1]?.trim() ?? null;
  facts.uid = process.getuid();
  need(process.getuid() !== 0 && process.geteuid() !== 0 && process.getgid() !== 0 && process.getegid() !== 0, 'not-root');
  need(field('NoNewPrivs') === '1', 'no-new-privileges');
  need(field('Seccomp') === '2', 'system-call-filter');
  const caps = ['CapInh', 'CapPrm', 'CapEff', 'CapBnd', 'CapAmb'].filter((c) => !/^0+$/.test(field(c) ?? ''));
  facts.capabilities = caps.length ? caps : 'none';
  need(caps.length === 0, 'no-capabilities');

  // No network.
  const devices = readText('/proc/self/net/dev');
  facts.interfaces = devices === null ? null : devices.split('\n').slice(2).map((l) => l.split(':')[0].trim()).filter(Boolean);
  need(facts.interfaces !== null && facts.interfaces.every((i) => i === 'lo'), 'no-network-device');
  facts.reachOut = await reachOut();
  need(facts.reachOut.startsWith('refused'), 'no-way-out');

  // Nothing of the host but programs and fonts.
  facts.root = readDir('/');
  facts.etc = readDir('/etc');
  facts.visible = CONFIG.forbidden.filter((p) => !hidden(p));
  need(facts.visible.length === 0, 'host-files-hidden');
  // /usr/local is the administrator's own corner of the host: of it, the job may see its own program and nothing else.
  const local = readDir('/usr/local');
  facts.usrLocal = local === null ? [] : local.flatMap((entry) => (entry === 'lib' ? (readDir('/usr/local/lib') ?? ['?']).map((e) => `lib/${e}`) : [entry])).slice(0, 40);
  need(facts.usrLocal.every((entry) => entry === 'lib/tala-render'), 'usr-local-hidden');

  // Nowhere to write but the scratch space, which is in memory, small and made for this job. Every mount point is
  // tried. A mount "of the job" is one that was made inside its own mount namespace: the kernel marks everything
  // that came from the host with `master:`.
  const mounts = (readText('/proc/self/mountinfo') ?? '').split('\n').filter(Boolean).map((line) => {
    const [left, right = ''] = line.split(' - ');
    const fields = left.split(' ');
    return { point: fields[4] ?? '', type: right.split(' ')[0] ?? '', ofTheJob: !fields.slice(6).some((f) => f.startsWith('master:')) };
  });
  const mountOf = (dir) => mounts.filter((m) => dir === m.point || dir.startsWith(m.point === '/' ? '/' : `${m.point}/`)).sort((a, b) => b.point.length - a.point.length)[0] ?? null;
  const places = new Set(['/', '/tmp', '/var/tmp', '/dev/shm', '/run', '/var', '/usr', '/etc', '/dev', CONFIG.scratch, path.dirname(fs.realpathSync(process.argv[1])), ...mounts.map((m) => m.point)]);
  facts.writable = [];
  for (const dir of places) {
    if (!dir.startsWith('/') || !writable(dir)) continue;
    let bytes = null;
    try {
      const s = fs.statfsSync(dir);
      bytes = s.blocks * s.bsize;
    } catch {
      /* stays unknown */
    }
    const mount = mountOf(dir);
    facts.writable.push({ path: dir, type: mount?.type ?? 'unknown', ofTheJob: mount?.ofTheJob ?? false, bytes });
  }
  need(mounts.length > 0, 'mounts-readable');
  // And it starts empty: nothing of an earlier job is in it.
  facts.scratchEntries = readDir(CONFIG.scratch)?.length ?? null;
  need(facts.scratchEntries === 0, 'scratch-empty');
  const inMemory = (w, most) => w.type === 'tmpfs' && w.ofTheJob && w.bytes !== null && w.bytes <= most;
  need(facts.writable.some((w) => w.path === CONFIG.scratch && inMemory(w, BOX.scratchBytes)), 'scratch-in-memory-and-bounded');
  need(facts.writable.every((w) => w.path === CONFIG.scratch || (w.type === 'mqueue' && w.ofTheJob) || inMemory(w, BOX.otherWritableBytes)), 'nothing-else-writable');

  // Nobody else in sight: every process this job can see belongs to this job.
  const mine = (readText('/proc/self/cgroup') ?? '').trim();
  let seen = 0;
  let others = 0;
  for (const name of readDir('/proc') ?? []) {
    if (!/^\d+$/.test(name)) continue;
    const cg = readText(`/proc/${name}/cgroup`);
    if (cg === null && !fs.existsSync(`/proc/${name}`)) continue; // gone in between
    seen += 1;
    if (cg === null || cg.trim() !== mine) others += 1;
  }
  facts.processes = { seen, others };
  facts.isolation = others === 0 ? 'own-user' : 'shared-user';
  need(mine !== '' && (others === 0 || CONFIG.devSharedUser), 'no-foreign-processes');

  // Ceilings the kernel enforces: this job's own control group and its resource limits.
  const cgPath = mine.split('\n').map((l) => l.split(':')).find((p) => p[0] === '0')?.[2] ?? null;
  const cg = (file) => (cgPath ? readText(path.join('/sys/fs/cgroup', cgPath, file))?.trim() ?? null : null);
  // Of the control-group tree (every service of the host, by name, with what it uses) the job sees the way down to
  // its own group and nothing beside it: at each level above, the next step is the only thing there.
  const beside = [];
  let level = '/sys/fs/cgroup';
  for (const step of (cgPath ?? '').split('/').filter(Boolean)) {
    const entries = readDir(level);
    if (entries === null) {
      beside.push(`${level} cannot be listed`);
      break;
    }
    for (const entry of entries) if (entry !== step) beside.push(path.join(level, entry));
    level = path.join(level, step);
  }
  facts.otherGroups = beside.slice(0, 20);
  need(Boolean(cgPath) && cgPath !== '/' && beside.length === 0, 'control-groups-hidden');
  const limitsText = readText('/proc/self/limits') ?? '';
  const soft = (label) => (limitsText.match(new RegExp(`^${label}\\s+(\\S+)`, 'm')) ?? [])[1] ?? null;
  facts.limits = {
    memoryBytes: cg('memory.max'),
    swapBytes: cg('memory.swap.max'),
    processes: cg('pids.max'),
    cpu: cg('cpu.max'),
    fileBytes: soft('Max file size'),
    openFiles: soft('Max open files'),
    cpuSeconds: soft('Max cpu time'),
    coreBytes: soft('Max core file size'),
  };
  const L = facts.limits;
  need(isCount(L.memoryBytes) && Number(L.memoryBytes) <= BOX.memoryBytes, 'memory-ceiling');
  need(L.swapBytes === '0', 'no-swap');
  need(isCount(L.processes) && Number(L.processes) <= BOX.processes, 'process-ceiling');
  need(typeof L.cpu === 'string' && /^\d+ \d+$/.test(L.cpu), 'cpu-ceiling');
  need(isCount(L.fileBytes) && Number(L.fileBytes) <= BOX.fileBytes, 'file-size-ceiling');
  need(isCount(L.openFiles) && Number(L.openFiles) <= BOX.openFiles, 'open-files-ceiling');
  need(isCount(L.cpuSeconds) && Number(L.cpuSeconds) <= BOX.cpuSeconds, 'cpu-time-ceiling');
  // 1 is what the unit sets: no core file, and no crash handler outside the box is started (see the unit file).
  need(L.coreBytes === '0' || L.coreBytes === '1', 'no-core-dumps');

  // No secret can ride in on the environment (names only are reported).
  facts.environment = Object.keys(env).filter((k) => !ENV_OK.has(k) && !ENV_OK_PREFIXES.some((p) => k.startsWith(p))).sort();
  need(facts.environment.length === 0, 'clean-environment');

  // The programs are there (not a property of the box, but nothing can be drawn without them).
  const runs = (file) => {
    try {
      fs.accessSync(file, fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  };
  facts.programs = { libreoffice: runs(CONFIG.soffice), pdftoppm: runs(CONFIG.pdftoppm), pdfinfo: runs(CONFIG.pdfinfo) };
  facts.missing = Object.entries(facts.programs).filter(([, ok]) => !ok).map(([name]) => name);

  return { ...facts, ok: failed.length === 0, failed };
}

function readDir(dir) {
  try {
    return fs.readdirSync(dir).sort();
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ the connection ------------------------------------------------------------------ */

/** The accepted connection systemd handed over (fd 3), or nothing. */
function connection() {
  if (env.LISTEN_PID !== String(process.pid) || env.LISTEN_FDS !== '1') return null;
  return new net.Socket({ fd: 3, readable: true, writable: true, allowHalfOpen: true });
}

function channel(sock) {
  const waiting = [];
  let held = 0;
  let ended = false;
  let broken = null;
  let wake = null;
  const poke = () => {
    const w = wake;
    wake = null;
    w?.();
  };
  sock.on('data', (chunk) => {
    waiting.push(chunk);
    held += chunk.length;
    if (held > 4 * MiB) sock.pause();
    poke();
  });
  sock.on('end', () => {
    ended = true;
    poke();
  });
  sock.on('error', (err) => {
    broken = err;
    poke();
  });
  /** Up to `max` bytes, or null when the other side has finished. */
  const take = async (max) => {
    while (held === 0) {
      if (broken) throw new Fail(STATUS.badRequest, 'connection');
      if (ended) return null;
      await new Promise((resolve) => (wake = resolve));
    }
    let head = waiting[0];
    if (head.length > max) {
      waiting[0] = head.subarray(max);
      head = head.subarray(0, max);
    } else waiting.shift();
    held -= head.length;
    if (held < MiB) sock.resume();
    return head;
  };
  const write = (buf) =>
    new Promise((resolve, reject) => {
      sock.write(buf, (err) => (err ? reject(new Fail(STATUS.internal, 'connection')) : resolve()));
    });
  return {
    async exactly(n) {
      const parts = [];
      let got = 0;
      while (got < n) {
        const part = await take(n - got);
        if (!part) throw new Fail(STATUS.badRequest, 'short request');
        parts.push(part);
        got += part.length;
      }
      return Buffer.concat(parts, n);
    },
    /** Exactly `n` bytes of the request into a new file. */
    async toFile(file, n) {
      const fd = fs.openSync(file, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
      try {
        let got = 0;
        while (got < n) {
          const part = await take(Math.min(n - got, MiB));
          if (!part) throw new Fail(STATUS.badRequest, 'short request');
          fs.writeSync(fd, part);
          got += part.length;
        }
      } finally {
        fs.closeSync(fd);
      }
    },
    async frame(type, payload) {
      const head = Buffer.alloc(5);
      head.writeUInt8(type, 0);
      head.writeUInt32BE(payload.length, 1);
      await write(head);
      if (payload.length) await write(payload);
    },
    write,
    close: () => new Promise((resolve) => sock.end(resolve)),
  };
}

/* ------------------------------------------------------------------ the file ------------------------------------------------------------------ */

function readAt(fd, length, position) {
  const buf = Buffer.alloc(length);
  let got = 0;
  while (got < length) {
    const n = fs.readSync(fd, buf, got, length - got, position + got);
    if (n === 0) throw new Fail(STATUS.archive, 'short archive');
    got += n;
  }
  return buf;
}

/**
 * The archive's own table of contents, read without unpacking anything. The web app already held the upload to
 * these rules and wrote this archive itself, so a file that breaks one of them here did not come from the web app.
 * (What the table declares can lie; the memory, scratch and time ceilings of the box are what bound the unpacking.)
 */
function checkArchive(file, size) {
  const bad = (why) => new Fail(STATUS.archive, why);
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    if (size < 22 + 30 || readAt(fd, 4, 0).readUInt32LE(0) !== 0x04034b50) throw bad('not a zip archive');
    const tailLength = Math.min(size, 22 + 65535);
    const tail = readAt(fd, tailLength, size - tailLength);
    let at = -1;
    for (let i = tailLength - 22; i >= 0; i--) {
      if (tail.readUInt32LE(i) === 0x06054b50 && i + 22 + tail.readUInt16LE(i + 20) === tailLength) {
        at = i;
        break;
      }
    }
    if (at < 0) throw bad('no table of contents');
    const entries = tail.readUInt16LE(at + 10);
    const directoryBytes = tail.readUInt32LE(at + 12);
    const directoryAt = tail.readUInt32LE(at + 16);
    if (tail.readUInt16LE(at + 4) !== 0 || tail.readUInt16LE(at + 6) !== 0 || tail.readUInt16LE(at + 8) !== entries) throw bad('split archive');
    if (entries === 0xffff || directoryBytes === 0xffffffff || directoryAt === 0xffffffff) throw bad('zip64');
    if (entries === 0 || entries > ARCHIVE.entries) throw bad('entry count');
    if (directoryBytes > ARCHIVE.directoryBytes || directoryAt + directoryBytes !== size - tailLength + at) throw bad('table of contents out of place');
    const dir = readAt(fd, directoryBytes, directoryAt);
    const names = new Set();
    let inflated = 0;
    let p = 0;
    for (let i = 0; i < entries; i++) {
      if (p + 46 > directoryBytes || dir.readUInt32LE(p) !== 0x02014b50) throw bad('table of contents damaged');
      const flags = dir.readUInt16LE(p + 8);
      const method = dir.readUInt16LE(p + 10);
      const packed = dir.readUInt32LE(p + 20);
      const unpacked = dir.readUInt32LE(p + 24);
      const nameBytes = dir.readUInt16LE(p + 28);
      const next = p + 46 + nameBytes + dir.readUInt16LE(p + 30) + dir.readUInt16LE(p + 32);
      const localAt = dir.readUInt32LE(p + 42);
      if (next > directoryBytes) throw bad('table of contents damaged');
      if (flags & 0x0041) throw bad('encrypted entry');
      if (method !== 0 && method !== 8) throw bad('unknown compression');
      if (packed === 0xffffffff || unpacked === 0xffffffff || localAt === 0xffffffff) throw bad('zip64');
      if (localAt + 30 + packed > directoryAt) throw bad('entry out of place');
      if (nameBytes === 0 || nameBytes > ARCHIVE.nameBytes) throw bad('entry name');
      const name = dir.subarray(p + 46, p + 46 + nameBytes).toString('latin1');
      // No way out of the archive by name, and no second entry under a name (two readers could pick different ones).
      if (name.includes('\0') || name.includes('\\') || name.startsWith('/') || /^[A-Za-z]:/.test(name) || name.split('/').includes('..')) throw bad('entry name');
      const key = name.toLowerCase();
      if (names.has(key)) throw bad('entry named twice');
      names.add(key);
      inflated += unpacked;
      if (inflated > ARCHIVE.inflatedBytes) throw bad('unpacks to too much');
      p = next;
    }
    if (p !== directoryBytes) throw bad('table of contents damaged');
    if (inflated > Math.max(size, MiB) * ARCHIVE.ratio) throw bad('unpacks to too much');
    if (!names.has('[content_types].xml') || !names.has('ppt/presentation.xml')) throw bad('not a presentation');
    return { entries, inflated };
  } finally {
    fs.closeSync(fd);
  }
}

/* ------------------------------------------------------------------ the programs ------------------------------------------------------------------ */

/** Runs one program to its end or to the time limit, then makes sure nothing of it is left in its process group. */
function run(file, args, { timeoutMs, env: childEnv, cwd, capture = 0 }) {
  return new Promise((resolve) => {
    let out = Buffer.alloc(0);
    let timedOut = false;
    let child;
    try {
      child = spawn(file, args, { cwd, env: childEnv, stdio: ['ignore', capture ? 'pipe' : 'ignore', 'ignore'], detached: true });
    } catch {
      return resolve({ code: null, signal: null, timedOut: false, out, spawned: false });
    }
    const sweep = () => {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        /* nothing left */
      }
    };
    const timer = setTimeout(() => {
      timedOut = true;
      sweep();
    }, timeoutMs);
    if (capture) {
      child.stdout.on('data', (chunk) => {
        if (out.length < capture) out = Buffer.concat([out, chunk]).subarray(0, capture);
      });
    }
    child.once('error', () => {
      clearTimeout(timer);
      resolve({ code: null, signal: null, timedOut, out, spawned: false });
    });
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      sweep();
      resolve({ code, signal, timedOut, out, spawned: true });
    });
  });
}

/**
 * LibreOffice's settings for a job, written into its fresh profile: no macros at all, nothing fetched for a
 * linked picture or object, no update check, no crash report, no recovery. (The box has no network and no files to
 * fetch anyway; this is the second lock on the same door.)
 */
const PROFILE = `<?xml version="1.0" encoding="UTF-8"?>
<oor:items xmlns:oor="http://openoffice.org/2001/registry" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="MacroSecurityLevel" oor:op="fuse"><value>3</value></prop></item>
<item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="DisableMacrosExecution" oor:op="fuse"><value>true</value></prop></item>
<item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="BlockUntrustedRefererLinks" oor:op="fuse"><value>true</value></prop></item>
<item oor:path="/org.openoffice.Office.Common/Misc"><prop oor:name="FirstRun" oor:op="fuse"><value>false</value></prop></item>
<item oor:path="/org.openoffice.Office.Common/Misc"><prop oor:name="UseOpenCL" oor:op="fuse"><value>false</value></prop></item>
<item oor:path="/org.openoffice.Office.Common/Misc"><prop oor:name="CrashReport" oor:op="fuse"><value>false</value></prop></item>
<item oor:path="/org.openoffice.Office.Recovery/AutoSave"><prop oor:name="Enabled" oor:op="fuse"><value>false</value></prop></item>
<item oor:path="/org.openoffice.Office.Recovery/RecoveryInfo"><prop oor:name="Enabled" oor:op="fuse"><value>false</value></prop></item>
<item oor:path="/org.openoffice.Setup/Office"><prop oor:name="ooSetupInstCompleted" oor:op="fuse"><value>true</value></prop></item>
</oor:items>
`;

async function draw(io, { width, pages, length }, clock) {
  if (width < 320 || width > HARD.width || pages < 1 || pages > HARD.pages || length < 1) throw new Fail(STATUS.badRequest, 'request');
  if (length > CONFIG.inputBytes) throw new Fail(STATUS.tooLarge, 'file size');

  const work = path.join(CONFIG.scratch, 'job');
  const dirs = { in: path.join(work, 'in'), out: path.join(work, 'out'), home: path.join(work, 'home'), tmp: path.join(work, 'tmp'), run: path.join(work, 'run'), profile: path.join(work, 'profile') };
  fs.mkdirSync(work, { mode: 0o700 });
  for (const d of Object.values(dirs)) fs.mkdirSync(d, { mode: 0o700 });
  fs.mkdirSync(path.join(dirs.profile, 'user'), { mode: 0o700 });
  fs.writeFileSync(path.join(dirs.profile, 'user', 'registrymodifications.xcu'), PROFILE, { mode: 0o600 });

  const deck = path.join(dirs.in, 'deck.pptx');
  await io.toFile(deck, length);
  clock.received();
  clock.mark('received');
  checkArchive(deck, length);

  // The programs get this environment and nothing of the job's own.
  const childEnv = {
    PATH: '/usr/bin:/bin',
    HOME: dirs.home,
    TMPDIR: dirs.tmp,
    TMP: dirs.tmp,
    TEMP: dirs.tmp,
    XDG_RUNTIME_DIR: dirs.run,
    XDG_CACHE_HOME: path.join(dirs.home, '.cache'),
    XDG_CONFIG_HOME: path.join(dirs.home, '.config'),
    XDG_DATA_HOME: path.join(dirs.home, '.local'),
    LANG: 'C.UTF-8',
    LC_ALL: 'C.UTF-8',
    // No display and no desktop: the headless drawing back-end only.
    SAL_USE_VCLPLUGIN: 'svp',
    SAL_DISABLE_OPENCL: '1',
    ...(CONFIG.fontconfig ? { FONTCONFIG_FILE: CONFIG.fontconfig } : {}),
  };

  // Hidden slides are exported too, so page N is slide N. The import filter is named, so the file is read as a
  // PowerPoint presentation whatever else it may pretend to be.
  const convert = [
    '--headless', '--invisible', '--norestore', '--nolockcheck', '--nodefault', '--nofirststartwizard', '--nologo',
    `-env:UserInstallation=file://${dirs.profile}`,
    '--infilter=Impress MS PowerPoint 2007 XML',
    '--convert-to', 'pdf:impress_pdf_Export:{"ExportHiddenSlides":{"type":"boolean","value":"true"}}',
    '--outdir', dirs.out, deck,
  ];
  const pdf = path.join(dirs.out, 'deck.pdf');
  for (let attempt = 1; ; attempt++) {
    const budget = Math.min(80_000, clock.left() - 15_000);
    if (budget < 5_000) throw new Fail(STATUS.timeout, 'no time left');
    const r = await run(CONFIG.soffice, convert, { timeoutMs: budget, env: childEnv, cwd: work });
    if (!r.spawned) throw new Fail(STATUS.setup, 'libreoffice did not start');
    if (r.timedOut) throw new Fail(STATUS.timeout, 'libreoffice');
    // With a fresh profile LibreOffice may set the profile up and exit with 81 ("start me again"), which its own
    // launcher would do. Once.
    if (r.code === 81 && attempt === 1) continue;
    if (r.code !== 0) throw new Fail(STATUS.convert, `libreoffice ${r.signal ?? r.code}`);
    break;
  }
  clock.mark('converted');
  const pdfSize = regularFileSize(pdf);
  if (pdfSize === null || pdfSize < 64 || pdfSize > HARD.pdfBytes) throw new Fail(STATUS.convert, 'no pdf');
  // Make room: the profile and the file are not needed any more.
  fs.rmSync(dirs.profile, { recursive: true, force: true });
  fs.rmSync(dirs.in, { recursive: true, force: true });

  const info = await run(CONFIG.pdfinfo, [pdf], { timeoutMs: Math.min(20_000, clock.left()), env: childEnv, cwd: work, capture: 16 * KiB });
  if (!info.spawned) throw new Fail(STATUS.setup, 'pdfinfo did not start');
  if (info.timedOut) throw new Fail(STATUS.timeout, 'pdfinfo');
  const text = info.out.toString('latin1');
  const pageCount = Number((text.match(/^Pages:\s+(\d+)\s*$/m) ?? [])[1] ?? NaN);
  const size = text.match(/^Page size:\s+([\d.]+) x ([\d.]+) pts/m);
  if (info.code !== 0 || !Number.isInteger(pageCount) || !size) throw new Fail(STATUS.convert, 'pdf not readable');
  if (pageCount !== pages) throw new Fail(STATUS.pages, 'page count');
  const [pageW, pageH] = [Number(size[1]), Number(size[2])];
  if (!(pageW > 0) || !(pageH > 0)) throw new Fail(STATUS.convert, 'page size');
  // As wide as asked, unless that would make a very tall page taller than the ceiling.
  const scale = (width * pageH) / pageW > HARD.height ? ['-scale-to-x', '-1', '-scale-to-y', String(HARD.height)] : ['-scale-to-x', String(width), '-scale-to-y', '-1'];

  const prefix = path.join(dirs.out, 'slide');
  const drawn = await run(CONFIG.pdftoppm, ['-jpeg', '-jpegopt', 'quality=82', ...scale, '-f', '1', '-l', String(pages), pdf, prefix], { timeoutMs: Math.max(1_000, Math.min(60_000, clock.left() - 5_000)), env: childEnv, cwd: work });
  if (!drawn.spawned) throw new Fail(STATUS.setup, 'pdftoppm did not start');
  if (drawn.timedOut) throw new Fail(STATUS.timeout, 'pdftoppm');
  if (drawn.code !== 0) throw new Fail(STATUS.convert, `pdftoppm ${drawn.signal ?? drawn.code}`);
  fs.rmSync(pdf, { force: true });
  clock.mark('drawn');

  const files = (readDir(dirs.out) ?? [])
    .map((name) => ({ name, n: Number((name.match(/^slide-(\d+)\.jpg$/) ?? [])[1] ?? NaN) }))
    .filter((f) => Number.isInteger(f.n))
    .sort((a, b) => a.n - b.n);
  if (files.length !== pages || files.some((f, i) => f.n !== i + 1)) throw new Fail(STATUS.pages, 'picture count');

  let sent = 0;
  let bytes = 0;
  for (const f of files) {
    const picture = readPicture(path.join(dirs.out, f.name));
    await io.frame(FRAME.picture, picture);
    fs.rmSync(path.join(dirs.out, f.name), { force: true });
    sent += 1;
    bytes += picture.length;
  }
  clock.mark('sent');
  return { sent, bytes };
}

function regularFileSize(file) {
  try {
    const st = fs.lstatSync(file);
    return st.isFile() && st.nlink === 1 ? st.size : null;
  } catch {
    return null;
  }
}

/** One picture, as a real JPEG file of a sane size and nothing else (no link to follow, no device to read). */
function readPicture(file) {
  let fd;
  try {
    fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  } catch {
    throw new Fail(STATUS.output, 'picture missing');
  }
  try {
    const st = fs.fstatSync(fd);
    if (!st.isFile() || st.nlink !== 1 || st.size < 128 || st.size > HARD.pictureBytes) throw new Fail(STATUS.output, 'picture size');
    const buf = readAt(fd, st.size, 0);
    if (buf[0] !== 0xff || buf[1] !== 0xd8 || buf[2] !== 0xff || buf[buf.length - 2] !== 0xff || buf[buf.length - 1] !== 0xd9) throw new Fail(STATUS.output, 'not a jpeg');
    return buf;
  } catch (err) {
    throw err instanceof Fail ? (err.status === STATUS.archive ? new Fail(STATUS.output, 'picture unreadable') : err) : new Fail(STATUS.output, 'picture unreadable');
  } finally {
    fs.closeSync(fd);
  }
}

/* ------------------------------------------------------------------ one job ------------------------------------------------------------------ */

async function main() {
  const sock = connection();
  if (!sock) {
    process.stderr.write('tala-render: this program draws nothing by itself. systemd starts it for one connection of tala-render.socket.\n');
    process.exit(2);
  }
  const started = Date.now();
  const marks = {};
  const clock = { mark: (name) => (marks[name] = Date.now() - started), left: () => CONFIG.deadlineSec * 1000 - (Date.now() - started) };
  const io = channel(sock);
  let ending = false;
  const end = async (status, count, note) => {
    if (ending) return;
    ending = true;
    clearTimeout(deadline);
    clearTimeout(requestTimer);
    try {
      if (status === STATUS.ok) {
        const n = Buffer.alloc(4);
        n.writeUInt32BE(count, 0);
        await io.frame(FRAME.done, n);
      } else await io.frame(FRAME.failed, Buffer.from([status]));
      await io.close();
    } catch {
      /* the web app went away; nothing to tell */
    }
    const name = Object.entries(STATUS).find(([, v]) => v === status)?.[0] ?? String(status);
    process.stdout.write(`tala-render: ${name}${note ? ` ${note}` : ''} ms=${Date.now() - started}\n`);
    // Anything still running in the job is removed by systemd with the unit.
    process.exit(status === STATUS.sandbox || status === STATUS.setup || status === STATUS.internal ? 1 : 0);
  };
  const deadline = setTimeout(() => void end(STATUS.timeout, 0, 'deadline'), CONFIG.deadlineSec * 1000);
  const requestTimer = setTimeout(() => void end(STATUS.badRequest, 0, '(request not received in time)'), CONFIG.requestSec * 1000);
  clock.received = () => clearTimeout(requestTimer);

  try {
    await io.write(MAGIC);
    const head = await io.exactly(20);
    if (!head.subarray(0, 8).equals(MAGIC)) throw new Fail(STATUS.badRequest, 'not a request');
    const op = head.readUInt8(8);
    const request = { width: head.readUInt16BE(10), pages: head.readUInt16BE(12), length: head.readUInt32BE(16) };
    if (head.readUInt8(9) !== 0 || head.readUInt16BE(14) !== 0 || (op !== OP_DRAW && op !== OP_PROBE)) throw new Fail(STATUS.badRequest, 'request');
    if (op === OP_PROBE && (request.width || request.pages || request.length)) throw new Fail(STATUS.badRequest, 'request');

    const report = await selfCheck();
    await io.frame(FRAME.report, Buffer.from(JSON.stringify(report), 'utf8'));
    if (!report.ok) return await end(STATUS.sandbox, 0, `refused: ${report.failed.join(',')}`);
    if (report.missing.length) return await end(STATUS.setup, 0, `missing: ${report.missing.join(',')}`);
    if (op === OP_PROBE) {
      clock.received();
      return await end(STATUS.ok, 0, 'probe');
    }

    const { sent, bytes } = await draw(io, request, clock);
    const peak = report.limits && readText(path.join('/sys/fs/cgroup', (readText('/proc/self/cgroup') ?? '').trim().replace(/^0::/, ''), 'memory.peak'))?.trim();
    const stats = { ms: { ...marks, total: Date.now() - started }, inBytes: request.length, outBytes: bytes, pictures: sent, peakBytes: isCount(peak) ? Number(peak) : null };
    await io.frame(FRAME.stats, Buffer.from(JSON.stringify(stats), 'utf8'));
    return await end(STATUS.ok, sent, `pictures=${sent} in=${request.length} out=${bytes} peak=${stats.peakBytes ?? '?'}`);
  } catch (err) {
    // The reason is one of this file's own short phrases, never text from the file being drawn.
    return await end(err instanceof Fail ? err.status : STATUS.internal, 0, err instanceof Fail ? `(${err.message})` : '(error)');
  }
}

await main();
