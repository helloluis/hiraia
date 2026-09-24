import { requireNativeModule, type EventSubscription } from 'expo-modules-core';

type Native = {
  playServicesOk(): boolean;
  connectivityStatus(): {
    bluetoothSupported: boolean;
    bluetoothOn: boolean;
    wifiSupported: boolean;
    wifiOn: boolean;
  };
  requestBluetoothEnable(): boolean;
  openWifiSettings(): boolean;
  requestPermissions(): Promise<boolean>;
  encryptRequest(
    publicKey: string,
    challenge: string,
    plaintext: string
  ): Promise<{ wrapped_key: string; nonce: string; ciphertext: string; session_key: string }>;
  decryptResponse(
    sessionKey: string,
    challenge: string,
    nonce: string,
    ciphertext: string
  ): Promise<string>;
  randomBytes(n: number): Promise<string>;
  sha256(input: string): Promise<string>;
  hmacSha256(key: string, message: string): Promise<string>;
  decryptAesGcm(key: string, nonce: string, aad: string, ciphertext: string): Promise<string>;
  startDiscovery(): Promise<boolean>;
  requestConnection(endpointId: string): Promise<boolean>;
  send(endpointId: string, json: string): Promise<boolean>;
  /** 0.4.24 and later. */
  disconnect?(endpointId: string): Promise<void>;
  stop(): Promise<void>;
};

type NativeEmitter = Native & {
  addListener(event: string, cb: (e: Record<string, string>) => void): EventSubscription;
};

let cached: NativeEmitter | null | undefined;

export function talaNative(): NativeEmitter | null {
  if (cached !== undefined) return cached;
  try {
    cached = requireNativeModule('HiraiaTala') as NativeEmitter;
  } catch {
    cached = null;
  }
  return cached;
}

export type TalaNativeEvent =
  /** `name` is the teacher's advertised endpoint name; builds before 0.4.24 do not forward it. */
  | { kind: 'found'; endpointId: string; name?: string }
  | { kind: 'lost'; endpointId: string }
  | { kind: 'connection'; endpointId: string; status: string }
  | { kind: 'bytes'; endpointId: string; json: string }
  | { kind: 'error'; message: string; endpointId?: string };

export function subscribeTala(fn: (e: TalaNativeEvent) => void): () => void {
  const native = talaNative();
  if (!native) return () => {};
  const subs: EventSubscription[] = [
    native.addListener('onFound', (e) =>
      fn({ kind: 'found', endpointId: e.endpointId ?? '', name: e.name })
    ),
    native.addListener('onLost', (e) => fn({ kind: 'lost', endpointId: e.endpointId ?? '' })),
    native.addListener('onConnection', (e) =>
      fn({ kind: 'connection', endpointId: e.endpointId ?? '', status: e.status ?? '' })
    ),
    native.addListener('onBytes', (e) =>
      fn({ kind: 'bytes', endpointId: e.endpointId ?? '', json: e.json ?? '' })
    ),
    native.addListener('onError', (e) =>
      fn({ kind: 'error', message: e.message ?? '', endpointId: e.endpointId })
    ),
  ];
  return () => {
    for (const s of subs) s.remove();
  };
}
