/**
 * Typed access to the `TalaActivity` native module (android/src/main/java/expo/modules/talaactivity).
 * Null when the module is not linked (Expo Go, web, a build without it): callers show collection
 * as unavailable instead of crashing (PRD ACT-7).
 */
import { requireOptionalNativeModule } from 'expo';

/** What an Expo event listener returns; declared here so this module needs only `expo`. */
export type EventSubscription = { remove(): void };

export type Availability = {
  sdkInt: number;
  /** Android 10+ (API 29), as Tala 0.4.x required. */
  supported: boolean;
  playServices: boolean;
  permissionsGranted: boolean;
  bluetoothSupported: boolean;
  bluetoothOn: boolean;
  wifiSupported: boolean;
  wifiOn: boolean;
};

export type ConnectionStatus = 'initiated' | 'connected' | 'failed' | 'disconnected';

export type TalaActivityNative = {
  availability(): Availability;
  requiredPermissions(): string[];
  requestPermissions(): Promise<boolean>;
  requestBluetoothEnable(): boolean;
  openWifiSettings(): boolean;

  ensureClassKey(classId: string): Promise<string>;
  classPublicKey(classId: string): string | null;
  hasClassKey(classId: string): boolean;
  deleteClassKey(classId: string): void;

  classHint(classId: string): string;
  endpointName(classId: string): string;
  challenge(): string;
  randomBytes(count: number): string;
  sha256(inputB64: string): string;
  hmacSha256(keyB64: string, messageB64: string): string;
  unwrapSessionKey(classId: string, wrappedB64: string): Promise<string>;
  decryptEnvelope(
    sessionKeyB64: string,
    challenge: string,
    nonceB64: string,
    ciphertextB64: string
  ): Promise<string>;
  encryptReply(
    sessionKeyB64: string,
    challenge: string,
    type: 'ready' | 'ack',
    plaintext: string
  ): Promise<string>;
  newManualCode(): string;
  manualRespond(
    code: string,
    challenge: string,
    clientNonceB64: string,
    proofB64: string,
    qrPayload: string
  ): Promise<string>;

  startAdvertising(endpointName: string): Promise<void>;
  isAdvertising(): boolean;
  sendPayload(endpointId: string, json: string): Promise<void>;
  disconnect(endpointId: string): void;
  stopAdvertising(): void;

  catalogLoad(): Promise<{ labels: number; entries: number }>;
  catalogSubcategories(eventsJson: string): Promise<string>;
  catalogLoaded(): boolean;

  addListener(event: string, listener: (body: Record<string, string>) => void): EventSubscription;
};

let cached: TalaActivityNative | null | undefined;

export function talaActivityNative(): TalaActivityNative | null {
  if (cached !== undefined) return cached;
  cached = requireOptionalNativeModule<TalaActivityNative>('TalaActivity');
  return cached;
}

export type TalaActivityEvent =
  | { kind: 'connection'; endpointId: string; status: ConnectionStatus }
  | { kind: 'bytes'; endpointId: string; json: string }
  | { kind: 'error'; endpointId?: string; message: string };

export function subscribeTalaActivity(fn: (event: TalaActivityEvent) => void): () => void {
  const native = talaActivityNative();
  if (!native) return () => {};
  const subs = [
    native.addListener('onConnection', (e) =>
      fn({
        kind: 'connection',
        endpointId: e.endpointId ?? '',
        status: (e.status ?? 'failed') as ConnectionStatus,
      })
    ),
    native.addListener('onBytes', (e) =>
      fn({ kind: 'bytes', endpointId: e.endpointId ?? '', json: e.json ?? '' })
    ),
    native.addListener('onError', (e) =>
      fn({ kind: 'error', endpointId: e.endpointId, message: e.message ?? '' })
    ),
  ];
  return () => {
    for (const s of subs) s.remove();
  };
}
