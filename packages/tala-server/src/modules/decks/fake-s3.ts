/**
 * A small S3-compatible server for tests and rehearsals, on this machine only (127.0.0.1): path-style
 * PUT / GET (with Range) / HEAD / DELETE on one bucket, `If-None-Match: *`, Content-MD5, and Signature Version 4
 * checked on every request (keys, session tokens, the payload hash, the clock). It answers like R2 where R2 was
 * measured (25 Nov 2026): 412 on an existing name, 404 NoSuchKey, 204 for any delete, 403 AccessDenied outside a
 * key's prefix, 403 SignatureDoesNotMatch for an expired key.
 *
 * Faults can be ordered for the next requests (an outage, a slow or hanging store, 5xx, a dropped connection, a
 * body that comes back changed or short), so that every failure case can be tested without a real outage.
 *
 * The signature check uses this package's own signer, so it is not an independent check of the signer: that is
 * done against AWS's published examples (s3-sign.test.ts) and against real R2 in a rehearsal.
 */
import { createHash } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { signV4 } from './s3-sign';

export interface FakeKey {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  /** Only names under this prefix (as R2's keys for one prefix). */
  prefix?: string;
  readOnly?: boolean;
  /** After this time (ms) the key is refused as R2 refuses an expired one. */
  expiresAt?: number;
}

export type FakeFault = {
  /** Which requests: by method, and by a part of the object's name. All when left out. */
  method?: 'PUT' | 'GET' | 'HEAD' | 'DELETE';
  keyIncludes?: string;
  /** How many requests it applies to (1 when left out; Infinity until cleared). */
  times?: number;
} & (
  | { kind: 'status'; status: number; code?: string }
  | { kind: 'delay'; ms: number }
  /** No answer at all, until the client gives up. */
  | { kind: 'hang' }
  /** The connection is closed without an answer. */
  | { kind: 'drop' }
  /** GET: one byte of the answer is changed. PUT: the object is stored with one byte changed, and answered 200. */
  | { kind: 'corrupt' }
  /** GET: the answer stops half way (the connection is closed). */
  | { kind: 'truncate' }
  /** PUT: the object is stored, but the client is never told (the connection is closed). */
  | { kind: 'store-then-drop' }
);

export interface FakeS3 {
  endpoint: string;
  bucket: string;
  /** Object name (without the bucket) → bytes. Tests may look and change. */
  objects: Map<string, Uint8Array>;
  keys: FakeKey[];
  fault(f: FakeFault): void;
  clearFaults(): void;
  /** Every request: method, name, the status answered ('-' when none was). */
  requests: Array<{ method: string; key: string; status: number | '-' }>;
  close(): Promise<void>;
}

const xmlError = (code: string, message: string) => `<?xml version="1.0" encoding="UTF-8"?><Error><Code>${code}</Code><Message>${message}</Message></Error>`;

export async function startFakeS3(options: { bucket?: string; keys: FakeKey[]; now?: () => number; port?: number } ): Promise<FakeS3> {
  const bucket = options.bucket ?? 'tala-test';
  const now = options.now ?? Date.now;
  const objects = new Map<string, Uint8Array>();
  const faults: FakeFault[] = [];
  const requests: FakeS3['requests'] = [];
  const keys = options.keys;

  const takeFault = (method: string, key: string): FakeFault | null => {
    const at = faults.findIndex((f) => (!f.method || f.method === method) && (!f.keyIncludes || key.includes(f.keyIncludes)));
    if (at < 0) return null;
    const f = faults[at]!;
    const left = (f.times ?? 1) - 1;
    if (left <= 0) faults.splice(at, 1);
    else faults[at] = { ...f, times: left };
    return f;
  };

  const answer = (res: ServerResponse, log: { status: number | '-' }, status: number, body?: string | Uint8Array, headers: Record<string, string> = {}) => {
    log.status = status;
    res.writeHead(status, { ...(typeof body === 'string' ? { 'content-type': 'application/xml' } : {}), ...headers });
    res.end(body);
  };

  /** Checks the signature as S3 does; null when it holds, else the error to answer. */
  const authenticate = (req: IncomingMessage, path: string, body: Buffer): { status: number; code: string } | FakeKey => {
    const auth = req.headers.authorization ?? '';
    const m = /^AWS4-HMAC-SHA256 Credential=([A-Za-z0-9]+)\/(\d{8})\/([a-z0-9-]+)\/s3\/aws4_request, ?SignedHeaders=([a-z0-9;-]+), ?Signature=([0-9a-f]{64})$/.exec(auth);
    if (!m) return { status: 403, code: 'AccessDenied' };
    const [, akid, day, region, signedList, signature] = m;
    const key = keys.find((k) => k.accessKeyId === akid);
    if (!key) return { status: 403, code: 'InvalidAccessKeyId' };
    if (key.expiresAt !== undefined && now() >= key.expiresAt) return { status: 403, code: 'SignatureDoesNotMatch' };
    const date = String(req.headers['x-amz-date'] ?? '');
    if (!/^\d{8}T\d{6}Z$/.test(date) || date.slice(0, 8) !== day) return { status: 403, code: 'AccessDenied' };
    const at = Date.UTC(+date.slice(0, 4), +date.slice(4, 6) - 1, +date.slice(6, 8), +date.slice(9, 11), +date.slice(11, 13), +date.slice(13, 15));
    if (Math.abs(now() - at) > 15 * 60_000) return { status: 403, code: 'RequestTimeTooSkewed' };
    const names = signedList!.split(';');
    if (!names.includes('host') || Object.keys(req.headers).some((h) => h.startsWith('x-amz-') && !names.includes(h))) return { status: 403, code: 'AccessDenied' };
    if (key.sessionToken !== undefined && (req.headers['x-amz-security-token'] !== key.sessionToken || !names.includes('x-amz-security-token'))) return { status: 403, code: 'InvalidToken' };
    const payloadHash = String(req.headers['x-amz-content-sha256'] ?? '');
    if (payloadHash !== 'UNSIGNED-PAYLOAD' && payloadHash !== createHash('sha256').update(body).digest('hex')) return { status: 400, code: 'XAmzContentSHA256Mismatch' };
    const headers: Record<string, string> = {};
    for (const name of names) {
      const v = req.headers[name];
      if (v === undefined) return { status: 403, code: 'AccessDenied' };
      headers[name] = Array.isArray(v) ? v.join(',') : v;
    }
    const expected = signV4({ method: req.method ?? '', path, headers, payloadHash, region: region!, service: 's3', accessKeyId: akid!, secretAccessKey: key.secretAccessKey, amzDate: date });
    if (expected.signature !== signature) return { status: 403, code: 'SignatureDoesNotMatch' };
    return key;
  };

  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      void (async () => {
        const body = Buffer.concat(chunks);
        const url = new URL(req.url ?? '/', 'http://fake');
        const rawPath = url.pathname;
        let path: string;
        try {
          path = rawPath.split('/').map(decodeURIComponent).join('/');
        } catch {
          return answer(res, { status: 0 }, 400, xmlError('InvalidURI', 'bad path'));
        }
        const name = path.startsWith(`/${bucket}/`) ? path.slice(bucket.length + 2) : '';
        const method = req.method ?? '';
        const log: { method: string; key: string; status: number | '-' } = { method, key: name, status: '-' };
        requests.push(log);
        const fault = takeFault(method, name);
        if (fault?.kind === 'delay') await new Promise((r) => setTimeout(r, fault.ms));
        if (fault?.kind === 'hang') return; // never answered; the client's own time limit ends it
        if (fault?.kind === 'drop') return req.socket.destroy();
        if (fault?.kind === 'status') return answer(res, log, fault.status, xmlError(fault.code ?? 'InternalError', 'injected'));
        const who = authenticate(req, path, body);
        if ('status' in who) return answer(res, log, who.status, xmlError(who.code, 'refused'));
        if (!path.startsWith(`/${bucket}/`) || !name) return answer(res, log, 403, xmlError('AccessDenied', 'not this bucket'));
        if (who.prefix !== undefined && !name.startsWith(who.prefix)) return answer(res, log, 403, xmlError('AccessDenied', 'outside the prefix'));
        if (method === 'PUT') {
          if (who.readOnly) return answer(res, log, 403, xmlError('AccessDenied', 'read only'));
          const md5 = req.headers['content-md5'];
          if (md5 !== undefined && md5 !== createHash('md5').update(body).digest('base64')) return answer(res, log, 400, xmlError('BadDigest', 'md5'));
          if (req.headers['if-none-match'] === '*' && objects.has(name)) return answer(res, log, 412, xmlError('PreconditionFailed', 'exists'));
          const stored = new Uint8Array(body);
          if (fault?.kind === 'corrupt' && stored.length) stored[stored.length >> 1] = stored[stored.length >> 1]! ^ 0xff;
          objects.set(name, stored);
          if (fault?.kind === 'store-then-drop') return req.socket.destroy();
          return answer(res, log, 200, '', { etag: `"${createHash('md5').update(stored).digest('hex')}"` });
        }
        if (method === 'DELETE') {
          if (who.readOnly) return answer(res, log, 403, xmlError('AccessDenied', 'read only'));
          objects.delete(name);
          return answer(res, log, 204);
        }
        if (method === 'GET' || method === 'HEAD') {
          const obj = objects.get(name);
          if (!obj) return answer(res, log, 404, method === 'HEAD' ? undefined : xmlError('NoSuchKey', 'missing'));
          let status = 200;
          let part = obj;
          const range = req.headers.range;
          if (range !== undefined) {
            const r = /^bytes=(\d+)-(\d+)$/.exec(range);
            if (!r || +r[1]! > +r[2]! || +r[1]! >= obj.length) return answer(res, log, 416, xmlError('InvalidRange', 'range'));
            part = obj.subarray(+r[1]!, Math.min(obj.length, +r[2]! + 1));
            status = 206;
          }
          if (method === 'HEAD') return answer(res, log, 200, undefined, { 'content-length': String(obj.length) });
          let out = Buffer.from(part);
          if (fault?.kind === 'corrupt' && out.length) {
            out = Buffer.from(out);
            out[out.length >> 1] = out[out.length >> 1]! ^ 0xff;
          }
          log.status = status;
          res.writeHead(status, { 'content-length': String(out.length), 'content-type': 'application/octet-stream', ...(status === 206 ? { 'content-range': `bytes ${+(/^bytes=(\d+)/.exec(range!)![1]!)}-${+(/^bytes=(\d+)/.exec(range!)![1]!) + out.length - 1}/${obj.length}` } : {}) });
          if (fault?.kind === 'truncate') {
            res.write(out.subarray(0, out.length >> 1));
            return setTimeout(() => req.socket.destroy(), 5);
          }
          return res.end(out);
        }
        return answer(res, log, 405, xmlError('MethodNotAllowed', 'method'));
      })().catch(() => {
        try {
          res.destroy();
        } catch {
          /* gone */
        }
      });
    });
  });
  await new Promise<void>((resolve) => server.listen(options.port ?? 0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    endpoint: `http://127.0.0.1:${port}`,
    bucket,
    objects,
    keys,
    fault: (f) => void faults.push(f),
    clearFaults: () => void faults.splice(0),
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}
