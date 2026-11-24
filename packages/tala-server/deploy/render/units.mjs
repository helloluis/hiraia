/**
 * The drawing sandbox as data: the [Service] lines of tala-render@.service, and what a developer's machine has to
 * change in them. Used by dev-units.mjs (the socket-activated job without root) and sandbox-run.mjs (any program in
 * the job's box, for tests that play a hostile LibreOffice). Both DERIVE from the production unit file, so a line
 * added there is tested here without anybody remembering to copy it.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const here = path.dirname(fileURLToPath(import.meta.url));
export const PRODUCTION_UNIT = path.join(here, 'tala-render@.service');

/** Lines of the production unit that only root's service manager can apply, and what a developer gets instead. */
const ROOT_ONLY = {
  'User=tala-render': 'User=tala-render (a user of its own for drawing) needs root: the job runs as you, and says so (isolation "shared-user")',
  'Group=tala-render': null,
  'RemoveIPC=yes': null,
  'IPAddressDeny=any': 'IPAddressDeny=any (a packet filter on the job) needs root; PrivateNetwork and RestrictAddressFamilies still apply',
};

/** `Key=Value` lines of a unit file's [Service] section, in order, comments and blanks dropped. */
export function serviceLines(file = PRODUCTION_UNIT) {
  const lines = [];
  let inService = false;
  for (const raw of fs.readFileSync(file, 'utf8').split('\n')) {
    const line = raw.trim();
    if (line.startsWith('[')) inService = line === '[Service]';
    else if (inService && line && !line.startsWith('#') && line.includes('=')) lines.push(line);
  }
  return lines;
}

/**
 * The [Service] lines for a developer's machine (per-user service manager).
 *   sofficeDir, fontsDir   a LibreOffice folder / extra fonts outside the system's own
 *   set, drop              change or remove lines, for tests that need a tiny ceiling
 *   binds                  extra read-only binds, "SRC:DST"
 *   stateDir               where a generated fonts.conf may be written
 * Returns the lines, the program path of the job inside the box, and the list of differences from production.
 */
export function developerLines({ sofficeDir, fontsDir, userland, set = [], drop = [], add = [], binds = [], stateDir } = {}) {
  const differences = [];
  let lines = serviceLines().filter((line) => {
    if (!(line in ROOT_ONLY)) return true;
    if (ROOT_ONLY[line]) differences.push(ROOT_ONLY[line]);
    return false;
  });
  const allBinds = [`${here}:/opt/tala-render`];
  const environment = ['TALA_RENDER_DEV_SHARED_USER=1'];
  let node = fs.realpathSync(process.execPath);
  let nodeInUsr = node.startsWith('/usr/') && !node.startsWith('/usr/local/');
  let job = '/opt/tala-render/render-job.mjs';
  if (userland) {
    // Another machine's programs, unpacked into a folder, in place of this machine's: every path the production
    // unit binds is taken from that folder, and the job runs from where install.sh puts it.
    const root = fs.realpathSync(userland);
    for (const need of ['usr/bin/node', 'usr/local/lib/tala-render/render-job.mjs']) {
      if (!fs.existsSync(path.join(root, need))) throw new Error(`userland ${root}: no ${need}`);
    }
    lines = lines.map((line) =>
      line.startsWith('BindReadOnlyPaths=')
        ? `BindReadOnlyPaths=${line.slice(18).split(/\s+/).filter(Boolean).map((p) => (p.startsWith('-') ? `-${root}${p.slice(1)}:${p.slice(1)}` : `${root}${p}:${p}`)).join(' ')}`
        : line
    );
    node = '/usr/bin/node';
    nodeInUsr = true;
    job = '/usr/local/lib/tala-render/render-job.mjs';
    differences.push(`programs, libraries and fonts come from ${root} (an unpacked copy of another machine's packages), at the production paths`);
  } else differences.push(`the job program is read from ${here} (bound at /opt/tala-render), not /usr/local/lib/tala-render`);
  if (!nodeInUsr) {
    allBinds.push(`${path.dirname(path.dirname(node))}:/opt/node`);
    differences.push(`node is ${node} (bound at /opt/node)`);
  }
  if (sofficeDir) {
    const dir = fs.realpathSync(sofficeDir);
    if (!fs.existsSync(path.join(dir, 'program', 'soffice.bin'))) throw new Error(`no program/soffice.bin in ${dir}`);
    allBinds.push(`${dir}:/opt/libreoffice`);
    environment.push('TALA_RENDER_SOFFICE=/opt/libreoffice/program/soffice.bin');
    differences.push(`LibreOffice is ${dir} (bound at /opt/libreoffice), not the system package`);
  }
  if (fontsDir) {
    if (!stateDir) throw new Error('fontsDir needs a stateDir for the generated fonts.conf');
    const dir = fs.realpathSync(fontsDir);
    const conf = path.join(stateDir, 'fonts.conf');
    fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(conf, '<?xml version="1.0"?>\n<!DOCTYPE fontconfig SYSTEM "urn:fontconfig:fonts.dtd">\n<fontconfig>\n  <include ignore_missing="yes">/etc/fonts/fonts.conf</include>\n  <dir>/opt/fonts</dir>\n</fontconfig>\n');
    allBinds.push(`${dir}:/opt/fonts`, `${conf}:/opt/fonts.conf`);
    environment.push('TALA_RENDER_FONTCONFIG_FILE=/opt/fonts.conf');
    differences.push(`extra fonts from ${dir} (bound at /opt/fonts)`);
  }
  for (const b of binds) {
    if (!/^\/[^:]+:\/[^:]+$/.test(b)) throw new Error(`bind ${b}: SRC:DST with absolute paths`);
    allBinds.push(b);
  }
  for (const key of drop) {
    const before = lines.length;
    lines = lines.filter((line) => !line.startsWith(`${key}=`));
    if (lines.length === before) throw new Error(`drop ${key}: the production unit has no such line`);
    differences.push(`dropped for a test: ${key}`);
  }
  for (const pair of set) {
    const eq = pair.indexOf('=');
    if (eq < 1) throw new Error(`set ${pair}: Key=Value`);
    const key = pair.slice(0, eq);
    if (key === 'Environment') {
      environment.push(pair.slice(eq + 1));
    } else {
      const at = lines.findIndex((line) => line.startsWith(`${key}=`));
      if (at < 0) throw new Error(`set ${key}: the production unit has no such line (add lines there, not here)`);
      lines[at] = pair;
    }
    differences.push(`changed for a test: ${pair}`);
  }
  // What the per-user manager hands to every unit and the job must not carry (see ENV_OK in render-job.mjs).
  const keep = new Set(['PATH', 'LANG', 'HOME', 'USER', 'LOGNAME', 'SHELL']);
  const inherited = execFileSync('systemctl', ['--user', 'show-environment'], { encoding: 'utf8' })
    .split('\n')
    .map((line) => line.split('=')[0])
    .filter((n) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(n) && !keep.has(n));
  // Lines a test adds on top (only ones that take something away from the job).
  for (const line of add) {
    if (!/^(InaccessiblePaths|ReadOnlyPaths|NoExecPaths)=/.test(line)) throw new Error(`add ${line}: only InaccessiblePaths=, ReadOnlyPaths= or NoExecPaths=`);
    lines.push(line);
    differences.push(`added for a test: ${line}`);
  }
  lines.push(`BindReadOnlyPaths=${allBinds.join(' ')}`, ...environment.map((e) => `Environment=${e}`), ...(inherited.length ? [`UnsetEnvironment=${inherited.join(' ')}`] : []));
  return { lines, differences, node: nodeInUsr ? node : '/opt/node/bin/node', job };
}

/** Small argument reader shared by the scripts: `--key value`, repeated keys collected for the names in `many`. */
export function readArgs(argv, many = []) {
  const options = Object.fromEntries(many.map((k) => [k, []]));
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--') {
      rest.push(...argv.slice(i + 1));
      break;
    }
    if (!argv[i].startsWith('--')) {
      rest.push(argv[i]);
      continue;
    }
    const key = argv[i].slice(2).replace(/-([a-z])/g, (_m, c) => c.toUpperCase());
    if (key === 'user' || key === 'quiet' || key === 'slow') {
      options[key] = true;
      continue;
    }
    const value = argv[++i];
    if (value === undefined) throw new Error(`--${argv[i - 1].slice(2)} needs a value`);
    if (many.includes(key)) options[key].push(value);
    else options[key] = value;
  }
  return { options, rest };
}
