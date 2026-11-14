/**
 * Wires the pieces together on the phone: the native module, the encrypted activity database, the
 * store, the collector and the catalog. Screens talk to this; tests talk to the pieces directly.
 */
import * as SQLite from 'expo-sqlite';
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import {
  subscribeTalaActivity,
  talaActivityNative,
  type Availability,
  type TalaActivityNative,
} from '../../../modules/tala-activity/src';
import { emptyCatalog, nativeCatalog, type Catalog } from './catalog';
import type { ActivityCrypto } from './crypto';
import { classIdentity, deleteClassIdentity, type ClassIdentity } from './identity';
import { nativeCrypto } from './nativeCrypto';
import { encodeQr, qrPngDataUri } from './qr';
import { createCollector, type Collector, type CollectorListener, type Radio } from './session';
import { createActivityStore, type ActivityStore, type Database } from './store';

/**
 * Its own SQLCipher file, `tala-activity.db`, with its own random key in SecureStore: activity data
 * is never synced, is deleted with the class, and must not travel with an account export, so it does
 * not share the LocalStore's file. Same fail-closed pattern as src/storage/native.ts (no plaintext
 * fallback; Expo Go cannot open it).
 */
export async function openActivityDatabase(): Promise<Database> {
  let key = await SecureStore.getItemAsync('tala.activity-database-key');
  if (!key) {
    key = Array.from(await Crypto.getRandomBytesAsync(32), (b) =>
      b.toString(16).padStart(2, '0')
    ).join('');
    await SecureStore.setItemAsync('tala.activity-database-key', key);
  }
  if (!/^[a-f0-9]{64}$/.test(key)) throw new Error('Activity database key unavailable');
  const db = await SQLite.openDatabaseAsync('tala-activity.db');
  await db.execAsync(`PRAGMA key = "x'${key}'";`);
  const cipher = await db.getFirstAsync<Record<string, string>>('PRAGMA cipher_version');
  if (!cipher || !Object.values(cipher)[0]) {
    await db.closeAsync();
    throw new Error('Encrypted storage requires a Tala development or release build');
  }
  await db.execAsync('PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;');
  return db as unknown as Database;
}

export type Preflight =
  | { ok: true }
  | {
      ok: false;
      reason:
        | 'noModule'
        | 'android'
        | 'playServices'
        | 'permission'
        | 'noBluetooth'
        | 'bluetooth'
        | 'noWifi'
        | 'wifi';
    };

/** MainActivity.startCollection's checks, in the same order, as data for the screen to explain. */
export function preflight(availability: Availability | null): Preflight {
  if (!availability) return { ok: false, reason: 'noModule' };
  if (!availability.supported) return { ok: false, reason: 'android' };
  if (!availability.playServices) return { ok: false, reason: 'playServices' };
  if (!availability.permissionsGranted) return { ok: false, reason: 'permission' };
  if (!availability.bluetoothSupported) return { ok: false, reason: 'noBluetooth' };
  if (!availability.bluetoothOn) return { ok: false, reason: 'bluetooth' };
  if (!availability.wifiSupported) return { ok: false, reason: 'noWifi' };
  if (!availability.wifiOn) return { ok: false, reason: 'wifi' };
  return { ok: true };
}

export type ClassInput = {
  classId: string;
  name: string;
  teacherName?: string;
  schoolName?: string;
  gradeLevel?: string;
  schoolYear?: string;
};

export type ActiveCollection = {
  identity: ClassIdentity;
  collector: Collector;
  /** The QR as text and as a PNG data URI. */
  qr(): Promise<{ payload: string; pngUri: string }>;
  /** Stops collecting and detaches from the radio. */
  dispose(): void;
};

export type ActivityRuntime = {
  native: TalaActivityNative | null;
  store: ActivityStore;
  crypto: ActivityCrypto | null;
  catalog: Catalog;
  availability(): Availability | null;
  identity(input: ClassInput): Promise<ClassIdentity>;
  /**
   * One class collects at a time (switching classes stops the old one and rotates its code, as
   * 0.4.x did). The collector is created paused; the screen starts it after preflight.
   */
  collect(input: ClassInput, listener: CollectorListener): Promise<ActiveCollection>;
  deleteClass(classId: string): Promise<void>;
};

export async function createActivityRuntime(deps: {
  db: Database;
  native?: TalaActivityNative | null;
}): Promise<ActivityRuntime> {
  const native = deps.native === undefined ? talaActivityNative() : deps.native;
  const store = await createActivityStore(deps.db);
  const crypto = native ? nativeCrypto(native) : null;
  const catalog = native ? nativeCatalog(native) : emptyCatalog;
  let active: ActiveCollection | null = null;

  const radio: Radio = {
    async startAdvertising(name) {
      if (!native) throw new Error('nearby-unavailable');
      await native.startAdvertising(name);
    },
    stopAdvertising() {
      native?.stopAdvertising();
    },
    async send(endpointId, json) {
      if (!native) throw new Error('nearby-unavailable');
      await native.sendPayload(endpointId, json);
    },
    disconnect(endpointId) {
      native?.disconnect(endpointId);
    },
  };

  return {
    native,
    store,
    crypto,
    catalog,
    availability: () => (native ? native.availability() : null),
    async identity(input) {
      if (!crypto) throw new Error('nearby-unavailable');
      return classIdentity(store, crypto, input);
    },
    async collect(input, listener) {
      if (!crypto) throw new Error('nearby-unavailable');
      active?.dispose();
      const identity = await classIdentity(store, crypto, input);
      const collector = createCollector({
        crypto,
        radio,
        enrollmentId: identity.enrollmentId,
        endpointName: identity.endpointName,
        className: identity.displayName,
        qrPayload: identity.qrPayload,
        ingest: (e, b, r) => store.ingest(e, b, r),
        listener,
      });
      const unsubscribe = subscribeTalaActivity((event) => {
        if (event.kind === 'connection')
          void collector.onConnection(event.endpointId, event.status);
        else if (event.kind === 'bytes') void collector.onBytes(event.endpointId, event.json);
      });
      const collection: ActiveCollection = {
        identity,
        collector,
        async qr() {
          const payload = await identity.qrPayload();
          return { payload, pngUri: qrPngDataUri(encodeQr(payload, 'M')) };
        },
        dispose() {
          collector.stop();
          unsubscribe();
          if (active === collection) active = null;
        },
      };
      active = collection;
      return collection;
    },
    async deleteClass(classId) {
      if (active?.identity.cls.classId === classId) active.dispose();
      if (crypto) await deleteClassIdentity(store, crypto, classId);
      else await store.deleteClass(classId);
    },
  };
}
