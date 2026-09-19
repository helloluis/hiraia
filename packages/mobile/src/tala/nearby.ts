import { AppState, PermissionsAndroid, Platform } from 'react-native';
import { profileSnapshot } from '../profiles';
import { newId, type Event } from '../telemetry/core';
import { subscribeTala, talaNative } from 'hiraia-tala';
import {
  MAX_EVENTS,
  MAX_PROFILES,
  SCHEMA,
  applyAck,
  sanitizeProfile,
  type AckBody,
  type InnerBatch,
  type TeacherEvent,
  type TeacherProfile,
} from './protocol';
import { TeacherQueue } from './queue';
import { parseTeacherQr, sameBinding, QrError } from './qr';
import { BURST_MS, retryDelay } from './schedule';

import {
  b64urlDecode,
  b64urlEncode,
  manualAad,
  manualProof,
  manualResponseKey,
  manualSecret,
  normalizeCode,
  type ManualCrypto,
} from './manual';

export type TalaUiState =
  | 'idle'
  | 'unbound'
  | 'searching'
  | 'connected'
  | 'sending'
  | 'synced'
  | 'error';

type Listener = () => void;
const listeners = new Set<Listener>();
let ui: {
  state: TalaUiState;
  detail: string;
  bound: boolean;
  lastSync: number;
  lost: number;
} = { state: 'unbound', detail: '', bound: false, lastSync: 0, lost: 0 };

function emit() {
  for (const fn of listeners) fn();
}
export function talaSnapshot() {
  return ui;
}
export function subscribeTalaUi(fn: Listener) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

let queue: TeacherQueue | undefined;
let installationId = '';
let enabled = true;
let running = false;
let unsubNative: (() => void) | undefined;
let appSub: { remove(): void } | undefined;
let retryTimer: ReturnType<typeof setTimeout> | undefined;
let burstTimer: ReturnType<typeof setTimeout> | undefined;
let missesWithoutTeacher = 0;
let foundTeacherThisBurst = false;
const connecting = new Set<string>();
const sessions = new Map<
  string,
  {
    challenge?: string;
    sessionKey?: string;
    phase: 'wait-challenge' | 'wait-manual-key' | 'wait-ready' | 'wait-ack';
    outstanding?: string[];
    didEmptyBatch?: boolean;
  }
>();

let pendingManual:
  | {
      code: string;
      confirmRebind: () => Promise<boolean>;
      clientNonce?: Uint8Array;
    }
  | undefined;

function setUi(partial: Partial<typeof ui>) {
  ui = { ...ui, ...partial };
  emit();
}

function clearTimers() {
  if (retryTimer) clearTimeout(retryTimer);
  if (burstTimer) clearTimeout(burstTimer);
  retryTimer = undefined;
  burstTimer = undefined;
}

function mayRetryAutomatically() {
  return enabled && AppState.currentState === 'active' && !!queue && !pendingManual;
}

function scheduleRetry() {
  if (!mayRetryAutomatically()) return;
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = setTimeout(() => {
    retryTimer = undefined;
    void startTalaSession();
  }, retryDelay(missesWithoutTeacher));
}

function profiles(): TeacherProfile[] {
  const list = profileSnapshot().profiles.map((p) => ({ id: p.id, name: p.name }));
  const clean = list.map(sanitizeProfile).filter((p): p is TeacherProfile => !!p);
  if (clean.length) return clean;
  if (ID_OK(installationId)) return [{ id: installationId, name: 'Guest' }];
  return [];
}
function ID_OK(id: string) {
  return /^[A-Za-z0-9_-]{16,80}$/.test(id);
}

async function inner(
  classId: string,
  challenge: string,
  events: TeacherEvent[]
): Promise<InnerBatch> {
  return {
    schema: SCHEMA,
    class_id: classId,
    installation_id: installationId,
    challenge,
    profiles: profiles().slice(0, MAX_PROFILES),
    events,
  };
}

async function sendEnvelope(
  endpointId: string,
  type: 'intro' | 'batch',
  challenge: string,
  publicKey: string,
  body: InnerBatch
) {
  const native = talaNative();
  if (!native) throw new Error('native');
  const text = JSON.stringify(body);
  if (text.length > 150_000) throw new Error('inner-size');
  const enc = await native.encryptRequest(publicKey, challenge, text);
  const session = sessions.get(endpointId);
  if (session) session.sessionKey = enc.session_key;
  const outer = JSON.stringify({
    v: 1,
    type,
    wrapped_key: enc.wrapped_key,
    nonce: enc.nonce,
    ciphertext: enc.ciphertext,
  });
  if (outer.length > 180_000) throw new Error('outer-size');
  await native.send(endpointId, outer);
  return enc.session_key;
}

function nativeCrypto(): ManualCrypto {
  const native = talaNative();
  if (!native) throw new Error('native');
  return {
    async sha256(bytes) {
      return b64urlDecode(await native.sha256(b64urlEncode(bytes)));
    },
    async hmacSha256(key, message) {
      return b64urlDecode(await native.hmacSha256(b64urlEncode(key), b64urlEncode(message)));
    },
  };
}

async function sendManualEnroll(endpointId: string, challenge: string) {
  const native = talaNative();
  if (!native || !pendingManual) return;
  const nonceB64 = await native.randomBytes(16);
  const clientNonce = b64urlDecode(nonceB64);
  pendingManual.clientNonce = clientNonce;
  const secret = await manualSecret(pendingManual.code, nativeCrypto());
  const proof = await manualProof(secret, challenge, clientNonce, nativeCrypto());
  const payload = JSON.stringify({
    v: 1,
    type: 'manual_enroll',
    client_nonce: b64urlEncode(clientNonce),
    proof: b64urlEncode(proof),
  });
  if (payload.length > 2048) throw new Error('manual-size');
  await native.send(endpointId, payload);
}

async function acceptManualKey(
  endpointId: string,
  challenge: string,
  nonce: string,
  ciphertext: string
) {
  const native = talaNative();
  if (!native || !pendingManual?.clientNonce) throw new Error('manual');
  const secret = await manualSecret(pendingManual.code, nativeCrypto());
  const key = await manualResponseKey(secret, challenge, pendingManual.clientNonce, nativeCrypto());
  const aad = manualAad(challenge, pendingManual.clientNonce);
  const qrText = await native.decryptAesGcm(
    b64urlEncode(key),
    nonce,
    b64urlEncode(aad),
    ciphertext
  );
  const qr = parseTeacherQr(qrText);
  const prev = await queue!.binding();
  if (prev && !sameBinding(qr, prev)) {
    if (!(await pendingManual.confirmRebind())) {
      pendingManual = undefined;
      await talaNative()?.stop();
      return;
    }
  }
  pendingManual = undefined;
  await queue!.bind({ class_id: qr.class_id, public_key: qr.public_key, bound_at: Date.now() });
  setUi({ state: 'connected', bound: true, detail: '' });
  const session = sessions.get(endpointId);
  if (!session) return;
  session.phase = 'wait-ready';
  const body = await inner(qr.class_id, challenge, []);
  await sendEnvelope(endpointId, 'intro', challenge, qr.public_key, body);
}

async function onBytes(endpointId: string, json: string) {
  let msg: { v?: number; type?: string; challenge?: string; nonce?: string; ciphertext?: string };
  try {
    msg = JSON.parse(json) as typeof msg;
  } catch {
    return;
  }
  if (msg.v !== 1 || !msg.type) return;
  const session = sessions.get(endpointId);
  const native = talaNative();
  if (!session || !native) return;
  const binding = await queue?.binding();

  if (msg.type === 'challenge' && typeof msg.challenge === 'string') {
    session.challenge = msg.challenge;
    setUi({ state: 'connected', detail: '' });
    if (pendingManual) {
      session.phase = 'wait-manual-key';
      await sendManualEnroll(endpointId, msg.challenge);
      return;
    }
    if (!binding) return;
    session.phase = 'wait-ready';
    const body = await inner(binding.class_id, msg.challenge, []);
    await sendEnvelope(endpointId, 'intro', msg.challenge, binding.public_key, body);
    return;
  }

  if (msg.type === 'manual_key' && session.challenge && pendingManual) {
    if (typeof msg.nonce !== 'string' || typeof msg.ciphertext !== 'string') return;
    await acceptManualKey(endpointId, session.challenge, msg.nonce, msg.ciphertext);
    return;
  }

  if ((msg.type === 'ready' || msg.type === 'ack') && session.sessionKey && session.challenge) {
    if (typeof msg.nonce !== 'string' || typeof msg.ciphertext !== 'string') return;
    const plain = await native.decryptResponse(
      session.sessionKey,
      session.challenge,
      msg.nonce,
      msg.ciphertext
    );
    const ack = JSON.parse(plain) as AckBody;
    if (msg.type === 'ready') {
      if (ack.challenge !== session.challenge) throw new Error('ready-challenge');
      session.phase = 'wait-ack';
      await sendNextBatch(endpointId);
      return;
    }
    const outstanding = session.outstanding ?? [];
    const result = applyAck(outstanding, ack, session.challenge);
    if (!result.ok) throw new Error(result.reason);
    await queue!.ack(result.done, result.lost);
    await sendNextBatch(endpointId);
  }
}

async function sendNextBatch(endpointId: string) {
  const session = sessions.get(endpointId);
  const binding = await queue?.binding();
  if (!session?.challenge || !binding || !queue) return;
  const pending = await queue.pending(MAX_EVENTS);
  if (!pending.length && session.didEmptyBatch) {
    await queue.markSynced();
    sessions.delete(endpointId);
    connecting.delete(endpointId);
    setUi({ state: 'synced', lastSync: Date.now(), detail: '' });
    // A completed exchange is the natural end of this short radio burst. The scheduler
    // starts another foreground look later, rather than leaving Nearby in a stale state.
    await finishSearchBurst(true);
    return;
  }
  setUi({ state: 'sending', detail: '' });
  const body = await inner(binding.class_id, session.challenge, pending);
  session.outstanding = body.events.map((e) => e.id);
  if (!body.events.length) session.didEmptyBatch = true;
  await sendEnvelope(endpointId, 'batch', session.challenge, binding.public_key, body);
}

function jitter(ms: number) {
  return ms * (0.5 + Math.random());
}

async function onFound(endpointId: string) {
  if (connecting.has(endpointId) || sessions.has(endpointId)) return;
  foundTeacherThisBurst = true;
  connecting.add(endpointId);
  await new Promise((r) => setTimeout(r, jitter(2500)));
  if (!running) {
    connecting.delete(endpointId);
    return;
  }
  const native = talaNative();
  try {
    await native?.requestConnection(endpointId);
    sessions.set(endpointId, { phase: 'wait-challenge' });
  } catch {
    connecting.delete(endpointId);
    setUi({ state: 'searching', detail: 'retry' });
    setTimeout(() => {
      if (running) void onFound(endpointId);
    }, jitter(4000));
  }
}

async function nearbyPermissions(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  const api = Number(Platform.Version);
  const perms = PermissionsAndroid.PERMISSIONS;
  const list = [
    perms.ACCESS_FINE_LOCATION,
    api >= 31 ? perms.BLUETOOTH_SCAN : undefined,
    api >= 31 ? perms.BLUETOOTH_CONNECT : undefined,
    api >= 31 ? perms.BLUETOOTH_ADVERTISE : undefined,
    api >= 33 ? (perms as Record<string, string | undefined>).NEARBY_WIFI_DEVICES : undefined,
  ].filter((p): p is (typeof perms)[keyof typeof perms] => !!p);
  const result = await PermissionsAndroid.requestMultiple(list);
  return Object.values(result).every((v) => v === PermissionsAndroid.RESULTS.GRANTED);
}

/** Stop one bounded discovery burst and arrange the next automatic foreground look. */
async function finishSearchBurst(synced = false): Promise<void> {
  if (!running) return;
  if (burstTimer) clearTimeout(burstTimer);
  burstTimer = undefined;
  running = false;
  connecting.clear();
  sessions.clear();
  try {
    await talaNative()?.stop();
  } catch {
    /* radios may already be down */
  }
  const bound = !!(await queue?.binding());
  if (!synced && !foundTeacherThisBurst) missesWithoutTeacher += 1;
  else if (foundTeacherThisBurst || synced) missesWithoutTeacher = 0;
  if (!synced && ui.state !== 'error') setUi({ state: bound ? 'idle' : 'unbound', bound });
  if (bound) scheduleRetry();
}

export async function startTalaSession(): Promise<void> {
  // A discovery burst is already live. Native Nearby also treats startDiscovery as idempotent,
  // but avoiding a second permission request makes app-focus changes harmless.
  if (running) return;
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = undefined;
  }
  const native = talaNative();
  if (!native) {
    setUi({ state: 'error', detail: 'play-services' });
    return;
  }
  if (!native.playServicesOk()) {
    setUi({ state: 'error', detail: 'play-services' });
    return;
  }
  const bound = !!(await queue?.binding());
  if (!pendingManual && (!bound || !enabled)) {
    setUi({ state: bound ? 'idle' : 'unbound', detail: '' });
    return;
  }
  const granted = await nearbyPermissions();
  if (!granted) {
    setUi({ state: 'error', detail: 'permission' });
    return;
  }
  running = true;
  foundTeacherThisBurst = false;
  setUi({ state: 'searching', detail: '' });
  try {
    await native.startDiscovery();
    burstTimer = setTimeout(() => {
      burstTimer = undefined;
      void finishSearchBurst();
    }, BURST_MS);
  } catch {
    running = false;
    setUi({ state: 'error', detail: 'nearby' });
    if (!pendingManual) {
      missesWithoutTeacher += 1;
      scheduleRetry();
    }
  }
}

export async function stopTalaSession(): Promise<void> {
  clearTimers();
  running = false;
  connecting.clear();
  sessions.clear();
  try {
    await talaNative()?.stop();
  } catch {
    /* radios may already be down */
  }
  const bound = !!(await queue?.binding());
  if (ui.state !== 'synced') setUi({ state: bound ? 'idle' : 'unbound' });
}

export async function syncNow(): Promise<void> {
  // A student explicitly asking to sync is a fresh attempt, not a fourth missed look.
  missesWithoutTeacher = 0;
  await stopTalaSession();
  await startTalaSession();
}

export async function enrollQr(text: string, confirmRebind: () => Promise<boolean>): Promise<void> {
  const qr = parseTeacherQr(text);
  const prev = await queue!.binding();
  if (prev && !sameBinding(qr, prev)) {
    if (!(await confirmRebind())) return;
  }
  pendingManual = undefined;
  await queue!.bind({ class_id: qr.class_id, public_key: qr.public_key, bound_at: Date.now() });
  setUi({ state: 'idle', bound: true, detail: '' });
  await startTalaSession();
}

export async function enrollCode(
  typed: string,
  confirmRebind: () => Promise<boolean>
): Promise<void> {
  const code = normalizeCode(typed);
  if (!code) throw new QrError('code');
  await stopTalaSession();
  pendingManual = { code, confirmRebind };
  setUi({ state: 'searching', detail: '' });
  await startTalaSession();
}

export async function leaveClass(): Promise<void> {
  pendingManual = undefined;
  await stopTalaSession();
  await queue!.unbind();
  setUi({ state: 'unbound', bound: false, lastSync: 0, detail: '' });
}

export function teacherTrack(events: Event[]): void {
  if (!enabled || !queue) return;
  void queue.enqueue(
    events.map((e) => ({
      id: e.id,
      name: e.name,
      occurred_at: e.occurred_at,
      session_id: e.session_id,
      props: e.props,
    }))
  );
}

export async function initTala(opts: {
  store: ConstructorParameters<typeof TeacherQueue>[0];
  installationId: string;
  enabled: boolean;
}): Promise<() => void> {
  queue = new TeacherQueue(opts.store, Date.now, newId);
  installationId = opts.installationId;
  enabled = opts.enabled;
  const binding = await queue.binding();
  const lastSync = await opts.store.lastSync();
  const lost = await opts.store.lost();
  setUi({
    bound: !!binding,
    lastSync,
    lost,
    state: binding ? 'idle' : 'unbound',
    detail: '',
  });
  unsubNative?.();
  unsubNative = subscribeTala((e) => {
    void (async () => {
      try {
        if (e.kind === 'found') await onFound(e.endpointId);
        else if (e.kind === 'lost') connecting.delete(e.endpointId);
        else if (e.kind === 'connection' && e.status === 'disconnected') {
          const waiting = sessions.get(e.endpointId)?.phase === 'wait-manual-key';
          sessions.delete(e.endpointId);
          connecting.delete(e.endpointId);
          if (waiting && pendingManual) setUi({ state: 'error', detail: 'code' });
          else if (running && ui.state !== 'synced') setUi({ state: 'searching' });
        } else if (e.kind === 'connection' && e.status === 'failed') {
          sessions.delete(e.endpointId);
          connecting.delete(e.endpointId);
          if (pendingManual) setUi({ state: 'error', detail: 'code' });
        } else if (e.kind === 'bytes') await onBytes(e.endpointId, e.json);
        else if (e.kind === 'error') setUi({ state: 'error', detail: e.message });
      } catch {
        setUi({ state: 'error', detail: 'sync' });
      }
    })();
  });
  appSub?.remove();
  appSub = AppState.addEventListener('change', (state) => {
    if (state === 'active') {
      if (enabled) void startTalaSession();
    } else {
      void stopTalaSession();
    }
  });
  if (AppState.currentState === 'active' && binding && enabled) void startTalaSession();
  return () => {
    unsubNative?.();
    appSub?.remove();
    void stopTalaSession();
  };
}

export async function setTalaEnabled(value: boolean) {
  enabled = value;
  if (!value) {
    await stopTalaSession();
    const bound = !!(await queue?.binding());
    setUi({ state: bound ? 'idle' : 'unbound' });
  } else if (AppState.currentState === 'active') {
    void startTalaSession();
  }
}

export { QrError, parseTeacherQr };
