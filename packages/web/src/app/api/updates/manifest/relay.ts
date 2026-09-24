/**
 * Expo Updates protocol v1, served as a RELAY of pre-signed artifacts.
 *
 * Hiraia 0.4.24+ phones ask this route for OTA JS updates (packages/mobile/src/updates/ota.ts;
 * app.json `updates.url`). Nothing here can mint an update: deploy/publish-ota.py builds and
 * SIGNS each manifest (or rollBackToEmbedded directive) on Luis's Mac with a key that never
 * leaves it, and uploads immutable objects to R2. This route only picks which one a phone
 * should see and passes its exact signed bytes through. A compromised web server can at worst
 * withhold or replay an update the phones would have accepted anyway.
 *
 * R2 layout (public origin https://assets.hiraia.org, HIRAIA_OTA_ORIGIN to override):
 *   ota/android/<runtime>/channel.json                      mutable pointer (rings, below)
 *   ota/android/<runtime>/updates/<id>/manifest.json(.sig)  immutable, signed
 *   ota/android/<runtime>/directives/<id>/directive.json(.sig)
 *   ota/android/assets/<sha256>                              immutable assets (the manifest's URLs)
 * `<runtime>` is the APK's fingerprint runtime version (40 hex; packages/mobile/
 * fingerprint.config.js). A phone only ever asks about its own, so a channel never leaks
 * across APK builds.
 *
 * RINGS (channel.json, written only by the publisher):
 *   canary      an allowlist of EAS-Client-ID values (the per-install id expo-updates sends)
 *               and the release they get; null release = canary phones follow production.
 *   production  the release, a rollout percentage, and an optional fallback for phones
 *               outside the rollout (normally the previous release). A phone is inside the
 *               rollout when sha256(release id + client id) lands below the percentage —
 *               stable for that release, so raising the percentage only ever adds phones,
 *               and a fresh cohort goes first on the next release.
 *
 * ANSWERS: 204 when nothing applies or the phone already runs the chosen update; otherwise
 * multipart/mixed with ONE part (`manifest` or `directive`) whose body is the signed bytes and
 * whose `expo-signature` header carries the signature. Every answer carries
 * expo-protocol-version 1 — a 204 without it is a protocol error to the client.
 *
 * CACHING: channel.json is re-read at most every CHANNEL_TTL_MS and the last good copy is
 * kept through R2 blips; signed bodies are immutable and cached for good. Upstream reads for
 * runtimes with no known channel are budgeted, so a spray of made-up runtime headers cannot
 * turn this route into an R2 request amplifier — nor starve the real runtimes: a runtime
 * with a real channel refreshes outside the budget (at most once per TTL, and only the
 * publisher can create one), and is never evicted to make room for a "nothing here" entry.
 * So a spray cannot hold back a rollback directive. What remains: straight after a restart,
 * before any phone of a real runtime got through, its first read competes with the spray.
 *
 * Launch-failure reports ride along for free: Expo-Fatal-Error and
 * Expo-Recent-Failed-Update-IDs are logged per request. When they appear, halt the rollout.
 */
import { createHash, randomBytes, verify, type KeyObject } from 'node:crypto';

export const CHANNEL_TTL_MS = 60_000;
/** Upstream reads per minute for runtimes with no known channel (real channels refresh free). */
export const UPSTREAM_BUDGET_PER_MINUTE = 120;
export const MAX_RUNTIMES = 256;
const MAX_BODIES = 64;
const FETCH_TIMEOUT_MS = 8_000;

const RUNTIME = /^[0-9a-f]{40}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CLIENT_ID = /^[A-Za-z0-9-]{8,64}$/;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/** Headers on EVERY answer, 204 and errors included (expo-updates spec, protocol 1). */
export const PROTOCOL_HEADERS: Readonly<Record<string, string>> = {
  'expo-protocol-version': '1',
  'expo-sfv-version': '0',
  'cache-control': 'private, max-age=0',
};

export type ReleaseKind = 'update' | 'rollBackToEmbedded';
export interface Release {
  kind: ReleaseKind;
  id: string;
}
export interface Channel {
  runtimeVersion: string;
  canary: { clients: ReadonlySet<string>; release: Release | null };
  production: { release: Release | null; rollout: number; fallback: Release | null };
}

function parseRelease(raw: unknown): Release | null | undefined {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const { kind, id } = raw as Record<string, unknown>;
  if (kind !== 'update' && kind !== 'rollBackToEmbedded') return undefined;
  if (typeof id !== 'string' || !UUID.test(id)) return undefined;
  return { kind, id };
}

/**
 * Validate channel.json for `runtime`. Returns null when ANY part is malformed: a pointer the
 * publisher did not write correctly is not one to guess at. (`history` and unknown keys are
 * the publisher's business and ignored.)
 */
export function parseChannel(raw: unknown, runtime: string): Channel | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const c = raw as Record<string, unknown>;
  if (c.format !== 1 || c.runtimeVersion !== runtime) return null;
  const canary = (c.canary ?? {}) as Record<string, unknown>;
  const production = (c.production ?? {}) as Record<string, unknown>;
  if ([canary, production].some((ring) => typeof ring !== 'object' || Array.isArray(ring))) return null;
  const clients = canary.clients ?? [];
  if (!Array.isArray(clients) || !clients.every((id) => typeof id === 'string' && CLIENT_ID.test(id))) return null;
  const canaryRelease = parseRelease(canary.release);
  const release = parseRelease(production.release);
  const fallback = parseRelease(production.fallback);
  const rollout = production.rollout ?? 100;
  if (canaryRelease === undefined || release === undefined || fallback === undefined) return null;
  if (typeof rollout !== 'number' || !Number.isInteger(rollout) || rollout < 0 || rollout > 100) return null;
  return {
    runtimeVersion: runtime,
    canary: { clients: new Set(clients.map((id: string) => id.toLowerCase())), release: canaryRelease },
    production: { release, rollout, fallback },
  };
}

/** 0–99, stable for a (release, client) pair. */
export function rolloutBucket(releaseId: string, clientId: string): number {
  const digest = createHash('sha256').update(`hiraia-ota-rollout-v1:${releaseId}:${clientId.toLowerCase()}`).digest();
  return digest.readUInt32BE(0) % 100;
}

/** Which release (if any) this phone should see, and through which ring. */
export function chooseRelease(
  channel: Channel,
  clientId: string | null,
): { ring: 'canary' | 'production' | 'fallback'; release: Release } | null {
  const client = clientId?.toLowerCase() ?? null;
  if (client && channel.canary.release && channel.canary.clients.has(client)) {
    return { ring: 'canary', release: channel.canary.release };
  }
  const { release, rollout, fallback } = channel.production;
  if (release) {
    // No client id, no stable bucket: such a phone only sees a release that is at 100%.
    const inside = rollout >= 100 || (client !== null && rolloutBucket(release.id, client) < rollout);
    if (inside) return { ring: 'production', release };
  }
  return fallback ? { ring: 'fallback', release: fallback } : null;
}

/** R2 keys of a release's signed body and its detached signature. */
export function releaseKeys(runtime: string, release: Release): { body: string; signature: string } {
  const body =
    release.kind === 'update'
      ? `ota/android/${runtime}/updates/${release.id}/manifest.json`
      : `ota/android/${runtime}/directives/${release.id}/directive.json`;
  return { body, signature: `${body}.sig` };
}

/** `expo-signature` value: an Expo SFV dictionary whose sig is a string item. */
export function signatureHeader(signature: string): string {
  return `sig="${signature}", keyid="main"`;
}

/** One-part multipart/mixed body, CRLF-delimited (RFC 2046) — what OkHttp's MultipartReader reads. */
export function multipartBody(
  boundary: string,
  part: { name: 'manifest' | 'directive'; body: Uint8Array; signature: string },
): Uint8Array<ArrayBuffer> {
  const head = Buffer.from(
    `--${boundary}\r\n` +
      'content-type: application/json; charset=utf-8\r\n' +
      `content-disposition: form-data; name="${part.name}"\r\n` +
      `expo-signature: ${signatureHeader(part.signature)}\r\n\r\n`,
    'utf8',
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
  const out = new Uint8Array(head.length + part.body.length + tail.length);
  out.set(head, 0);
  out.set(part.body, head.length);
  out.set(tail, head.length + part.body.length);
  return out;
}

interface SignedPart {
  name: 'manifest' | 'directive';
  body: Uint8Array;
  signature: string;
}

/** Printable, single-line, bounded: phone-supplied text going into the server log. */
const loggable = (s: string | null, max = 300) =>
  s ? s.replace(/[^\x20-\x7e]/g, '?').slice(0, max) : '';

export interface RelayOptions {
  /** Public R2 origin, no trailing slash. */
  origin: string;
  /** Public key (or certificate) phones verify against; null skips the pre-serve check. */
  publicKey: KeyObject | null;
  fetch?: typeof fetch;
  now?: () => number;
  log?: (line: string) => void;
}

export class Relay {
  private readonly channels = new Map<string, { at: number; channel: Channel | null }>();
  private readonly inflight = new Map<string, Promise<Channel | null>>();
  private readonly bodies = new Map<string, SignedPart>();
  private budget = { start: 0, used: 0 };
  private readonly fetch: typeof fetch;
  private readonly now: () => number;
  private readonly log: (line: string) => void;

  constructor(private readonly options: RelayOptions) {
    this.fetch = options.fetch ?? fetch;
    this.now = options.now ?? Date.now;
    this.log = options.log ?? ((line) => console.log(line));
  }

  async handle(headers: Headers): Promise<Response> {
    const platform = headers.get('expo-platform');
    const runtime = headers.get('expo-runtime-version') ?? '';
    if (headers.get('expo-protocol-version') !== '1') return this.reply(400, 'expo-protocol-version 1 required');
    if (platform !== 'android') return this.reply(400, 'expo-platform must be android');
    if (!RUNTIME.test(runtime)) return this.reply(400, 'expo-runtime-version must be a 40-hex fingerprint');

    const rawClient = headers.get('eas-client-id');
    const client = rawClient && CLIENT_ID.test(rawClient) ? rawClient : null;
    const current = (headers.get('expo-current-update-id') ?? '').toLowerCase();
    const fatal = headers.get('expo-fatal-error');
    const failed = headers.get('expo-recent-failed-update-ids');
    const tag = `rt=${runtime.slice(0, 12)} client=${client ?? '-'} current=${loggable(current, 36) || '-'}`;
    if (fatal || failed) {
      this.log(`[ota] LAUNCH FAILURE ${tag} failed=${loggable(failed) || '-'} fatal=${loggable(fatal) || '-'}`);
    }

    const channel = await this.channel(runtime);
    const choice = channel ? chooseRelease(channel, client) : null;
    if (!choice) {
      this.log(`[ota] 204 ${tag} (nothing published)`);
      return this.reply(204);
    }
    if (choice.release.kind === 'update' && choice.release.id === current) {
      this.log(`[ota] 204 ${tag} ring=${choice.ring} (already running)`);
      return this.reply(204);
    }
    let part: SignedPart;
    try {
      part = await this.signed(runtime, choice.release);
    } catch (error) {
      this.log(`[ota] 503 ${tag} ring=${choice.ring} ${choice.release.kind} ${choice.release.id}: ${error instanceof Error ? error.message : String(error)}`);
      return this.reply(503, 'update temporarily unavailable', { 'retry-after': '300' });
    }
    this.log(`[ota] 200 ${tag} ring=${choice.ring} ${choice.release.kind} ${choice.release.id}`);
    const boundary = `hiraia-ota-${randomBytes(12).toString('hex')}`;
    return new Response(multipartBody(boundary, part), {
      status: 200,
      headers: { ...PROTOCOL_HEADERS, 'content-type': `multipart/mixed; boundary=${boundary}` },
    });
  }

  private reply(status: number, error?: string, extra: Record<string, string> = {}): Response {
    if (status === 204) return new Response(null, { status, headers: { ...PROTOCOL_HEADERS, ...extra } });
    return Response.json({ error }, { status, headers: { ...PROTOCOL_HEADERS, ...extra } });
  }

  /** channel.json for `runtime`: fresh within the TTL, otherwise re-read (last good copy on failure). */
  private async channel(runtime: string): Promise<Channel | null> {
    const cached = this.channels.get(runtime);
    const now = this.now();
    if (cached && now - cached.at < CHANNEL_TTL_MS) return cached.channel;
    const pending = this.inflight.get(runtime);
    if (pending) return pending;
    // Only runtimes with no known channel pay: a real one is bounded by the TTL + inflight.
    if (!cached?.channel && !this.spend(now)) return null;
    const read = this.readChannel(runtime, cached?.channel ?? null).finally(() => this.inflight.delete(runtime));
    this.inflight.set(runtime, read);
    return read;
  }

  private spend(now: number): boolean {
    if (now - this.budget.start >= 60_000) this.budget = { start: now, used: 0 };
    if (this.budget.used >= UPSTREAM_BUDGET_PER_MINUTE) return false;
    this.budget.used++;
    return true;
  }

  private async readChannel(runtime: string, lastGood: Channel | null): Promise<Channel | null> {
    let channel: Channel | null = lastGood;
    try {
      const res = await this.get(`ota/android/${runtime}/channel.json`);
      if (res.status === 404) {
        channel = null;
      } else if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      } else {
        const parsed = parseChannel(await res.json(), runtime);
        if (!parsed) throw new Error('malformed channel.json');
        channel = parsed;
      }
    } catch (error) {
      this.log(`[ota] channel ${runtime.slice(0, 12)} unreadable (${error instanceof Error ? error.message : String(error)}) — ${lastGood ? 'keeping the last good copy' : 'serving nothing'}`);
    }
    // Stamped on failure too: a broken pointer is retried once per TTL, not once per phone.
    this.channels.delete(runtime);
    this.channels.set(runtime, { at: this.now(), channel });
    if (this.channels.size > MAX_RUNTIMES) {
      // Oldest "nothing here" entry first: a real channel never makes room for a made-up runtime.
      let victim: string | undefined;
      for (const [key, entry] of this.channels) {
        if (!entry.channel) {
          victim = key;
          break;
        }
      }
      this.channels.delete(victim ?? this.channels.keys().next().value!);
    }
    return channel;
  }

  /** The signed body + signature for a release, checked before it is ever served. */
  private async signed(runtime: string, release: Release): Promise<SignedPart> {
    const keys = releaseKeys(runtime, release);
    const hit = this.bodies.get(keys.body);
    if (hit) return hit;
    const [bodyRes, sigRes] = await Promise.all([this.get(keys.body), this.get(keys.signature)]);
    if (!bodyRes.ok || !sigRes.ok) throw new Error(`signed artifact missing (HTTP ${bodyRes.status}/${sigRes.status})`);
    const body = new Uint8Array(await bodyRes.arrayBuffer());
    const signature = (await sigRes.text()).trim();
    if (!BASE64.test(signature)) throw new Error('signature file is not base64');
    const doc = JSON.parse(Buffer.from(body).toString('utf8')) as Record<string, unknown>;
    if (release.kind === 'update') {
      if (doc.id !== release.id || doc.runtimeVersion !== runtime) throw new Error('manifest does not match channel.json');
    } else {
      const commitTime = (doc.parameters as Record<string, unknown> | undefined)?.commitTime;
      if (doc.type !== 'rollBackToEmbedded' || typeof commitTime !== 'string') throw new Error('directive is malformed');
    }
    // What the phones will do (CodeSigningConfiguration.kt: SHA256withRSA over the exact
    // bytes): a body they would reject is not worth sending, and says the publisher broke.
    if (this.options.publicKey && !verify('sha256', body, this.options.publicKey, Buffer.from(signature, 'base64'))) {
      throw new Error('signature does not verify against the app certificate');
    }
    const part: SignedPart = { name: release.kind === 'update' ? 'manifest' : 'directive', body, signature };
    this.bodies.set(keys.body, part);
    if (this.bodies.size > MAX_BODIES) this.bodies.delete(this.bodies.keys().next().value!);
    return part;
  }

  private async get(key: string): Promise<Response> {
    return this.fetch(`${this.options.origin}/${key}`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  }
}
