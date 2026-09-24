import { AppState, PermissionsAndroid, Platform } from 'react-native';
import { profileScope, profileSnapshot } from '../profiles';
import { type Event } from '../telemetry/core';
import { subscribeTala, talaNative } from 'hiraia-tala';
import {
  LEAVE_CAP,
  MAX_EVENTS,
  SCHEMA,
  applyAck,
  cleanClassName,
  type AckBody,
  type InnerBatch,
  type TeacherEvent,
} from './protocol';
import { TeacherQueue } from './queue';
import { parseTeacherQr, sameBinding, QrError } from './qr';
import { BURST_MS, retryDelay } from './schedule';
import { eventScope } from './scope';
import {
  accepted,
  buildGroups,
  burstDone,
  candidates,
  classHint,
  endpointName,
  findGroup,
  groupSynced,
  leavesFor,
  lost as endpointLost,
  manualUnreachable,
  newBurst,
  nextManualEndpoint,
  nextMisses,
  regroup,
  rejected,
  seen,
  type Burst,
  type Group,
} from './sessionCore';

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
/** Everything here describes the student on screen; siblings in other classes sync unseen. */
let ui: {
  state: TalaUiState;
  detail: string;
  bound: boolean;
  lastSync: number;
  lost: number;
  /** Class name from the enrolment QR or the teacher's reply; '' when neither gave one. */
  className: string;
  /** This student was in the phone-wide 0.4.23 class, which the upgrade dropped: re-scan. */
  rejoin: boolean;
} = {
  state: 'unbound',
  detail: '',
  bound: false,
  lastSync: 0,
  lost: 0,
  className: '',
  rejoin: false,
};

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
/** Students with a class. Events of anyone else never touch the teacher queue. */
let boundScopes = new Set<string>();
let burst: Burst = newBurst([]);
/** The student on screen synced this burst; a sibling's later traffic must not repaint that. */
let activeSynced = false;
let writes: Promise<void> = Promise.resolve();
const hints = new Map<string, string>();
/** Endpoints being connected or connected, each with its attempt: a newer one supersedes it. */
const connecting = new Map<string, number>();
let attempts = 0;
const sessions = new Map<
  string,
  {
    /** Group key; undefined while a typed code is being exchanged. */
    group?: string;
    challenge?: string;
    sessionKey?: string;
    phase: 'wait-challenge' | 'wait-manual-key' | 'wait-ready' | 'wait-ack';
    outstanding?: string[];
    didEmptyBatch?: boolean;
    /** Leave tombstones the intro carried; cleared once the teacher says it honours them. */
    leaves?: string[];
    clientNonce?: Uint8Array;
  }
>();
type Session = NonNullable<ReturnType<typeof sessions.get>>;

let pendingManual:
  | {
      code: string;
      /** The student who typed the code: a code joins only them. */
      scope: string;
      confirmRebind: () => Promise<boolean>;
    }
  | undefined;
/** The one teacher currently being asked to accept the typed code. */
let manualEndpoint: string | undefined;

function setUi(partial: Partial<typeof ui>) {
  ui = { ...ui, ...partial };
  emit();
}

/** Radio progress is shown only to a student it concerns: one in a class, or joining one. */
function showStatus(state: TalaUiState, detail = '') {
  if ((!ui.bound && !pendingManual) || activeSynced) return;
  setUi({ state, detail });
}

function clearTimers() {
  if (retryTimer) clearTimeout(retryTimer);
  if (burstTimer) clearTimeout(burstTimer);
  retryTimer = undefined;
  burstTimer = undefined;
}

function mayRetryAutomatically() {
  return (
    enabled &&
    AppState.currentState === 'active' &&
    !!queue &&
    !pendingManual &&
    boundScopes.size > 0
  );
}

function scheduleRetry() {
  if (!mayRetryAutomatically()) return;
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = setTimeout(() => {
    retryTimer = undefined;
    void startTalaSession();
  }, retryDelay(missesWithoutTeacher));
}

/** Re-read which students have a class, and what the student on screen should see. */
async function refreshBindings() {
  if (!queue) return;
  const scope = profileScope();
  const bindings = await queue.bindings();
  boundScopes = new Set(bindings.map((b) => b.scope));
  const mine = bindings.find((b) => b.scope === scope);
  const droppedAt = mine ? 0 : await queue.rejoinNotice(scope);
  // A profile created after the upgrade never had a class to lose.
  const created = profileSnapshot().profiles.find((p) => p.id === scope)?.createdAt ?? 0;
  setUi({
    bound: !!mine,
    className: mine?.class_name ?? '',
    lastSync: mine?.last_sync ?? 0,
    lost: mine?.dropped ?? 0,
    rejoin: droppedAt > 0 && created <= droppedAt,
  });
}

/** Every class this phone owes a teacher, grouped so classmates on one phone share a session. */
async function loadGroups(): Promise<Group[]> {
  if (!queue) return [];
  const [bindings, leaves] = await Promise.all([queue.bindings(), queue.leaves()]);
  boundScopes = new Set(bindings.map((b) => b.scope));
  const crypto = nativeCrypto();
  for (const { class_id } of [...bindings, ...leaves])
    if (!hints.has(class_id)) hints.set(class_id, await classHint(class_id, crypto.sha256));
  return buildGroups({
    bindings,
    leaves,
    hint: (classId) => hints.get(classId) ?? '',
    activeScope: profileScope(),
    installationId,
    profiles: profileSnapshot().profiles,
  });
}

function inner(
  group: Group,
  challenge: string,
  events: TeacherEvent[],
  leaves: string[]
): InnerBatch {
  return {
    schema: SCHEMA,
    class_id: group.class_id,
    installation_id: installationId,
    challenge,
    // Only this class's students: a sibling in another class must never appear here.
    profiles: group.profiles,
    events,
    ...(leaves.length ? { left_profiles: leaves } : {}),
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
  const session = sessions.get(endpointId);
  if (!session || !enabled) return;
  const text = JSON.stringify(body);
  if (text.length > 150_000) throw new Error('inner-size');
  const enc = await native.encryptRequest(publicKey, challenge, text);
  if (!enabled || sessions.get(endpointId) !== session) return;
  session.sessionKey = enc.session_key;
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

async function sendManualEnroll(endpointId: string, session: Session, challenge: string) {
  const native = talaNative();
  if (!native || !pendingManual) return;
  const nonceB64 = await native.randomBytes(16);
  const clientNonce = b64urlDecode(nonceB64);
  session.clientNonce = clientNonce;
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
  session: Session,
  nonce: string,
  ciphertext: string
) {
  const native = talaNative();
  const manual = pendingManual;
  if (!native || !manual || !session.challenge || !session.clientNonce) throw new Error('manual');
  const secret = await manualSecret(manual.code, nativeCrypto());
  const key = await manualResponseKey(
    secret,
    session.challenge,
    session.clientNonce,
    nativeCrypto()
  );
  const aad = manualAad(session.challenge, session.clientNonce);
  const qrText = await native.decryptAesGcm(
    b64urlEncode(key),
    nonce,
    b64urlEncode(aad),
    ciphertext
  );
  const qr = parseTeacherQr(qrText);
  const prev = await queue!.binding(manual.scope);
  if (prev && !sameBinding(qr, prev)) {
    if (!(await manual.confirmRebind())) {
      pendingManual = undefined;
      manualEndpoint = undefined;
      await stopTalaSession();
      return;
    }
  }
  pendingManual = undefined;
  manualEndpoint = undefined;
  await queue!.bind(manual.scope, {
    class_id: qr.class_id,
    public_key: qr.public_key,
    bound_at: Date.now(),
    class_name: qr.class_name,
  });
  regroup(burst, await loadGroups());
  await refreshBindings();
  showStatus('connected');
  // Teachers that waited while the code was tried can serve the phone's other classes now.
  offerSeenEndpoints();
  const group = burst.groups.find((g) => g.scopes.includes(manual.scope));
  if (!group || sessions.get(endpointId) !== session) return;
  session.group = group.key;
  await sendIntro(endpointId, session);
}

async function sendIntro(endpointId: string, session: Session) {
  let group = findGroup(burst, session.group);
  // Another teacher may have taken this class while the connection was set up. Nothing was sent
  // on this one yet, so Tala 0.4.3 has tied nothing to it: it can carry the next class this
  // teacher may take instead. Released without one, the teacher would get nothing this burst.
  if (!group || burst.synced.has(group.key)) {
    group = candidates(burst, endpointId)[0];
    if (!group) {
      await release(endpointId);
      return;
    }
    session.group = group.key;
  }
  if (!session.challenge) return;
  session.phase = 'wait-ready';
  session.leaves = leavesFor(burst, endpointId, group);
  const body = inner(group, session.challenge, [], session.leaves);
  await sendEnvelope(endpointId, 'intro', session.challenge, group.public_key, body);
}

/** Tala >= 0.4.4 names the class, and says whether it honoured the intro's leave tombstones. */
async function noteReply(group: Group, session: Session, reply: AckBody) {
  const name = cleanClassName(reply.class_name);
  if (name) {
    await queue!.setClassName(group, name);
    if (group.active) setUi({ className: name });
  }
  if (session.leaves?.length && Array.isArray(reply.caps) && reply.caps.includes(LEAVE_CAP)) {
    await queue!.clearLeaves(group.class_id, session.leaves);
    session.leaves = [];
  }
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
  if (!session || !native || !queue) return;

  if (msg.type === 'challenge' && typeof msg.challenge === 'string') {
    session.challenge = msg.challenge;
    showStatus('connected');
    if (session.group === undefined) {
      if (!pendingManual) return;
      session.phase = 'wait-manual-key';
      await sendManualEnroll(endpointId, session, msg.challenge);
      return;
    }
    await sendIntro(endpointId, session);
    return;
  }

  if (
    msg.type === 'manual_key' &&
    session.challenge &&
    session.group === undefined &&
    pendingManual
  ) {
    if (typeof msg.nonce !== 'string' || typeof msg.ciphertext !== 'string') return;
    try {
      await acceptManualKey(endpointId, session, msg.nonce, msg.ciphertext);
    } catch (error) {
      // An unreadable answer is a failed code attempt too: the code moves on, as on a refusal.
      if (manualEndpoint !== endpointId) throw error;
      await release(endpointId);
      manualFailed(endpointId);
    }
    return;
  }

  if ((msg.type === 'ready' || msg.type === 'ack') && session.sessionKey && session.challenge) {
    if (typeof msg.nonce !== 'string' || typeof msg.ciphertext !== 'string') return;
    const group = findGroup(burst, session.group);
    if (!group) return;
    const plain = await native.decryptResponse(
      session.sessionKey,
      session.challenge,
      msg.nonce,
      msg.ciphertext
    );
    if (sessions.get(endpointId) !== session) return;
    const reply = JSON.parse(plain) as AckBody;
    if (msg.type === 'ready') {
      if (reply.challenge !== session.challenge) throw new Error('ready-challenge');
      accepted(burst, endpointId);
      session.phase = 'wait-ack';
      await noteReply(group, session, reply);
      // A leave-only class was told everything it needed by the intro.
      if (!group.scopes.length) await finishGroup(endpointId, group);
      else await sendNextBatch(endpointId);
      return;
    }
    const outstanding = session.outstanding ?? [];
    const result = applyAck(outstanding, reply, session.challenge);
    if (!result.ok) throw new Error(result.reason);
    await queue.ack(result.done, result.lost, group);
    await noteReply(group, session, reply);
    await sendNextBatch(endpointId);
  }
}

async function sendNextBatch(endpointId: string) {
  const session = sessions.get(endpointId);
  const group = findGroup(burst, session?.group);
  if (!session?.challenge || !group || !queue) return;
  const pending = await queue.pending(group, group.scopes, MAX_EVENTS);
  if (!enabled || sessions.get(endpointId) !== session) return;
  if (!pending.length && session.didEmptyBatch) {
    await queue.markSynced(group.scopes);
    await finishGroup(endpointId, group);
    return;
  }
  showStatus('sending');
  const body = inner(group, session.challenge, pending, []);
  session.outstanding = body.events.map((e) => e.id);
  if (!body.events.length) session.didEmptyBatch = true;
  await sendEnvelope(endpointId, 'batch', session.challenge, group.public_key, body);
}

/** One class is done for this burst; the burst itself ends once every class is. */
async function finishGroup(endpointId: string, group: Group) {
  sessions.delete(endpointId);
  connecting.delete(endpointId);
  groupSynced(burst, group.key);
  if (group.active) {
    setUi({ state: 'synced', lastSync: Date.now(), detail: '' });
    activeSynced = true;
  }
  if (!(await finishIfDone())) await release(endpointId);
}

/**
 * A completed exchange with every class is the natural end of this short radio burst. The
 * scheduler starts another foreground look later, rather than leaving Nearby in a stale state.
 */
async function finishIfDone(): Promise<boolean> {
  const inFlight = [...sessions.values()].map((s) => s.group);
  if (!running || pendingManual || !burstDone(burst, inFlight)) return false;
  await finishSearchBurst();
  return true;
}

/** Free a teacher this burst is done with; a discovering phone holds one connection at a time. */
async function release(endpointId: string) {
  sessions.delete(endpointId);
  connecting.delete(endpointId);
  try {
    await talaNative()?.disconnect?.(endpointId);
  } catch {
    /* already gone */
  }
}

function jitter(ms: number) {
  return ms * (0.5 + Math.random());
}

/** Nearby found (or found again) a teacher. */
async function onFound(endpointId: string, name?: string) {
  if (!running) return;
  seen(burst, endpointId, name);
  await offer(endpointId);
}

/** Connect to a teacher this burst still owes something: the typed code, or a class. */
async function offer(endpointId: string) {
  if (!running || connecting.has(endpointId) || sessions.has(endpointId)) return;
  // Unknown to this burst (a retry timer from an earlier one), or lost until found again.
  if (burst.endpoints.get(endpointId)?.lost ?? true) return;
  if (pendingManual && (manualEndpoint === endpointId || !burst.manualTried.has(endpointId))) {
    // A typed code goes to one teacher at a time; the rest wait their turn (nextManualEndpoint).
    if (!manualEndpoint || manualEndpoint === endpointId) await connect(endpointId, undefined);
    return;
  }
  // A hinted teacher of another class is ignored outright, and one that already has a class
  // from this phone this burst gets nothing more. One that refused the typed code can still
  // take a sibling's class.
  const group = candidates(burst, endpointId)[0];
  if (group) await connect(endpointId, group.key);
}

/** Offer teachers found earlier in this burst again, e.g. once a typed code is settled. */
function offerSeenEndpoints() {
  for (const endpointId of burst.endpoints.keys()) void offer(endpointId);
}

async function connect(endpointId: string, group: string | undefined) {
  const attempt = ++attempts;
  connecting.set(endpointId, attempt);
  if (group === undefined) {
    manualEndpoint = endpointId;
    burst.manualTried.add(endpointId);
  }
  await new Promise((r) => setTimeout(r, jitter(2500)));
  // The burst ended (radios off, attempts cleared), or this attempt was dropped meanwhile.
  if (!running || connecting.get(endpointId) !== attempt) return;
  const native = talaNative();
  try {
    await native?.requestConnection(endpointId);
    // Stopping the burst meanwhile took the connection down with the radios.
    if (!running) return;
    // Dropped while the request was in flight (the teacher was lost): let the connection go
    // rather than hold the radio for a teacher nothing will be sent to.
    if (connecting.get(endpointId) !== attempt) {
      await release(endpointId);
      return;
    }
    sessions.set(endpointId, { group, phase: 'wait-challenge' });
  } catch {
    if (!running || connecting.get(endpointId) !== attempt) return;
    const busy = [...sessions.keys()].some((id) => id !== endpointId);
    if (
      group === undefined &&
      manualEndpoint === endpointId &&
      manualUnreachable(burst, endpointId, busy)
    ) {
      connecting.delete(endpointId);
      manualFailed(endpointId);
      return;
    }
    retryConnection(endpointId);
  }
}

/** Connection setup failed (radio contention, or the phone is still on another teacher). */
function retryConnection(endpointId: string) {
  connecting.delete(endpointId);
  showStatus('searching', 'retry');
  setTimeout(() => {
    if (running) void offer(endpointId);
  }, jitter(4000));
}

/** Nearby lost a teacher: nothing is offered to it until it is found again. */
function onLost(endpointId: string) {
  endpointLost(burst, endpointId);
  // A live session carries on; an attempt still being set up is dropped.
  if (sessions.has(endpointId)) return;
  connecting.delete(endpointId);
  // It cannot answer the typed code: the code moves on to the next teacher. It was never
  // actually asked (no session yet), so if Nearby finds it again it gets its turn.
  if (manualEndpoint === endpointId) {
    burst.manualTried.delete(endpointId);
    manualFailed(endpointId);
  }
}

function onDisconnected(endpointId: string) {
  const session = sessions.get(endpointId);
  sessions.delete(endpointId);
  connecting.delete(endpointId);
  if (!running) return;
  if (manualEndpoint === endpointId) {
    manualFailed(endpointId);
    return;
  }
  if (session?.group !== undefined && session.phase !== 'wait-ack') {
    // Tala drops a phone whose intro it cannot unwrap: that teacher collects for another
    // class. Offer it the next class on a fresh connection; never on this one.
    const next = rejected(burst, endpointId, session.group);
    if (next) void connect(endpointId, next.key);
  }
  if (ui.state !== 'synced') showStatus('searching');
  void finishIfDone();
}

/** The teacher at this endpoint did not take the typed code, or cannot be reached: try the next. */
function manualFailed(endpointId: string) {
  if (!pendingManual || manualEndpoint !== endpointId) return;
  manualEndpoint = undefined;
  const next = nextManualEndpoint(burst);
  if (next) {
    void connect(next, undefined);
    return;
  }
  // Every teacher found so far refused it, but Nearby reports teachers one at a time: the right
  // one may still turn up (offer). The code stays pending until the burst ends, which says it
  // expired (finishSearchBurst). Meanwhile teachers already asked can serve the other classes.
  showStatus('searching');
  if (burst.groups.some((g) => g.scopes.length)) offerSeenEndpoints();
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
async function finishSearchBurst(): Promise<void> {
  if (!running) return;
  if (burstTimer) clearTimeout(burstTimer);
  burstTimer = undefined;
  running = false;
  connecting.clear();
  sessions.clear();
  manualEndpoint = undefined;
  try {
    await talaNative()?.stop();
  } catch {
    /* radios may already be down */
  }
  missesWithoutTeacher = nextMisses(missesWithoutTeacher, burst);
  // A code no teacher took before the burst ended has expired; the student types it again.
  if (pendingManual && burst.manualTried.size) setUi({ state: 'error', detail: 'code' });
  pendingManual = undefined;
  if (!activeSynced && ui.state !== 'error')
    setUi({ state: ui.bound ? 'idle' : 'unbound', detail: '' });
  scheduleRetry();
}

export async function startTalaSession(): Promise<void> {
  // A discovery burst is already live. Native Nearby also treats startDiscovery as idempotent,
  // but avoiding a second permission request makes app-focus changes harmless.
  if (running) return;
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = undefined;
  }
  activeSynced = false;
  const native = talaNative();
  if (!native) {
    showStatus('error', 'play-services');
    return;
  }
  if (!native.playServicesOk()) {
    showStatus('error', 'play-services');
    return;
  }
  await refreshBindings();
  if (!pendingManual && (!boundScopes.size || !enabled)) {
    setUi({ state: ui.bound ? 'idle' : 'unbound', detail: '' });
    return;
  }
  const granted = await nearbyPermissions();
  if (!granted) {
    showStatus('error', 'permission');
    return;
  }
  const connectivity = native.connectivityStatus();
  if (!connectivity.bluetoothSupported) {
    showStatus('error', 'bluetooth-unavailable');
    return;
  }
  if (!connectivity.bluetoothOn) {
    showStatus('error', connectivity.wifiOn ? 'bluetooth-off' : 'radios-off');
    // Keep the existing foreground retry cadence alive: a family may turn the radio
    // back on after this explanation without reopening the app or pressing Sync again.
    if (!pendingManual) {
      missesWithoutTeacher += 1;
      scheduleRetry();
    }
    return;
  }
  if (!connectivity.wifiSupported) {
    showStatus('error', 'wifi-unavailable');
    return;
  }
  if (!connectivity.wifiOn) {
    showStatus('error', 'wifi-off');
    if (!pendingManual) {
      missesWithoutTeacher += 1;
      scheduleRetry();
    }
    return;
  }
  const groups = await loadGroups();
  // Bound students whose profile cannot be named do not sync (see buildGroups).
  if (!pendingManual && !groups.some((g) => g.scopes.length)) return;
  // Two triggers (focus, retry timer) can both get here across the awaits above.
  if (running) return;
  running = true;
  burst = newBurst(groups);
  showStatus('searching');
  try {
    await native.startDiscovery();
    burstTimer = setTimeout(() => {
      burstTimer = undefined;
      void finishSearchBurst();
    }, BURST_MS);
  } catch {
    running = false;
    showStatus('error', 'nearby');
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
  manualEndpoint = undefined;
  try {
    await talaNative()?.stop();
  } catch {
    /* radios may already be down */
  }
  if (ui.state !== 'synced') setUi({ state: ui.bound ? 'idle' : 'unbound' });
}

export async function syncNow(): Promise<void> {
  // A student explicitly asking to sync is a fresh attempt, not a fourth missed look.
  missesWithoutTeacher = 0;
  await stopTalaSession();
  await startTalaSession();
}

/** Open Android's own control for the radio that is currently preventing Nearby sync. */
export function fixTalaConnectivity(detail = ui.detail): void {
  const native = talaNative();
  if (!native) return;
  if (detail === 'bluetooth-off' || detail === 'radios-off') {
    native.requestBluetoothEnable();
  } else if (detail === 'wifi-off') {
    native.openWifiSettings();
  }
}

/** Joins the student on screen only; other students on this phone keep their own classes. */
export async function enrollQr(text: string, confirmRebind: () => Promise<boolean>): Promise<void> {
  const qr = parseTeacherQr(text);
  const scope = profileScope();
  const prev = await queue!.binding(scope);
  if (prev && !sameBinding(qr, prev)) {
    if (!(await confirmRebind())) return;
  }
  pendingManual = undefined;
  await stopTalaSession();
  await queue!.bind(scope, {
    class_id: qr.class_id,
    public_key: qr.public_key,
    bound_at: Date.now(),
    class_name: qr.class_name,
  });
  await refreshBindings();
  setUi({ state: 'idle', detail: '' });
  await startTalaSession();
}

export async function enrollCode(
  typed: string,
  confirmRebind: () => Promise<boolean>
): Promise<void> {
  const code = normalizeCode(typed);
  if (!code) throw new QrError('code');
  await stopTalaSession();
  pendingManual = { code, scope: profileScope(), confirmRebind };
  setUi({ state: 'searching', detail: '' });
  await startTalaSession();
}

/** The student on screen leaves; their teacher is told when a Tala that understands it is met. */
export async function leaveClass(): Promise<void> {
  pendingManual = undefined;
  await stopTalaSession();
  await queue!.unbind(profileScope());
  await refreshBindings();
  setUi({ state: 'unbound', detail: '' });
  // Stopping cancelled the siblings' cadence; their next look also carries this leave.
  if (enabled && AppState.currentState === 'active' && boundScopes.size) void startTalaSession();
}

export function teacherTrack(events: Event[]): void {
  if (!enabled || !queue) return;
  // The store routes by scope too; this only spares unenrolled students a transaction per event.
  const rows = events.filter((e) => boundScopes.has(eventScope(e.props)));
  if (!rows.length) return;
  const target = queue;
  writes = writes
    .then(() =>
      target.enqueue(
        rows.map((e) => ({
          id: e.id,
          name: e.name,
          occurred_at: e.occurred_at,
          session_id: e.session_id,
          props: e.props,
        }))
      )
    )
    .catch(() => {});
}

/** Resolves once every teacher-queue write started so far has landed, e.g. before a reload. */
export function drainTeacherWrites(): Promise<void> {
  return writes;
}

export async function initTala(opts: {
  store: ConstructorParameters<typeof TeacherQueue>[0];
  installationId: string;
  enabled: boolean;
}): Promise<() => void> {
  queue = new TeacherQueue(opts.store, Date.now);
  installationId = opts.installationId;
  enabled = opts.enabled;
  // A 0.4.23 class listed every profile on this phone: now that they are loaded, it is told
  // who left. Idempotent and retried next launch on failure; it must never block sync.
  const loaded = profileSnapshot();
  if (loaded.ready) await queue.settleLegacyClass(loaded.profiles.map((p) => p.id)).catch(() => {});
  await refreshBindings();
  setUi({ state: ui.bound ? 'idle' : 'unbound', detail: '' });
  unsubNative?.();
  unsubNative = subscribeTala((e) => {
    void (async () => {
      try {
        if (e.kind === 'found') await onFound(e.endpointId, e.name);
        else if (e.kind === 'lost') onLost(e.endpointId);
        else if (e.kind === 'connection' && e.status === 'disconnected')
          onDisconnected(e.endpointId);
        else if (e.kind === 'connection' && e.status === 'failed') {
          sessions.delete(e.endpointId);
          if (manualEndpoint === e.endpointId) {
            connecting.delete(e.endpointId);
            manualFailed(e.endpointId);
          } else if (running) retryConnection(e.endpointId);
          else connecting.delete(e.endpointId);
        } else if (e.kind === 'bytes') await onBytes(e.endpointId, e.json);
        else if (e.kind === 'error') showStatus('error', e.message);
      } catch {
        showStatus('error', 'sync');
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
  if (AppState.currentState === 'active' && boundScopes.size && enabled) void startTalaSession();
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
    setUi({ state: ui.bound ? 'idle' : 'unbound' });
  } else if (AppState.currentState === 'active') {
    void startTalaSession();
  }
}

export { QrError, parseTeacherQr };
