/**
 * The teacher side of one collection session — Tala 0.4.4 NearbyCollector.kt (branch tala-0.4.x)
 * with the radio and the crypto behind interfaces, so the whole exchange runs in a Node test.
 * Message handling is serialized (0.4.x used a single-thread executor) and every step re-checks
 * that the connection still holds the challenge it started with.
 */
import type { ActivityCrypto } from './crypto';
import {
  MAX_MANUAL_ATTEMPTS,
  MAX_MANUAL_PAYLOAD,
  MANUAL_CODE_TTL_MS,
  challengeMessage,
  checkInner,
  isManualEnroll,
  isOuterEnvelope,
  parseOuter,
  replyBody,
  type InnerBatch,
} from './protocol';
import type { IngestResult } from './store';

export type Radio = {
  startAdvertising(endpointName: string): Promise<void>;
  stopAdvertising(): void;
  send(endpointId: string, json: string): Promise<void>;
  disconnect(endpointId: string): void;
};

export type CollectorStatus =
  | 'idle'
  | 'starting'
  | 'ready'
  | 'connecting'
  | 'collecting'
  | 'connectionFailed'
  | 'advertisingFailed'
  | 'paused';

export type CollectorListener = {
  onStatus(status: CollectorStatus, connections: number, detail?: string): void;
  onConnected(installationId: string): void;
  onTransfer(installationId: string): void;
  onSaved(installationId: string, accepted: number, rejected: number): void;
  onFailure(installationId: string | null, duringTransfer: boolean): void;
  onDisconnected(installationId: string): void;
};

export type EnrollmentTicket = { enrollmentId: string; code: string; expiresAt: number };

export type CollectorDeps = {
  crypto: ActivityCrypto;
  radio: Radio;
  /** The QR's class_id. */
  enrollmentId: string;
  endpointName: string;
  /** The display name to put in every reply (= the QR's); read per reply so renames apply at once. */
  className(): Promise<string>;
  /** The exact QR JSON currently shown, for the typed-code reply. */
  qrPayload(): Promise<string>;
  ingest(enrollmentId: string, batch: InnerBatch, recordSync: boolean): Promise<IngestResult>;
  listener: CollectorListener;
  now?: () => number;
};

export function createCollector(deps: CollectorDeps) {
  const now = deps.now ?? (() => Date.now());
  const challenges = new Map<string, string>();
  const endpointInstallations = new Map<string, string>();
  const manualAttempts = new Map<string, number>();
  let running = false;
  let generation = 0;
  let ticket: EnrollmentTicket | null = null;
  let queue: Promise<void> = Promise.resolve();

  const status = (s: CollectorStatus, detail?: string) =>
    deps.listener.onStatus(s, challenges.size, detail);
  const live = (endpointId: string, challenge: string) =>
    running && challenges.get(endpointId) === challenge;

  async function currentTicket(): Promise<EnrollmentTicket> {
    const at = now();
    if (ticket && ticket.enrollmentId === deps.enrollmentId && ticket.expiresAt > at) return ticket;
    ticket = {
      enrollmentId: deps.enrollmentId,
      code: await deps.crypto.newManualCode(),
      expiresAt: at + MANUAL_CODE_TTL_MS,
    };
    return ticket;
  }

  async function handle(endpointId: string, json: string, challenge: string): Promise<void> {
    if (!live(endpointId, challenge)) return;
    let installationId: string | null = endpointInstallations.get(endpointId) ?? null;
    let duringTransfer = false;
    try {
      const outer = parseOuter(json);
      if (!outer) throw new Error('outer');
      const kind = outer.type;
      duringTransfer = kind === 'batch';
      if (kind === 'manual_enroll') {
        if (new TextEncoder().encode(json).length > MAX_MANUAL_PAYLOAD)
          throw new Error('manual-size');
        const attempts = (manualAttempts.get(endpointId) ?? 0) + 1;
        manualAttempts.set(endpointId, attempts);
        if (attempts > MAX_MANUAL_ATTEMPTS) throw new Error('manual-attempts');
        if (!isManualEnroll(outer)) throw new Error('manual-shape');
        const active = ticket;
        if (!active || active.enrollmentId !== deps.enrollmentId || active.expiresAt <= now())
          throw new Error('manual-no-code');
        // Same payload the QR carries, name included: a student who types the code must end up
        // with the same class name as one who scans.
        const response = await deps.crypto.manualRespond(
          active.code,
          challenge,
          outer.client_nonce,
          outer.proof,
          await deps.qrPayload()
        );
        if (live(endpointId, challenge)) await deps.radio.send(endpointId, response);
        return;
      }
      if (!isOuterEnvelope(outer)) throw new Error('type');
      const sessionKey = await deps.crypto.unwrapSessionKey(deps.enrollmentId, outer.wrapped_key);
      const plain = await deps.crypto.decryptEnvelope(
        sessionKey,
        challenge,
        outer.nonce,
        outer.ciphertext
      );
      const checked = checkInner(plain, { classId: deps.enrollmentId, challenge });
      if (!checked.ok) throw new Error(checked.reason);
      const batch = checked.batch;
      const received = batch.installation_id;
      installationId = received;
      const earlier = endpointInstallations.get(endpointId);
      if (earlier !== undefined && earlier !== received) throw new Error('installation-changed');
      if (kind === 'intro') {
        if (batch.events.length !== 0) throw new Error('intro-events');
      } else if (live(endpointId, challenge)) deps.listener.onTransfer(received);
      const result = await deps.ingest(deps.enrollmentId, batch, kind === 'batch');
      endpointInstallations.set(endpointId, received);
      const reply = await deps.crypto.encryptReply(
        sessionKey,
        challenge,
        kind === 'intro' ? 'ready' : 'ack',
        replyBody(challenge, result.accepted, result.rejected, await deps.className())
      );
      if (!live(endpointId, challenge)) return;
      await deps.radio.send(endpointId, reply);
      if (!live(endpointId, challenge)) return;
      if (kind === 'intro') deps.listener.onConnected(received);
      else deps.listener.onSaved(received, result.accepted.length, result.rejected.length);
    } catch {
      if (live(endpointId, challenge)) deps.listener.onFailure(installationId, duringTransfer);
      deps.radio.disconnect(endpointId);
    }
  }

  const collector = {
    get running() {
      return running;
    },
    connections: () => challenges.size,

    async start(): Promise<void> {
      if (running) return;
      running = true;
      const started = ++generation;
      status('starting');
      try {
        await deps.radio.startAdvertising(deps.endpointName);
        if (running && generation === started) status('ready');
      } catch (error) {
        if (running && generation === started) {
          running = false;
          status('advertisingFailed', error instanceof Error ? error.message : String(error));
        }
      }
    },

    /** NearbyCollector.stop: no more advertising, every student dropped, state cleared. */
    stop(): void {
      running = false;
      generation++;
      deps.radio.stopAdvertising();
      challenges.clear();
      manualAttempts.clear();
      endpointInstallations.clear();
      status('paused');
    },

    /** The radio's connection lifecycle. */
    async onConnection(
      endpointId: string,
      state: 'initiated' | 'connected' | 'failed' | 'disconnected'
    ): Promise<void> {
      if (state === 'initiated') {
        if (running) status('connecting');
        return;
      }
      if (state === 'disconnected') {
        challenges.delete(endpointId);
        manualAttempts.delete(endpointId);
        const installationId = endpointInstallations.get(endpointId);
        endpointInstallations.delete(endpointId);
        if (installationId !== undefined) deps.listener.onDisconnected(installationId);
        if (running) status('collecting');
        return;
      }
      if (!running) return;
      if (state === 'failed') {
        status('connectionFailed');
        return;
      }
      const challenge = await deps.crypto.challenge();
      if (!running) return;
      challenges.set(endpointId, challenge);
      try {
        await deps.radio.send(endpointId, challengeMessage(challenge));
      } catch {
        deps.radio.disconnect(endpointId);
        return;
      }
      status('collecting');
    },

    /** A BYTES payload from a student. Processed in order, one at a time. */
    onBytes(endpointId: string, json: string): Promise<void> {
      const challenge = challenges.get(endpointId);
      if (challenge === undefined) return Promise.resolve();
      const run = queue.then(() => handle(endpointId, json, challenge));
      queue = run.catch(() => {});
      return run;
    },

    /** The one-hour backup code for this class (ManualEnrollment.current). */
    ticket: currentTicket,

    /** "Refresh QR Code": a new code; the QR itself stays the same. */
    clearTicket(): void {
      ticket = null;
    },

    /** Lets a test or the UI wait for in-flight messages. */
    async idle(): Promise<void> {
      await queue;
    },
  };
  return collector;
}

export type Collector = ReturnType<typeof createCollector>;
