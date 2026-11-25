/**
 * Where a teacher's uploaded file is kept: one object in a PRIVATE S3-compatible bucket (Cloudflare R2), under one
 * prefix per environment, at `<TALA_R2_PREFIX>teachers/<account id>/uploads/<upload id>/original`.
 *
 * - Only the web server holds the key, read from a file named by a setting (`TALA_R2_CREDENTIALS_FILE`). The drawing
 *   service never sees it: it is given the file over its socket and has no network.
 * - No link to an object is ever handed out. Every byte a teacher gets back passes through the server's own
 *   owner checks.
 * - Nothing here lists the bucket, sweeps it or expires anything. An object is removed only when its upload or its
 *   account is deleted (uploads.ts keeps a table of what it has written and what it still has to remove).
 * - Plain `fetch` and node:crypto: no new dependency.
 */
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import type { Logger } from '../../kernel/types';
import { amzDate, canonicalPath, EMPTY_PAYLOAD_SHA256, signV4 } from './s3-sign';

/* ---------------- settings ---------------- */

export const R2_SETTING_NAMES = ['TALA_R2_ENDPOINT', 'TALA_R2_BUCKET', 'TALA_R2_PREFIX', 'TALA_R2_REGION', 'TALA_R2_CREDENTIALS_FILE'] as const;

export interface R2Settings {
  /** https://<account>.r2.cloudflarestorage.com, no path. Never logged: it names the account. */
  endpoint: string;
  bucket: string;
  /** '' (local only) or segments each ending in '/', e.g. 'tala/production/'. Joined to a key as it is. */
  prefix: string;
  region: string;
  credentialsFile: string;
}

/**
 * - `database`: files stay in SQLite, in pieces (a developer's machine and the tests: TALA_ENV=local with no R2 setting);
 * - `r2`: files go to the bucket;
 * - `off`: nothing is taken. Staging and production with no setting, or any setting missing or unusable, anywhere.
 *   Never the database instead, and never a guess.
 */
export type StorageSetting = { kind: 'database' } | { kind: 'r2'; settings: R2Settings } | { kind: 'off'; problems: string[] };

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

export function storageSettingFromEnv(env: NodeJS.ProcessEnv = process.env): StorageSetting {
  const environment = env.TALA_ENV === 'staging' || env.TALA_ENV === 'production' ? env.TALA_ENV : 'local';
  const value = (name: (typeof R2_SETTING_NAMES)[number]) => (env[name] === undefined ? '' : String(env[name]).trim());
  if (R2_SETTING_NAMES.every((name) => value(name) === '')) {
    return environment === 'local'
      ? { kind: 'database' }
      : { kind: 'off', problems: ['TALA_R2_ENDPOINT, TALA_R2_BUCKET, TALA_R2_PREFIX and TALA_R2_CREDENTIALS_FILE are not set (uploaded files are kept only in private object storage)'] };
  }
  const problems: string[] = [];
  let endpoint = '';
  const rawEndpoint = value('TALA_R2_ENDPOINT');
  if (!rawEndpoint) problems.push('TALA_R2_ENDPOINT is not set');
  else {
    try {
      const u = new URL(rawEndpoint);
      if (u.username || u.password) problems.push('TALA_R2_ENDPOINT must not hold a user name or password');
      else if (!(u.protocol === 'https:' || (u.protocol === 'http:' && LOOPBACK.has(u.hostname)))) problems.push('TALA_R2_ENDPOINT must be https (plain http only on this machine)');
      else if ((u.pathname !== '' && u.pathname !== '/') || u.search || u.hash) problems.push('TALA_R2_ENDPOINT must be the address alone, with no path or query');
      else endpoint = `${u.protocol}//${u.host}`;
    } catch {
      problems.push('TALA_R2_ENDPOINT is not an address');
    }
  }
  const bucket = value('TALA_R2_BUCKET');
  if (!bucket) problems.push('TALA_R2_BUCKET is not set');
  else if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket)) problems.push('TALA_R2_BUCKET is not a bucket name');
  const prefix = value('TALA_R2_PREFIX');
  if (!prefix) {
    // Two environments that share a bucket must never write to the same names.
    if (environment !== 'local') problems.push('TALA_R2_PREFIX is not set (it is required outside a developer machine)');
  } else if (prefix.length > 200 || !/^(?:[A-Za-z0-9][A-Za-z0-9._-]{0,62}\/){1,8}$/.test(prefix)) {
    problems.push("TALA_R2_PREFIX must be one to eight plain folder names, each ending in '/', e.g. tala/production/");
  }
  const region = value('TALA_R2_REGION') || 'auto';
  if (!/^[a-z0-9-]{1,32}$/.test(region)) problems.push('TALA_R2_REGION is not a region name');
  const credentialsFile = value('TALA_R2_CREDENTIALS_FILE');
  if (!credentialsFile) problems.push('TALA_R2_CREDENTIALS_FILE is not set');
  else if (!isAbsolute(credentialsFile) || credentialsFile.includes('\0')) problems.push('TALA_R2_CREDENTIALS_FILE must be an absolute path');
  return problems.length ? { kind: 'off', problems } : { kind: 'r2', settings: { endpoint, bucket, prefix, region, credentialsFile } };
}

/** An object's name for one upload. The ids are the server's own (UUIDs); anything else is refused, not escaped. */
export function uploadObjectKey(prefix: string, ownerId: string, uploadId: string): string {
  const safe = /^[A-Za-z0-9_-]{1,64}$/;
  if (!safe.test(ownerId) || !safe.test(uploadId)) throw new Error('an id that cannot be part of an object name');
  return `${prefix}teachers/${ownerId}/uploads/${uploadId}/original`;
}

/* ---------------- errors ---------------- */

/**
 * - `unavailable`: the store did not answer in time, or answered with a failure of its own (5xx, 429), or the
 *   server is resting after such failures. Nothing is known to have changed; try again later.
 * - `refused`: the store answered "no" (a key it does not take, a request it rejects), also after one try with
 *   keys read again. Somebody has to look at the settings.
 * - `missing`: no such object. `exists`: an object of that name is already there (nothing was overwritten).
 * - `damaged`: the object is not what was recorded (size or SHA-256).
 */
export class StoreError extends Error {
  readonly kind: 'unavailable' | 'refused' | 'missing' | 'exists' | 'damaged';
  readonly status?: number;
  /** The store's own short error code, or ours: never a key, a name or file content. */
  readonly code?: string;
  constructor(kind: StoreError['kind'], status?: number, code?: string) {
    super(`object storage: ${kind}${status ? ` (${status}${code ? ` ${code}` : ''})` : code ? ` (${code})` : ''}`);
    this.name = 'StoreError';
    this.kind = kind;
    this.status = status;
    this.code = code;
  }
}

/* ---------------- credentials ---------------- */

export interface Credentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  /** ms since epoch, when the file says when the keys end. Only decides when to look at the file again. */
  expiresAt?: number;
}

export interface CredentialSource {
  /** The keys to sign with now. Throws StoreError('refused') when there are none that may be used. */
  current(): Credentials;
  /** Look at the file again now. True when it holds other keys than before (worth one more try). */
  reload(): boolean;
}

const CREDENTIAL_FIELDS = new Set(['accessKeyId', 'secretAccessKey', 'sessionToken', 'expiresAt']);

/** The credentials file's JSON. Errors name what is wrong, never a value. */
export function parseCredentials(text: string): Credentials {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('the credentials file is not JSON');
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('the credentials file is not one JSON object');
  const o = raw as Record<string, unknown>;
  const unknown = Object.keys(o).filter((k) => !CREDENTIAL_FIELDS.has(k));
  if (unknown.length) throw new Error(`the credentials file has fields this server does not know (${unknown.map((k) => k.slice(0, 32).replace(/[^A-Za-z0-9_]/g, '?')).join(', ')})`);
  if (typeof o.accessKeyId !== 'string' || !/^[A-Za-z0-9]{8,128}$/.test(o.accessKeyId)) throw new Error('accessKeyId is missing or not a key id');
  if (typeof o.secretAccessKey !== 'string' || !/^[\x21-\x7e]{16,256}$/.test(o.secretAccessKey)) throw new Error('secretAccessKey is missing or not a secret');
  if (o.sessionToken !== undefined && (typeof o.sessionToken !== 'string' || !/^[A-Za-z0-9+/=_.-]{1,8192}$/.test(o.sessionToken))) throw new Error('sessionToken is not a token');
  let expiresAt: number | undefined;
  if (o.expiresAt !== undefined) {
    expiresAt = typeof o.expiresAt === 'string' ? Date.parse(o.expiresAt) : NaN;
    if (!Number.isFinite(expiresAt)) throw new Error('expiresAt is not a date');
  }
  return { accessKeyId: o.accessKeyId, secretAccessKey: o.secretAccessKey, ...(o.sessionToken ? { sessionToken: o.sessionToken as string } : {}), ...(expiresAt !== undefined ? { expiresAt } : {}) };
}

/**
 * Keys read from a file, again whenever the file has changed (another inode after a rename, or another size or
 * time), at most every `checkEveryMs`; at once when the keys it holds are about to end (`expiresAt`, a minute
 * before) or when the store refused them. A file every user of the machine may read is refused: uploads stay off
 * until it is put right. A file that cannot be read or parsed keeps the keys read before (and says so once).
 */
export function credentialsFile(path: string, options: { checkEveryMs?: number; now?: () => number; log?: () => Logger | null } = {}): CredentialSource {
  const checkEveryMs = options.checkEveryMs ?? 2_000;
  const now = options.now ?? Date.now;
  let cached: Credentials | null = null;
  let stamp = '';
  let checkedAt = -Infinity;
  let lastProblem = '';
  let saidEnding = -Infinity;
  const problem = (what: string, dropKeys: boolean) => {
    if (dropKeys) cached = null;
    if (what !== lastProblem) options.log?.()?.error('deck_upload_storage_keys_unusable', { problem: what, keysKept: cached !== null });
    lastProblem = what;
  };
  const refresh = (force: boolean) => {
    checkedAt = now();
    let st;
    try {
      st = statSync(path);
    } catch (err) {
      // A folder this server's user may not enter looks like a missing file to it: say which.
      const code = (err as NodeJS.ErrnoException).code;
      return problem(code === 'EACCES' ? "the credentials file cannot be reached by this server's user (check the folder's and the file's owner and mode)" : 'the credentials file cannot be found', false);
    }
    if (!st.isFile()) return problem('the credentials file is not a regular file', true);
    if (st.mode & 0o004) return problem('the credentials file can be read by every user of the machine', true);
    const seen = `${st.ino}:${st.size}:${st.mtimeMs}:${st.ctimeMs}`;
    if (!force && seen === stamp && cached) return;
    let parsed: Credentials;
    try {
      parsed = parseCredentials(readFileSync(path, 'utf8'));
    } catch (err) {
      return problem(err instanceof Error && !(err as NodeJS.ErrnoException).code ? err.message : 'the credentials file cannot be read', false);
    }
    const changed = !cached || cached.accessKeyId !== parsed.accessKeyId || cached.secretAccessKey !== parsed.secretAccessKey || cached.sessionToken !== parsed.sessionToken;
    stamp = seen;
    cached = parsed;
    lastProblem = '';
    if (changed) options.log?.()?.info('deck_upload_storage_keys_read', { sessionToken: parsed.sessionToken !== undefined, ...(parsed.expiresAt !== undefined ? { until: new Date(parsed.expiresAt).toISOString() } : {}) });
  };
  return {
    current() {
      const t = now();
      const ending = cached?.expiresAt !== undefined && t >= cached.expiresAt - 60_000;
      if (!cached || ending || t - checkedAt >= checkEveryMs) refresh(false);
      if (!cached) throw new StoreError('refused', undefined, 'no_usable_keys');
      // Renewed every six hours for 24: under six hours left means renewals have been missing for most of a day.
      if (cached.expiresAt !== undefined && cached.expiresAt - t < 6 * 3_600_000 && t - saidEnding > 3_600_000) {
        saidEnding = t;
        options.log?.()?.warn('deck_upload_storage_keys_ending', { until: new Date(cached.expiresAt).toISOString(), hoursLeft: Math.max(0, Math.round((cached.expiresAt - t) / 360_000) / 10), effect: 'when they end, uploads and downloads of uploaded files stop until new keys are installed' });
      }
      return cached;
    },
    reload() {
      const before = cached;
      refresh(true);
      return cached !== null && (before === null || cached.accessKeyId !== before.accessKeyId || cached.secretAccessKey !== before.secretAccessKey || cached.sessionToken !== before.sessionToken);
    },
  };
}

/* ---------------- the object client ---------------- */

export interface ObjectStore {
  /** Store bytes under a name that must not exist yet (`If-None-Match: *`). `exists` when it does: nothing is overwritten. */
  putNew(key: string, bytes: Uint8Array, sha256: string): Promise<void>;
  /** The whole object, which must be `size` bytes with this SHA-256 (`damaged` otherwise; `missing` when gone). */
  readWhole(key: string, size: number, sha256: string): Promise<Uint8Array>;
  /** Read the object through and check it, keeping nothing (the read-back after a write). */
  verify(key: string, size: number, sha256: string): Promise<void>;
  /** Bytes `start`..`end`, both included. */
  readRange(key: string, start: number, end: number): Promise<Uint8Array>;
  /** Remove it. A name that is already gone counts as removed (a delete cannot tell the two apart). */
  remove(key: string): Promise<void>;
  /** Whether the store is answering; since when it is not. */
  health(): { down: boolean; downSince: number | null };
}

export interface ObjectStoreOptions {
  credentials: CredentialSource;
  /** Where the server's log is, once it is known (the module is made before the server starts). */
  log?: () => Logger | null;
  now?: () => number;
  fetch?: typeof fetch;
  /** A request may take this long, ms, plus `msPerMiB` for every MiB it carries. */
  baseTimeoutMs?: number;
  msPerMiB?: number;
  /** After a failure the server rests this long before asking again, doubling up to the second value, ms. */
  restMs?: readonly [number, number];
}

const MiB = 1024 * 1024;

export function objectStore(settings: R2Settings, options: ObjectStoreOptions): ObjectStore {
  const now = options.now ?? Date.now;
  const doFetch = options.fetch ?? fetch;
  const baseTimeoutMs = options.baseTimeoutMs ?? 10_000;
  const msPerMiB = options.msPerMiB ?? 1_000;
  const [restMin, restMax] = options.restMs ?? [2_000, 60_000];
  const log = () => options.log?.() ?? null;

  let restUntil = 0;
  let rest = 0;
  let downSince: number | null = null;
  const failed = (why: string) => {
    rest = rest ? Math.min(rest * 2, restMax) : restMin;
    restUntil = now() + rest;
    if (downSince === null) {
      downSince = now();
      log()?.error('deck_upload_storage_unavailable', { why });
    }
  };
  const answered = () => {
    if (downSince !== null) log()?.info('deck_upload_storage_back', { downMs: now() - downSince });
    downSince = null;
    rest = 0;
    restUntil = 0;
  };
  const timedOut = (err: unknown) => (err as Error)?.name === 'TimeoutError' || (err as Error)?.name === 'AbortError';
  const errorCode = async (res: Response): Promise<string | undefined> => {
    try {
      const text = (await res.text()).slice(0, 4096);
      return /<Code>([A-Za-z0-9]{1,64})<\/Code>/.exec(text)?.[1];
    } catch {
      return undefined;
    }
  };
  const discard = async (res: Response) => {
    try {
      await res.body?.cancel();
    } catch {
      /* nothing to give back */
    }
  };

  type Op = { method: 'PUT' | 'GET' | 'DELETE'; key: string; body?: Uint8Array; payloadHash?: string; range?: readonly [number, number]; ifNoneMatch?: boolean; md5?: string; bytes: number };
  /** One signed request, tried again once when the store refuses the keys and the file holds new ones. */
  async function send(op: Op): Promise<{ res: Response; signal: AbortSignal }> {
    if (now() < restUntil) throw new StoreError('unavailable', undefined, 'resting');
    const path = `/${settings.bucket}/${op.key}`;
    const url = settings.endpoint + canonicalPath(path);
    const host = new URL(url).host;
    for (let attempt = 0; ; attempt++) {
      const keys = options.credentials.current();
      const date = amzDate(new Date(now()));
      const payloadHash = op.payloadHash ?? EMPTY_PAYLOAD_SHA256;
      const signed: Record<string, string> = { host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': date };
      if (keys.sessionToken) signed['x-amz-security-token'] = keys.sessionToken;
      if (op.range) signed.range = `bytes=${op.range[0]}-${op.range[1]}`;
      if (op.ifNoneMatch) signed['if-none-match'] = '*';
      if (op.md5) signed['content-md5'] = op.md5;
      const { authorization } = signV4({ method: op.method, path, headers: signed, payloadHash, region: settings.region, service: 's3', accessKeyId: keys.accessKeyId, secretAccessKey: keys.secretAccessKey, amzDate: date });
      const headers = new Headers({ authorization, 'accept-encoding': 'identity' });
      for (const [name, v] of Object.entries(signed)) if (name !== 'host') headers.set(name, v);
      if (op.body) headers.set('content-type', 'application/octet-stream');
      const signal = AbortSignal.timeout(baseTimeoutMs + Math.ceil(op.bytes / MiB) * msPerMiB);
      let res: Response;
      try {
        res = await doFetch(url, { method: op.method, headers, ...(op.body ? { body: op.body as unknown as BodyInit } : {}), redirect: 'manual', signal });
      } catch (err) {
        failed(timedOut(err) ? 'timeout' : 'network');
        throw new StoreError('unavailable', undefined, timedOut(err) ? 'timeout' : 'network');
      }
      if (res.status === 401 || res.status === 403) {
        const code = await errorCode(res);
        // An expired key looks like a wrong one (R2 answers SignatureDoesNotMatch): read the file again, and try
        // once more only when it holds other keys.
        if (attempt === 0 && options.credentials.reload()) continue;
        answered();
        throw new StoreError('refused', res.status, code);
      }
      if (res.status >= 500 || res.status === 429 || (res.status >= 300 && res.status < 400)) {
        await discard(res);
        failed(`status ${res.status}`);
        throw new StoreError('unavailable', res.status);
      }
      answered();
      return { res, signal };
    }
  }

  /** Reads a body to its end into `into` (or only hashes it), checking its length and checksum on the way. */
  async function drain(res: Response, size: number, into: Buffer | null, sha256: string | null): Promise<void> {
    const hash = sha256 ? createHash('sha256') : null;
    let at = 0;
    try {
      if (res.body) {
        for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
          if (at + chunk.length > size) {
            await discard(res);
            throw new StoreError('damaged', res.status, 'longer_than_recorded');
          }
          if (into) into.set(chunk, at);
          hash?.update(chunk);
          at += chunk.length;
        }
      }
    } catch (err) {
      if (err instanceof StoreError) throw err;
      failed(timedOut(err) ? 'timeout' : 'network');
      throw new StoreError('unavailable', undefined, timedOut(err) ? 'timeout' : 'network');
    }
    if (at !== size) throw new StoreError('damaged', res.status, 'shorter_than_recorded');
    if (hash && hash.digest('hex') !== sha256) throw new StoreError('damaged', res.status, 'checksum');
  }

  async function getWhole(key: string, size: number, sha256: string, keep: boolean): Promise<Buffer | null> {
    const { res } = await send({ method: 'GET', key, bytes: size });
    if (res.status === 404) {
      await discard(res);
      throw new StoreError('missing', 404);
    }
    if (res.status !== 200) {
      const code = await errorCode(res);
      throw new StoreError('refused', res.status, code);
    }
    const declared = res.headers.get('content-length');
    if (declared !== null && Number(declared) !== size) {
      await discard(res);
      throw new StoreError('damaged', 200, 'size');
    }
    const into = keep ? Buffer.allocUnsafeSlow(size) : null;
    await drain(res, size, into, sha256);
    return into;
  }

  return {
    async putNew(key, bytes, sha256) {
      const md5 = createHash('md5').update(bytes).digest('base64');
      const { res } = await send({ method: 'PUT', key, body: bytes, payloadHash: sha256, ifNoneMatch: true, md5, bytes: bytes.length });
      if (res.status === 412) {
        await discard(res);
        throw new StoreError('exists', 412);
      }
      if (res.status !== 200 && res.status !== 201 && res.status !== 204) {
        const code = await errorCode(res);
        throw new StoreError('refused', res.status, code);
      }
      await discard(res);
    },
    async readWhole(key, size, sha256) {
      const whole = (await getWhole(key, size, sha256, true))!;
      return new Uint8Array(whole.buffer, whole.byteOffset, whole.byteLength);
    },
    async verify(key, size, sha256) {
      await getWhole(key, size, sha256, false);
    },
    async readRange(key, start, end) {
      const wanted = end - start + 1;
      if (!(start >= 0 && wanted > 0)) throw new StoreError('damaged', undefined, 'range');
      const { res } = await send({ method: 'GET', key, range: [start, end], bytes: wanted });
      if (res.status === 404) {
        await discard(res);
        throw new StoreError('missing', 404);
      }
      if (res.status === 416) {
        await discard(res);
        throw new StoreError('damaged', 416, 'shorter_than_recorded');
      }
      // A store that ignores the range and sends the whole object is taken only when that is exactly the range.
      if (res.status !== 206 && !(res.status === 200 && start === 0 && Number(res.headers.get('content-length')) === wanted)) {
        const code = await errorCode(res);
        throw new StoreError('refused', res.status, code);
      }
      const into = Buffer.allocUnsafeSlow(wanted);
      await drain(res, wanted, into, null);
      return new Uint8Array(into.buffer, into.byteOffset, into.byteLength);
    },
    async remove(key) {
      const { res } = await send({ method: 'DELETE', key, bytes: 0 });
      if (res.status === 200 || res.status === 202 || res.status === 204 || res.status === 404) {
        await discard(res);
        return;
      }
      const code = await errorCode(res);
      throw new StoreError('refused', res.status, code);
    },
    health: () => ({ down: downSince !== null, downSince }),
  };
}
