import { createPublicKey, type KeyObject } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { Relay } from './relay';

/**
 * GET /api/updates/manifest — the Expo Updates (protocol v1) endpoint baked into every
 * Hiraia 0.4.24+ APK (packages/mobile/app.json `updates.url`). The URL is permanent: it is
 * also the scope key of every update a phone downloads, so it must never move.
 *
 * A RELAY of manifests signed at publish time; see ./relay.ts for rings, caching and the R2
 * layout, and deploy/publish-ota.py for the only thing that writes them. The private key is
 * never on this server. The APK channel (/api/app/manifest) is separate and unaffected.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ORIGIN = (process.env.HIRAIA_OTA_ORIGIN || 'https://assets.hiraia.org').replace(/\/+$/, '');

/**
 * The certificate the phones verify against, used to refuse a body they would reject before
 * it is ever served. Same default as server/images.ts for the mobile package's files; when it
 * is missing the route still relays (phones check anyway), and says so once.
 */
function certificate(): KeyObject | null {
  const file =
    process.env.HIRAIA_OTA_CERTIFICATE ||
    path.join(process.env.HIRAIA_MOBILE_DIR || path.join(process.cwd(), '..', 'mobile'), 'certs', 'certificate.pem');
  try {
    if (existsSync(file)) return createPublicKey(readFileSync(file, 'utf8'));
  } catch (error) {
    console.error(`[ota] certificate at ${file} unreadable: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
  console.warn(`[ota] no certificate at ${file} — relaying without the pre-serve signature check`);
  return null;
}

const relay = new Relay({ origin: ORIGIN, publicKey: certificate() });

export async function GET(request: Request) {
  return relay.handle(request.headers);
}
