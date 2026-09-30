'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { fileURLToPath, pathToFileURL } = require('node:url');

/** App-owned roots only, including when a parent is a symlink or Windows junction. */
function inside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function createStorage({ rendererRoot, dataRoot }) {
  fs.mkdirSync(dataRoot, { recursive: true });
  rendererRoot = fs.realpathSync(rendererRoot);
  dataRoot = fs.realpathSync(dataRoot);
  const document = path.join(dataRoot, 'documents');
  const cache = path.join(dataRoot, 'cache');
  const databases = path.join(document, 'SQLite');
  for (const dir of [document, cache, databases]) fs.mkdirSync(dir, { recursive: true });
  const handles = new Map();
  const connections = new Map();
  let nextHandle = 1;

  function resolve(input, write = false) {
    if (typeof input !== 'string' || input.includes('\0') || input.length > 32768) throw new Error('Invalid file path');
    let candidate;
    if (input.startsWith('hiraia://app/')) {
      const url = new URL(input);
      candidate = path.resolve(rendererRoot, '.' + decodeURIComponent(url.pathname));
      if (!inside(rendererRoot, candidate)) throw new Error('Asset path leaves the application');
    } else if (input.startsWith('hiraia://file/')) {
      candidate = fileURLToPath(decodeURIComponent(new URL(input).pathname.slice(1)));
    } else {
      candidate = input.startsWith('file:') ? fileURLToPath(input) : path.resolve(input);
    }
    const roots = write ? [dataRoot] : [dataRoot, rendererRoot];
    if (!roots.some(root => inside(root, candidate))) throw new Error('File access outside Hiraia storage');
    let ancestor = candidate;
    while (!fs.existsSync(ancestor)) {
      const parent = path.dirname(ancestor);
      if (parent === ancestor) throw new Error('Missing storage root');
      ancestor = parent;
    }
    const real = fs.realpathSync(ancestor);
    if (!roots.some(root => inside(root, real))) throw new Error('Symlink leaves Hiraia storage');
    return candidate;
  }

  function stat(input) {
    const file = resolve(input);
    try {
      const s = fs.statSync(file);
      return { exists: true, isDirectory: s.isDirectory(), size: s.size, modificationTime: s.mtimeMs / 1000, uri: pathToFileURL(file).href };
    } catch (error) {
      if (error.code === 'ENOENT') return { exists: false, isDirectory: false, size: 0, uri: pathToFileURL(file).href };
      throw error;
    }
  }

  function memory() {
    const totalBytes = os.totalmem();
    const availableBytes = os.freemem();
    const disk = fs.statfsSync(dataRoot);
    const thresholdBytes = Math.min(1024 ** 3, totalBytes * 0.1);
    return { totalBytes, availableBytes, thresholdBytes, freeStorageBytes: disk.bavail * disk.bsize,
      lowMemory: availableBytes < thresholdBytes, lowRamDevice: totalBytes < 3.5 * 1024 ** 3 };
  }

  function database(name) {
    if (typeof name !== 'string' || !/^[a-zA-Z0-9_-]+\.db$/.test(name)) throw new Error('Invalid database name');
    if (!connections.has(name)) {
      const { DatabaseSync, constants } = require('node:sqlite');
      const db = new DatabaseSync(resolve(path.join(databases, name), true), { allowExtension: false });
      // No SQL request may reach files outside its one app-owned connection.
      if (typeof db.setAuthorizer === 'function') db.setAuthorizer((action, arg1) => {
        if (action === constants.SQLITE_ATTACH || action === constants.SQLITE_DETACH) return constants.SQLITE_DENY;
        if (action === constants.SQLITE_PRAGMA && /^(writable_schema|temp_store_directory|data_store_directory)$/i.test(arg1 ?? '')) return constants.SQLITE_DENY;
        return constants.SQLITE_OK;
      });
      db.exec('PRAGMA busy_timeout=2000');
      connections.set(name, db);
    }
    return connections.get(name);
  }

  function sql(name, operation, query, parameters = []) {
    if (typeof query !== 'string' || query.length > 200000 || /\b(attach|detach|load_extension|writable_schema|temp_store_directory|data_store_directory|vacuum\s+into)\b/i.test(query)) throw new Error('SQL operation is not allowed');
    if (!Array.isArray(parameters) || parameters.length > 32766) throw new Error('Invalid SQL parameters');
    const db = database(name);
    if (operation === 'exec') { db.exec(query); return null; }
    const statement = db.prepare(query);
    if (operation === 'all') return statement.all(...parameters);
    if (operation === 'first') return statement.get(...parameters) ?? null;
    if (operation === 'run') {
      const result = statement.run(...parameters);
      return { changes: Number(result.changes), lastInsertRowId: Number(result.lastInsertRowid) };
    }
    throw new Error('Unknown database operation');
  }

  const sync = {
    'fs.stat': stat,
    'fs.read': (input, encoding) => {
      const file = resolve(input);
      if (fs.statSync(file).size > 64 * 1024 ** 2) throw new Error('Use bounded reads for large files');
      const data = fs.readFileSync(file);
      return encoding === 'utf8' ? data.toString('utf8') : new Uint8Array(data);
    },
    'fs.write': (input, value) => {
      if (!(typeof value === 'string' || value instanceof Uint8Array) || value.length > 64 * 1024 ** 2) throw new Error('Invalid file contents');
      fs.writeFileSync(resolve(input, true), value);
    },
    'fs.mkdir': (input, options = {}) => fs.mkdirSync(resolve(input, true), { recursive: !!(options.intermediates || options.idempotent) }),
    'fs.remove': (input) => {
      const target = resolve(input, true);
      if ([dataRoot, document, cache, databases].includes(target)) throw new Error('Cannot remove a storage root');
      fs.rmSync(target, { recursive: true, force: true });
    },
    'fs.copy': (from, to) => fs.copyFileSync(resolve(from), resolve(to, true)),
    'fs.move': (from, to) => fs.renameSync(resolve(from, true), resolve(to, true)),
    'fs.list': (input) => fs.readdirSync(resolve(input), { withFileTypes: true }).map(entry => ({ name: entry.name, isDirectory: entry.isDirectory() })),
    'fs.open': (input) => {
      if (handles.size >= 64) throw new Error('Too many open files');
      const id = nextHandle++;
      handles.set(id, fs.openSync(resolve(input), 'r'));
      return id;
    },
    'fs.readRange': (id, offset, length) => {
      if (!handles.has(id) || !Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(length) || length < 0 || length > 1024 ** 2) throw new Error('Invalid file read');
      const bytes = Buffer.alloc(length);
      const n = fs.readSync(handles.get(id), bytes, 0, length, offset);
      return new Uint8Array(bytes.subarray(0, n));
    },
    'fs.close': (id) => { if (handles.has(id)) fs.closeSync(handles.get(id)); handles.delete(id); },
    'db.query': sql,
    memory,
  };

  async function hash(input, algorithm = 'md5') {
    if (!['md5', 'sha256'].includes(algorithm)) throw new Error('Unsupported digest');
    const digest = crypto.createHash(algorithm);
    for await (const chunk of fs.createReadStream(resolve(input))) digest.update(chunk);
    return digest.digest('hex');
  }

  function close() {
    for (const fd of handles.values()) fs.closeSync(fd);
    handles.clear();
    for (const db of connections.values()) db.close();
    connections.clear();
  }
  const uri = value => pathToFileURL(value).href + '/';
  return { resolve, stat, memory, database, sql, sync, hash, close,
    paths: { document: uri(document), cache: uri(cache), database: uri(databases) } };
}

module.exports = { inside, createStorage };
