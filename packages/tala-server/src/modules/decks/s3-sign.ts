/**
 * AWS Signature Version 4 for S3-compatible object storage (Cloudflare R2 here), on node:crypto alone.
 *
 * Pure functions, no I/O: the canonical request, the string to sign and the signature, so each step can be tested
 * against AWS's own published examples (s3-sign.test.ts). Only what Tala's object client needs: header
 * signing (no presigned URLs: a link to a teacher's file is never handed out), S3's path encoding (each byte
 * outside the unreserved set, once; slashes kept; no normalising), and sorted query parameters.
 */
import { createHash, createHmac } from 'node:crypto';

export const EMPTY_PAYLOAD_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

export interface SignInput {
  method: string;
  /** The path as stored, NOT encoded: '/bucket/teachers/a/uploads/b/original'. Encoded here, once. */
  path: string;
  /** Query parameters, not encoded. Order does not matter. */
  query?: ReadonlyArray<readonly [string, string]>;
  /** Every header to sign, `host` among them, exactly as they will be sent (names in any case). */
  headers: Readonly<Record<string, string>>;
  /** Hex SHA-256 of the body (EMPTY_PAYLOAD_SHA256 for none). Must equal the `x-amz-content-sha256` header when S3 needs one. */
  payloadHash: string;
  region: string;
  service: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** YYYYMMDDTHHMMSSZ */
  amzDate: string;
}

export interface Signed {
  authorization: string;
  signedHeaders: string;
  canonicalRequest: string;
  stringToSign: string;
  signature: string;
}

/** RFC 3986 encoding as AWS wants it: every byte but A–Z a–z 0–9 - _ . ~ as %XX with upper-case hex. */
export function awsEncode(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/** S3's canonical URI: each segment encoded once, the slashes between them kept. */
export function canonicalPath(path: string): string {
  const p = path.startsWith('/') ? path : `/${path}`;
  return p.split('/').map(awsEncode).join('/');
}

export function canonicalQuery(query: ReadonlyArray<readonly [string, string]> = []): string {
  return query
    .map(([k, v]) => [awsEncode(k), awsEncode(v)] as const)
    .sort(([ak, av], [bk, bv]) => (ak < bk ? -1 : ak > bk ? 1 : av < bv ? -1 : av > bv ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
}

const sha256Hex = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
const hmac = (key: Buffer | string, data: string) => createHmac('sha256', key).update(data, 'utf8').digest();

export function signV4(input: SignInput): Signed {
  const headers = Object.entries(input.headers)
    .map(([name, value]) => [name.toLowerCase().trim(), String(value).trim().replace(/\s+/g, ' ')] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  if (!headers.some(([name]) => name === 'host')) throw new Error('the host header must be signed');
  const signedHeaders = headers.map(([name]) => name).join(';');
  const canonicalRequest = [
    input.method.toUpperCase(),
    canonicalPath(input.path),
    canonicalQuery(input.query),
    headers.map(([name, value]) => `${name}:${value}\n`).join(''),
    signedHeaders,
    input.payloadHash,
  ].join('\n');
  const day = input.amzDate.slice(0, 8);
  const scope = `${day}/${input.region}/${input.service}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', input.amzDate, scope, sha256Hex(canonicalRequest)].join('\n');
  const key = hmac(hmac(hmac(hmac(`AWS4${input.secretAccessKey}`, day), input.region), input.service), 'aws4_request');
  const signature = createHmac('sha256', key).update(stringToSign, 'utf8').digest('hex');
  return {
    authorization: `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    signedHeaders,
    canonicalRequest,
    stringToSign,
    signature,
  };
}

/** `Date` → the YYYYMMDDTHHMMSSZ form signing wants. */
export function amzDate(at: Date): string {
  return at.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}
