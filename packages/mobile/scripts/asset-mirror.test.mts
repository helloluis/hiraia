// The LAN download mirror (src/config/assetMirror.ts + the mirror-first path in
// src/engine/modelDownload.ts). The mirror is an untrusted delivery truck: these tests pin that
// only a device-owner-set, private-IPv4 mirror is ever contacted, only for the canonical asset
// prefix, and that anything it gets wrong is discarded before the canonical host takes over.
import assert from 'node:assert/strict';
import { after, before, mock, test } from 'node:test';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import {
  CANONICAL_ASSET_PREFIX,
  MIRROR_COOL_OFF_MS,
  MIRROR_MAX_COOL_OFF_MS,
  assetMirrorRoute,
  createMirrorBreaker,
  mirrorUrlFor,
  parseAssetMirror,
} from '../src/config/assetMirror';
import { remoteAssetUrl } from '../src/config/assetDelivery';

const require = createRequire(import.meta.url);
const mobile = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIRROR = 'http://192.168.68.62:8080/mirror/models';
/** The same laptop after the device owner moved it to another address. */
const MOVED = 'http://192.168.68.70:8080/mirror/models';

test('a mirror must be an http(s) URL on a literal private IPv4 address', () => {
  const accepted: [string, string][] = [
    [MIRROR, MIRROR],
    [`${MIRROR}/`, MIRROR],
    [`${MIRROR}///`, MIRROR],
    ['http://10.0.0.1', 'http://10.0.0.1'],
    ['http://10.255.255.255/', 'http://10.255.255.255'],
    ['https://172.16.0.5:8443/m', 'https://172.16.0.5:8443/m'],
    ['http://172.31.255.255:65535', 'http://172.31.255.255:65535'],
    ['http://192.168.0.0:1/a/b_c/d-e/f~g', 'http://192.168.0.0:1/a/b_c/d-e/f~g'],
  ];
  for (const [raw, want] of accepted) assert.equal(parseAssetMirror(raw), want, raw);

  const rejected = [
    // Public, loopback, link-local, carrier-grade NAT and the edges of each private range.
    'http://8.8.8.8/mirror',
    'http://11.0.0.1',
    'http://9.255.255.255',
    'http://172.15.255.255',
    'http://172.32.0.1',
    'http://192.167.1.1',
    'http://192.169.1.1',
    'http://127.0.0.1:8080',
    'http://169.254.10.10',
    'http://100.64.0.1',
    'http://0.0.0.0',
    'http://255.255.255.255',
    // Hostnames: they need DNS, which anyone on the Wi-Fi can answer.
    'http://mirror.local/models',
    'http://localhost:8080',
    'https://assets.hiraia.org/models',
    'http://192.168.1.2.nip.io/models',
    // IPv4 spellings a downstream parser might read differently, and IPv6.
    'http://010.0.0.1',
    'http://192.168.001.2',
    'http://192.168.1.256',
    'http://192.168.1',
    'http://0x0a.0.0.1',
    'http://3232235778',
    'http://[::1]/',
    'http://[fd00::1]:8080/',
    // Userinfo, query, fragment.
    'http://user:pw@192.168.1.2/models',
    'http://user@192.168.1.2/models',
    'http://192.168.1.2@8.8.8.8/models',
    'http://192.168.1.2/models?x=1',
    'http://192.168.1.2/models?',
    'http://192.168.1.2/models#frag',
    'http://192.168.1.2/#',
    // Non-http schemes and scheme tricks.
    'ftp://192.168.1.2/models',
    'file:///sdcard/models',
    'content://192.168.1.2/models',
    'ws://192.168.1.2/models',
    'javascript:alert(1)',
    '//192.168.1.2/models',
    'HTTP://192.168.1.2/models',
    '192.168.1.2/models',
    // Ports.
    'http://192.168.1.2:0',
    'http://192.168.1.2:65536',
    'http://192.168.1.2:08080',
    'http://192.168.1.2:',
    'http://192.168.1.2:80a',
    // Paths a URL parser could normalise or decode into something else.
    'http://192.168.1.2/mirror/../api',
    'http://192.168.1.2/./models',
    'http://192.168.1.2/%2e%2e/models',
    'http://192.168.1.2/mirror//models',
    'http://192.168.1.2/mir ror',
    'http://192.168.1.2\\models',
    // Whitespace and non-strings.
    ` ${MIRROR}`,
    `${MIRROR} `,
    `${MIRROR}\n`,
    '',
    `http://192.168.1.2/${'a'.repeat(200)}`,
  ];
  for (const raw of rejected) assert.equal(parseAssetMirror(raw), null, raw);
  for (const raw of [null, undefined, 42, {}, [MIRROR], true]) assert.equal(parseAssetMirror(raw), null);
});

test('only the exact canonical asset prefix maps onto the mirror', () => {
  assert.equal(CANONICAL_ASSET_PREFIX, 'https://assets.hiraia.org/models/');
  // The three post-install downloads, built exactly as src/config/model.ts builds them.
  for (const name of ['labse.Q4_K_M.gguf', 'vectors-labse-90318bad81dd.i8.bin', 'hiraia-sft-2b-v2.Q4_K_M.gguf']) {
    assert.equal(mirrorUrlFor(remoteAssetUrl(name), MIRROR), `${MIRROR}/${name}`);
  }
  // Every bundled image pack, with the URL src/images/installer.ts downloads it from.
  const manifest = JSON.parse(
    fs.readFileSync(path.join(mobile, 'src/generated/imagePacks.generated.json'), 'utf8')
  );
  assert.ok(manifest.packs.length > 0);
  for (const pack of manifest.packs) {
    const url = 'https://assets.hiraia.org/models/images/' + pack.filename;
    assert.equal(mirrorUrlFor(url, MIRROR), `${MIRROR}/images/${pack.filename}`);
  }
  const installer = fs.readFileSync(path.join(mobile, 'src/images/installer.ts'), 'utf8');
  assert.match(
    installer,
    /ensureRemoteAsset\(\{[^}]*url: 'https:\/\/assets\.hiraia\.org\/models\/images\/'\+pack\.filename/,
    'image packs must keep downloading through ensureRemoteAsset from the canonical prefix'
  );

  for (const url of [
    'https://hiraia.org/models/labse.Q4_K_M.gguf',
    'http://assets.hiraia.org/models/labse.Q4_K_M.gguf',
    'https://assets.hiraia.org.evil.example/models/labse.Q4_K_M.gguf',
    'https://evil.example/https://assets.hiraia.org/models/labse.Q4_K_M.gguf',
    'https://assets.hiraia.org/modelsx/labse.Q4_K_M.gguf',
    'https://assets.hiraia.org/models',
    'https://assets.hiraia.org/models/',
    'https://assets.hiraia.org/models/images/',
    'https://assets.hiraia.org:443/models/labse.Q4_K_M.gguf',
    'https://ASSETS.hiraia.org/models/labse.Q4_K_M.gguf',
    'https://assets.hiraia.org/models/../api/hiraia.apk',
    'https://assets.hiraia.org/models/images/../../x',
    'https://assets.hiraia.org/models/.hidden',
    'https://assets.hiraia.org/models/a//b',
    'https://assets.hiraia.org/models/labse.Q4_K_M.gguf?x=1',
    'https://assets.hiraia.org/models/labse.Q4_K_M.gguf#x',
    'https://assets.hiraia.org/models/%2e%2e/x',
    'https://hiraia.org/download/hiraia-0.4.25.apk',
  ]) {
    assert.equal(mirrorUrlFor(url, MIRROR), null, url);
  }
  assert.equal(mirrorUrlFor(remoteAssetUrl('labse.Q4_K_M.gguf'), null), null);
});

test('the setting is read through the injected native call and never throws', async () => {
  const url = remoteAssetUrl('labse.Q4_K_M.gguf');
  let reads = 0;
  const reader = (value: unknown) => () => {
    reads++;
    return value;
  };
  const route = { mirror: MIRROR, url: `${MIRROR}/labse.Q4_K_M.gguf` };
  assert.deepEqual(await assetMirrorRoute(url, reader(MIRROR)), route);
  assert.deepEqual(await assetMirrorRoute(url, reader(Promise.resolve(`${MIRROR}/`))), route);
  assert.equal(await assetMirrorRoute(url, reader(null)), null);
  assert.equal(await assetMirrorRoute(url, reader('http://8.8.8.8/mirror/models')), null);
  assert.equal(await assetMirrorRoute(url, reader(Promise.reject(new Error('binder died')))), null);
  assert.equal(
    await assetMirrorRoute(url, () => {
      throw new Error('no such module');
    }),
    null
  );
  const before = reads;
  assert.equal(await assetMirrorRoute('https://hiraia.org/download/x.apk', reader(MIRROR)), null);
  assert.equal(reads, before, 'URLs that can never map do not even read the setting');
});

test('the breaker skips a silent mirror for a cool-off that doubles while it stays silent, per mirror URL', () => {
  let clock = 1_000_000;
  const breaker = createMirrorBreaker(MIRROR_COOL_OFF_MS, MIRROR_MAX_COOL_OFF_MS, () => clock);
  assert.equal(MIRROR_COOL_OFF_MS, 60_000);
  assert.equal(MIRROR_MAX_COOL_OFF_MS, 10 * 60_000);
  assert.equal(breaker.skipping(MIRROR), false, 'a mirror that has not failed is tried');
  // Silent at every retry: 1, 2, 4, 8, then 10 minutes and never longer.
  for (const minutes of [1, 2, 4, 8, 10, 10]) {
    assert.equal(breaker.trip(MIRROR), minutes * 60_000);
    assert.equal(breaker.skipping(MIRROR), true);
    assert.equal(breaker.skipping(MOVED), false, 'a moved mirror is tried afresh');
    clock += minutes * 60_000 - 1;
    assert.equal(breaker.skipping(MIRROR), true, `still cooling off at the last millisecond of ${minutes} min`);
    clock += 1;
    assert.equal(breaker.skipping(MIRROR), false, `tried again after ${minutes} min`);
  }

  // An answer, whatever it says, means the mirror is there: the count starts over.
  breaker.answered(MIRROR);
  assert.equal(breaker.skipping(MIRROR), false);
  assert.equal(breaker.trip(MIRROR), MIRROR_COOL_OFF_MS);
  // Downloads that probed side by side report one silence: it neither doubles nor restarts the window.
  clock += 30_000;
  assert.equal(breaker.trip(MIRROR), MIRROR_COOL_OFF_MS);
  clock += 30_000;
  assert.equal(breaker.skipping(MIRROR), false, 'the window still ends a minute after the first report');

  breaker.answered(MIRROR);
  breaker.trip(MIRROR);
  clock -= 60_000; // The wall clock was corrected backwards.
  assert.equal(breaker.skipping(MIRROR), false, 'a clock running backwards ends the cool-off');

  // One mirror is configured at a time, so only the latest failure is remembered.
  breaker.trip(MIRROR);
  breaker.trip(MOVED);
  assert.equal(breaker.skipping(MIRROR), false);
  assert.equal(breaker.skipping(MOVED), true);
  breaker.answered(MIRROR); // Another mirror answering says nothing about this one.
  assert.equal(breaker.skipping(MOVED), true);
});

test('no code path in src/ builds a plain-HTTP URL except the validated mirror', () => {
  // The network security config (plugins/withAssetMirrorCleartext.js) cannot express IP ranges,
  // so it permits cleartext broadly; this keeps the app from ever using that for anything else.
  const hits: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      // Code only: the data and generated trees hold content, not network calls.
      if (entry.isDirectory()) {
        if (!['data', 'generated'].includes(entry.name)) walk(file);
      } else if (/\.(ts|tsx|js|mjs)$/.test(entry.name)) {
        const text = fs.readFileSync(file, 'utf8');
        for (const m of text.matchAll(/http:\/\/[^\s'"`)]*/g)) {
          if (!/^http:\/\/(www\.w3\.org|schemas\.android\.com)\//.test(m[0])) hits.push(`${file}: ${m[0]}`);
        }
      }
    }
  };
  walk(path.join(mobile, 'src'));
  walk(path.join(mobile, 'modules/hiraia-managed-config/src'));
  assert.deepEqual(hits, []);

  const plugin = require(path.join(mobile, 'plugins/withAssetMirrorCleartext.js'));
  assert.match(plugin.XML, /<base-config cleartextTrafficPermitted="true">/);
  assert.match(plugin.XML, /<certificates src="system" \/>/);
  assert.doesNotMatch(plugin.XML, /src="user"/, 'user-installed CAs stay untrusted');
  assert.match(
    plugin.XML,
    /<domain-config cleartextTrafficPermitted="false">\s*<domain includeSubdomains="true">hiraia\.org<\/domain>/
  );
  const app = JSON.parse(fs.readFileSync(path.join(mobile, 'app.json'), 'utf8'));
  assert.ok(app.expo.plugins.includes('./plugins/withAssetMirrorCleartext.js'));
});

// ---------------------------------------------------------------------------------------------
// Mirror-first downloads through the real ensureRemoteAsset, with expo-file-system's native
// downloader, fetch and the managed-configuration read replaced by fakes.
// ---------------------------------------------------------------------------------------------

type Server = {
  body?: Buffer;
  /** GET status; >= 400 appends an error page, like a real server's body. */
  status?: number;
  /** Connection refused / host unreachable for both HEAD and GET. */
  down?: boolean;
  /** Answer 200 with the WHOLE body to a Range request. */
  ignoreRange?: boolean;
  /** Stream half the body, then wait until the transfer is paused (i.e. aborted). */
  hold?: boolean;
  /** Stream half the body, then the connection breaks (the laptop shut, the phone left the Wi-Fi). */
  drops?: boolean;
  headStatus?: number;
  headLength?: number;
  /** HEAD never answers. */
  headHangs?: boolean;
};

const md5 = (b: Buffer) => crypto.createHash('md5').update(b).digest('hex');
const GOOD = Buffer.from(Array.from({ length: 24_576 }, (_, i) => (i * 31 + 7) & 0xff));
const EVIL = Buffer.from(GOOD).fill(0x41, 100, 200);
const DOCS = 'file:///documents/';

function world() {
  const files = new Map<string, Buffer>();
  const servers = new Map<string, Server>();
  const gets: { url: string; resumeData?: string; mirrorPartExisted: boolean }[] = [];
  const heads: string[] = [];
  const events: string[] = [];
  let setting: unknown = null;
  let reads = 0;
  const prefs = new Map<string, string>();
  return {
    files,
    servers,
    gets,
    heads,
    events,
    get reads() {
      return reads;
    },
    set setting(value: unknown) {
      setting = value;
    },
    storage: {
      getItem: async (k: string) => prefs.get(k) ?? null,
      setItem: async (k: string, v: string) => void prefs.set(k, v),
    },
    readSetting: async () => {
      reads++;
      return setting;
    },
    documentDirectory: DOCS,
    getInfoAsync: async (uri: string, options?: { md5?: boolean }) => {
      if (uri.endsWith('/')) return { exists: true, isDirectory: true };
      const b = files.get(uri);
      if (!b) return { exists: false };
      return { exists: true, isDirectory: false, size: b.length, md5: options?.md5 ? md5(b) : undefined };
    },
    makeDirectoryAsync: async () => {},
    deleteAsync: async (uri: string) => void files.delete(uri),
    moveAsync: async ({ from, to }: { from: string; to: string }) => {
      const b = files.get(from);
      if (!b) throw new Error(`no file at ${from}`);
      files.set(to, b);
      files.delete(from);
    },
    beginDownload: (asset: string) => ({
      installed: () => events.push(`installed ${asset}`),
      failed: () => events.push(`failed ${asset}`),
    }),
    fetch: async (url: string, init: { method: string; signal: AbortSignal }) => {
      assert.equal(init.method, 'HEAD');
      heads.push(url);
      const s = servers.get(url);
      if (!s || s.down) throw new TypeError('Network request failed');
      if (s.headHangs) {
        return new Promise((_, reject) =>
          init.signal.addEventListener('abort', () => reject(new Error('Aborted')))
        );
      }
      const status = s.headStatus ?? s.status ?? 200;
      const length = s.headLength ?? s.body?.length ?? 0;
      return {
        status,
        headers: { get: (k: string) => (k.toLowerCase() === 'content-length' ? String(length) : null) },
      };
    },
    createDownloadResumable: (
      url: string,
      target: string,
      _options: unknown,
      progress: (p: { totalBytesExpectedToWrite: number; totalBytesWritten: number }) => void,
      resumeData?: string
    ) => {
      let paused = false;
      let release = () => {};
      const pausedSignal = new Promise<void>((r) => (release = r));
      const append = (b: Buffer) => files.set(target, Buffer.concat([files.get(target) ?? Buffer.alloc(0), b]));
      return {
        pauseAsync: async () => {
          paused = true;
          release();
        },
        downloadAsync: async () => {
          gets.push({ url, resumeData, mirrorPartExisted: [...files.keys()].some((k) => k.endsWith('.mirror.part')) });
          await new Promise((r) => setTimeout(r, 1));
          const s = servers.get(url);
          if (!s || s.down) throw new Error(`failed to connect to ${url}`);
          if ((s.status ?? 200) >= 400) {
            append(Buffer.from('<html>error</html>'));
            return { status: s.status };
          }
          const body = s.body!;
          const offset = resumeData ? Number(resumeData) : 0;
          const ranged = offset > 0 && !s.ignoreRange;
          const payload = ranged ? body.subarray(offset) : body;
          // Native reports both counters with the resume offset already added.
          const total = payload.length + offset;
          const half = Math.floor(payload.length / 2);
          append(payload.subarray(0, half));
          progress({ totalBytesExpectedToWrite: total, totalBytesWritten: offset + half });
          if (s.drops) throw new Error(`connection to ${url} reset`);
          if (s.hold && !paused) await pausedSignal;
          if (paused) return null;
          append(payload.subarray(half));
          progress({ totalBytesExpectedToWrite: total, totalBytesWritten: offset + payload.length });
          if (paused) return null;
          return { status: ranged ? 206 : 200 };
        },
      };
    },
  };
}

type World = ReturnType<typeof world>;
type Downloader = {
  ensureRemoteAsset(spec: object, progress?: unknown, signal?: AbortSignal): Promise<string>;
};

async function load(w: World): Promise<Downloader> {
  const g = globalThis as unknown as { __mirrorTest: World; fetch: unknown };
  g.__mirrorTest = w;
  g.fetch = (...a: unknown[]) => (w.fetch as (...b: unknown[]) => unknown)(...a);
  const mocks: Record<string, string> = {
    '@react-native-async-storage/async-storage': 'export default globalThis.__mirrorTest.storage',
    'expo-file-system/legacy':
      'const w=globalThis.__mirrorTest;export const documentDirectory=w.documentDirectory;' +
      'export const getInfoAsync=(...a)=>w.getInfoAsync(...a),makeDirectoryAsync=(...a)=>w.makeDirectoryAsync(...a),' +
      'deleteAsync=(...a)=>w.deleteAsync(...a),moveAsync=(...a)=>w.moveAsync(...a),' +
      'createDownloadResumable=(...a)=>w.createDownloadResumable(...a)',
    '../telemetry/download': 'export const beginDownload=(...a)=>globalThis.__mirrorTest.beginDownload(...a)',
    '../telemetry': 'export const track=()=>{}',
    'hiraia-managed-config': 'export const readAssetMirrorSetting=()=>globalThis.__mirrorTest.readSetting()',
  };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hiraia-asset-mirror-'));
  const outfile = path.join(dir, 'runtime.cjs');
  try {
    await build({
      entryPoints: [path.join(mobile, 'src/engine/modelDownload.ts')],
      outfile,
      bundle: true,
      platform: 'node',
      format: 'cjs',
      logLevel: 'silent',
      plugins: [
        {
          name: 'mocks',
          setup(b) {
            b.onResolve({ filter: /.*/ }, (a) => (a.path in mocks ? { path: a.path, namespace: 'mock' } : null));
            b.onLoad({ filter: /.*/, namespace: 'mock' }, (a) => ({ contents: mocks[a.path], loader: 'js' }));
          },
        },
      ],
    });
    return require(outfile) as Downloader;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const quiet = console.log;
const realFetch = globalThis.fetch;
before(() => {
  console.log = () => {}; // modelDownload narrates every step; keep the TAP output readable.
});
after(() => {
  console.log = quiet;
  globalThis.fetch = realFetch;
});

function asset(filename: string, extra: object = {}) {
  const images = filename.endsWith('.hpak');
  const url = `${CANONICAL_ASSET_PREFIX}${images ? 'images/' : ''}${filename}`;
  const mirror = `${MIRROR}/${images ? 'images/' : ''}${filename}`;
  const final = `${DOCS}models/${filename}`;
  return {
    spec: { url, filename, bytes: GOOD.length, md5: md5(GOOD), label: filename, ...extra },
    url,
    mirror,
    final,
    part: `${final}.part`,
    mirrorPart: `${final}.mirror.part`,
  };
}

test('no mirror configured: the canonical download runs exactly as before', async () => {
  const w = world();
  const x = await load(w);
  const a = asset('labse.Q4_K_M.gguf');
  const b = asset('vectors-labse-90318bad81dd.i8.bin');
  w.servers.set(a.url, { body: GOOD });
  w.servers.set(b.url, { body: GOOD });
  w.files.set(b.part, GOOD.subarray(0, 7000));
  assert.equal(await x.ensureRemoteAsset(a.spec), a.final.replace('file://', ''));
  assert.equal(await x.ensureRemoteAsset(b.spec), b.final.replace('file://', ''));
  assert.deepEqual(
    w.gets.map((g) => [g.url, g.resumeData, g.mirrorPartExisted]),
    [
      [a.url, undefined, false],
      [b.url, '7000', false],
    ],
    'a fresh download from byte 0, and a canonical prefix resumed as it always was'
  );
  assert.deepEqual(w.heads, [], 'nothing on the LAN is contacted');
  assert.equal(md5(w.files.get(a.final)!), md5(GOOD));
  assert.equal(md5(w.files.get(b.final)!), md5(GOOD));
  assert.ok([...w.files.keys()].every((k) => !k.endsWith('.part')), 'no partial of any kind is left');
});

test('a working mirror installs the verified file and the canonical host is never called', async () => {
  const w = world();
  w.setting = `${MIRROR}/`;
  const x = await load(w);
  for (const a of [asset('labse.Q4_K_M.gguf'), asset('common-01-0123.hpak')]) {
    w.servers.set(a.mirror, { body: GOOD });
    w.servers.set(a.url, { down: true }); // Proves it: any canonical request would fail the download.
    w.files.set(a.part, GOOD.subarray(0, 5000)); // An old canonical prefix, obsolete once installed.
    assert.equal(await x.ensureRemoteAsset(a.spec), a.final.replace('file://', ''));
    assert.equal(md5(w.files.get(a.final)!), md5(GOOD));
    assert.equal(w.files.has(a.mirrorPart), false);
    assert.equal(w.files.has(a.part), false);
    assert.ok(w.events.includes(`installed ${a.spec.filename}`));
  }
  assert.deepEqual(w.heads, [`${MIRROR}/labse.Q4_K_M.gguf`, `${MIRROR}/images/common-01-0123.hpak`]);
  assert.ok(w.gets.every((g) => g.url.startsWith(`${MIRROR}/`)), 'canonical never requested');
  assert.equal(w.reads, 2, 'the setting is read when each download starts');
});

test('every kind of mirror refusal or bad body falls back to the canonical URL with the mirror bytes gone', async () => {
  const cases: [string, Server][] = [
    ['unreachable', { down: true }],
    ['404', { headStatus: 404, status: 404 }],
    ['HEAD declares another size', { body: GOOD, headLength: GOOD.length + 1 }],
    ['HTTP error on GET', { body: GOOD, headStatus: 200, headLength: GOOD.length, status: 500 }],
    ['same size, wrong MD5', { body: EVIL }],
    ['short body (a login page)', { body: Buffer.from('<html>login</html>'), headLength: GOOD.length }],
    ['longer body', { body: Buffer.concat([GOOD, GOOD]), headLength: GOOD.length }],
  ];
  for (const [name, mirror] of cases) {
    const w = world();
    w.setting = MIRROR;
    const x = await load(w);
    const a = asset('vectors-labse-90318bad81dd.i8.bin');
    w.servers.set(a.mirror, mirror);
    w.servers.set(a.url, { body: GOOD });
    assert.equal(await x.ensureRemoteAsset(a.spec), a.final.replace('file://', ''), name);
    assert.equal(md5(w.files.get(a.final)!), md5(GOOD), name);
    assert.equal(w.files.has(a.mirrorPart), false, `${name}: mirror partial discarded`);
    const canonical = w.gets.filter((g) => g.url === a.url);
    assert.equal(canonical.length, 1, `${name}: exactly one canonical transfer`);
    assert.equal(canonical[0]!.resumeData, undefined, `${name}: canonical starts from byte 0`);
    assert.equal(canonical[0]!.mirrorPartExisted, false, `${name}: discarded BEFORE the canonical run`);
  }
});

test('a failing mirror never touches the canonical resume prefix', async () => {
  const w = world();
  w.setting = MIRROR;
  const x = await load(w);
  const a = asset('labse.Q4_K_M.gguf');
  const prefix = 10_000;
  w.files.set(a.part, GOOD.subarray(0, prefix));
  w.servers.set(a.mirror, { body: EVIL });
  w.servers.set(a.url, { body: GOOD });
  await x.ensureRemoteAsset(a.spec);
  const canonical = w.gets.find((g) => g.url === a.url)!;
  assert.equal(canonical.resumeData, String(prefix), 'the genuine prefix is resumed, not re-bought');
  assert.equal(md5(w.files.get(a.final)!), md5(GOOD));
});

test('a mirror that ignores Range on a resume is discarded, not appended to', async () => {
  const w = world();
  w.setting = MIRROR;
  const x = await load(w);
  const a = asset('labse.Q4_K_M.gguf');
  w.files.set(a.mirrorPart, GOOD.subarray(0, 6000));
  w.servers.set(a.mirror, { body: GOOD, ignoreRange: true });
  w.servers.set(a.url, { body: GOOD });
  await x.ensureRemoteAsset(a.spec);
  assert.deepEqual(
    w.gets.map((g) => [g.url, g.resumeData]),
    [
      [a.mirror, '6000'],
      [a.url, undefined],
    ]
  );
  assert.equal(w.files.has(a.mirrorPart), false);
  assert.equal(md5(w.files.get(a.final)!), md5(GOOD));
});

test('a mirror that never answers costs seconds, not the transfer timeout', async () => {
  const w = world();
  w.setting = MIRROR;
  const x = await load(w);
  const a = asset('labse.Q4_K_M.gguf');
  w.servers.set(a.mirror, { body: GOOD, headHangs: true });
  w.servers.set(a.url, { body: GOOD });
  const t0 = Date.now();
  await x.ensureRemoteAsset(a.spec);
  const elapsed = Date.now() - t0;
  assert.ok(elapsed >= 2_900 && elapsed < 6_000, `fell back after ${elapsed} ms`);
  assert.deepEqual(w.gets.map((g) => g.url), [a.url], 'no GET is sent to a mirror that did not answer');
});

test('a mirror that goes quiet mid-transfer is dropped in seconds, and what it sent is continued from the canonical host', async () => {
  const w = world();
  w.setting = MIRROR;
  const x = await load(w);
  const a = asset('labse.Q4_K_M.gguf');
  w.servers.set(a.mirror, { body: GOOD, hold: true }); // half the body, then silence
  w.servers.set(a.url, { body: GOOD });
  // Only the stall watchdog's clock is faked (setInterval + Date.now); every other timer is real.
  mock.timers.enable({ apis: ['setInterval', 'Date'] });
  try {
    const run = x.ensureRemoteAsset(a.spec);
    for (let i = 0; i < 200 && w.files.get(a.mirrorPart)?.length !== GOOD.length / 2; i++) {
      await new Promise((r) => setTimeout(r, 2));
    }
    assert.equal(w.files.get(a.mirrorPart)?.length, GOOD.length / 2, 'the mirror transfer is under way');

    // Ten quiet seconds is a busy laptop, not a dead one: keep waiting.
    mock.timers.tick(10_000);
    await new Promise((r) => setTimeout(r, 20));
    assert.deepEqual(w.gets.map((g) => g.url), [a.mirror]);

    // Twenty is a dead one. The canonical STALL_MS (60 s) would still be waiting here.
    mock.timers.tick(10_000);
    const fellBack = await Promise.race([
      run.then(() => true),
      new Promise<false>((r) => setTimeout(() => r(false), 2_000)),
    ]);
    assert.ok(fellBack, 'fell back to the canonical host after 20 s of mirror silence');
  } finally {
    mock.timers.reset();
  }
  assert.deepEqual(
    w.gets.map((g) => [g.url, g.resumeData, g.mirrorPartExisted]),
    [
      [a.mirror, undefined, false],
      [a.url, String(GOOD.length / 2), false],
    ],
    'the half the mirror sent before going quiet is not bought again'
  );
  assert.equal(md5(w.files.get(a.final)!), md5(GOOD));
});

test('an abort keeps the mirror partial and the next download resumes it from the mirror', async () => {
  const w = world();
  w.setting = MIRROR;
  const x = await load(w);
  const a = asset('labse.Q4_K_M.gguf');
  w.servers.set(a.mirror, { body: GOOD, hold: true });
  w.servers.set(a.url, { body: GOOD });
  const controller = new AbortController();
  const run = x.ensureRemoteAsset(a.spec, undefined, controller.signal);
  for (let i = 0; i < 200 && !w.files.has(a.mirrorPart); i++) await new Promise((r) => setTimeout(r, 2));
  controller.abort();
  await assert.rejects(run, /aborted/);
  const kept = w.files.get(a.mirrorPart)!.length;
  assert.equal(kept, GOOD.length / 2);

  w.servers.set(a.mirror, { body: GOOD });
  await x.ensureRemoteAsset(a.spec);
  assert.deepEqual(
    w.gets.map((g) => [g.url, g.resumeData]),
    [
      [a.mirror, undefined],
      [a.mirror, String(kept)],
    ]
  );
  assert.equal(md5(w.files.get(a.final)!), md5(GOOD));
});

// ---------------------------------------------------------------------------------------------
// Away from the warehouse. The managed setting stays on the phone, so at a school the mirror
// address points at nothing. The mirror must then cost one probe per cool-off window, not one
// per file, and what it already delivered must not be bought again over the school's link.
// ---------------------------------------------------------------------------------------------

const FILES = [
  'labse.Q4_K_M.gguf',
  'vectors-labse-90318bad81dd.i8.bin',
  'common-01-0123.hpak',
  'grade5-01-4567.hpak',
];

test('a mirror that is not there is probed once, then skipped by every download in the window', async () => {
  const w = world();
  w.setting = MIRROR;
  const x = await load(w);
  const [first, ...rest] = FILES.map((f) => asset(f));
  for (const a of [first!, ...rest]) {
    w.servers.set(a.mirror, { body: GOOD, headHangs: true }); // The address answers nothing.
    w.servers.set(a.url, { body: GOOD });
  }
  const t0 = Date.now();
  await x.ensureRemoteAsset(first!.spec);
  const t1 = Date.now();
  for (const a of rest) await x.ensureRemoteAsset(a.spec);
  const t2 = Date.now();
  assert.ok(t1 - t0 >= 2_900, `the first file paid the probe (${t1 - t0} ms)`);
  assert.ok(t2 - t1 < 1_000, `the other ${rest.length} files paid nothing (${t2 - t1} ms)`);
  assert.deepEqual(w.heads, [first!.mirror], 'exactly one probe');
  assert.deepEqual(
    w.gets.map((g) => g.url),
    [first!, ...rest].map((a) => a.url),
    'every file came from the canonical host'
  );
  assert.equal(w.reads, FILES.length, 'the setting is still read for each download');
});

test('a mirror that answers is never skipped: a file it lacks or gets wrong costs only that file', async () => {
  // The warehouse mirror serves only files that matched its tables at startup, so a pack it has
  // not synced (or one newer than its tables) is a 404 from a mirror that is working. Were that to
  // open the breaker, LaBSE would go to the internet next, and a warehouse without internet
  // (--offline) would have nowhere to get it from.
  const w = world();
  w.setting = MIRROR;
  const x = await load(w);
  const [labse, vectors, common, grade5] = FILES.map((f) => asset(f));
  w.servers.set(common!.mirror, { headStatus: 404, status: 404 }); // Not synced.
  w.servers.set(vectors!.mirror, { body: GOOD, headLength: 99 }); // Some other file.
  w.servers.set(grade5!.mirror, { body: EVIL }); // Served, and wrong.
  w.servers.set(labse!.mirror, { body: GOOD });
  for (const f of [labse!, vectors!, common!, grade5!]) w.servers.set(f.url, { body: GOOD });
  for (const f of [common!, vectors!, grade5!, labse!]) await x.ensureRemoteAsset(f.spec);
  assert.deepEqual(w.heads, [common!.mirror, vectors!.mirror, grade5!.mirror, labse!.mirror], 'every file asked it');
  assert.deepEqual(w.gets.map((g) => g.url), [common!.url, vectors!.url, grade5!.mirror, grade5!.url, labse!.mirror]);
  for (const f of [labse!, vectors!, common!, grade5!]) assert.equal(md5(w.files.get(f.final)!), md5(GOOD));
});

test('a mirror transfer that breaks off hands its bytes to the canonical host and does not open the breaker', async () => {
  const w = world();
  w.setting = MIRROR;
  const x = await load(w);
  const [a, b] = FILES.map((f) => asset(f));
  w.servers.set(a!.mirror, { body: GOOD, drops: true });
  w.servers.set(b!.mirror, { body: GOOD });
  for (const f of [a!, b!]) w.servers.set(f.url, { body: GOOD });
  await x.ensureRemoteAsset(a!.spec);
  await x.ensureRemoteAsset(b!.spec);
  assert.deepEqual(
    w.gets.map((g) => [g.url, g.resumeData, g.mirrorPartExisted]),
    [
      [a!.mirror, undefined, false],
      [a!.url, String(GOOD.length / 2), false],
      [b!.mirror, undefined, false],
    ],
    'the half that arrived is continued, not bought again, and the next file still uses the mirror'
  );
  for (const f of [a!, b!]) assert.equal(md5(w.files.get(f.final)!), md5(GOOD));
});

test('a probe cut short by an abort does not count against the mirror', async () => {
  const w = world();
  w.setting = MIRROR;
  const x = await load(w);
  const a = asset(FILES[0]!);
  w.servers.set(a.mirror, { body: GOOD, headHangs: true });
  w.servers.set(a.url, { body: GOOD });
  const controller = new AbortController();
  const run = x.ensureRemoteAsset(a.spec, undefined, controller.signal);
  for (let i = 0; i < 200 && w.heads.length === 0; i++) await new Promise((r) => setTimeout(r, 2));
  controller.abort(); // The app went to the background while the probe was out.
  await assert.rejects(run, /aborted/);
  w.servers.set(a.mirror, { body: GOOD });
  await x.ensureRemoteAsset(a.spec);
  assert.deepEqual(w.heads, [a.mirror, a.mirror], 'asked again at once');
  assert.deepEqual(w.gets.map((g) => g.url), [a.mirror]);
});

test('the mirror is probed again after each cool-off, and an answer starts the count over', async () => {
  const w = world();
  w.setting = MIRROR;
  const x = await load(w);
  const [a, b, c, d, e, f, g] = Array.from({ length: 7 }, (_, i) => asset(`common-0${i + 1}-0123.hpak`));
  for (const k of [a!, b!, c!, d!, e!, f!, g!]) w.servers.set(k.url, { body: GOOD });
  // Only the breaker's clock (Date) is faked; timers stay real.
  mock.timers.enable({ apis: ['Date'], now: 50_000 });
  try {
    await x.ensureRemoteAsset(a!.spec); // Mirror unreachable: the breaker opens for a minute.
    mock.timers.tick(MIRROR_COOL_OFF_MS - 1);
    await x.ensureRemoteAsset(b!.spec); // Still inside the window: no probe.
    assert.deepEqual(w.heads, [a!.mirror]);

    mock.timers.tick(1);
    await x.ensureRemoteAsset(c!.spec); // Probed again, still silent: two minutes now.
    assert.deepEqual(w.heads, [a!.mirror, c!.mirror], 'probed again after the window');
    mock.timers.tick(2 * MIRROR_COOL_OFF_MS - 1);
    await x.ensureRemoteAsset(d!.spec);
    assert.deepEqual(w.heads, [a!.mirror, c!.mirror], 'the second window is twice as long');

    mock.timers.tick(1);
    w.servers.set(e!.mirror, { body: GOOD }); // The laptop is back.
    await x.ensureRemoteAsset(e!.spec);
    assert.deepEqual(w.heads, [a!.mirror, c!.mirror, e!.mirror]);
    assert.equal(w.gets.at(-1)!.url, e!.mirror, 'and used');

    await x.ensureRemoteAsset(f!.spec); // Silent again, but after an answer: one minute, not four.
    mock.timers.tick(MIRROR_COOL_OFF_MS);
    await x.ensureRemoteAsset(g!.spec);
    assert.deepEqual(w.heads, [a!.mirror, c!.mirror, e!.mirror, f!.mirror, g!.mirror]);
  } finally {
    mock.timers.reset();
  }
});

test('the breaker is keyed by the mirror URL: a moved mirror is tried at once', async () => {
  const w = world();
  w.setting = MIRROR;
  const x = await load(w);
  const [a, b, c] = FILES.map((f) => asset(f));
  for (const f of [a!, b!, c!]) w.servers.set(f.url, { body: GOOD });
  const moved = `${MOVED}/${b!.url.slice(CANONICAL_ASSET_PREFIX.length)}`;
  w.servers.set(moved, { body: GOOD });
  await x.ensureRemoteAsset(a!.spec); // The old address is dead: open for MIRROR.

  w.setting = MOVED;
  await x.ensureRemoteAsset(b!.spec);
  assert.deepEqual(w.heads, [a!.mirror, moved]);
  assert.equal(w.gets.at(-1)!.url, moved, 'installed from the moved mirror');

  w.setting = MIRROR; // Back to the address that failed a moment ago.
  await x.ensureRemoteAsset(c!.spec);
  assert.deepEqual(w.heads, [a!.mirror, moved], 'the dead address is still cooling off');
  assert.equal(w.gets.at(-1)!.url, c!.url);
});

test('an interrupted mirror partial continues from the canonical URL when the mirror is unavailable', async () => {
  const cases: [string, (w: World, x: Downloader) => Promise<void>][] = [
    ['mirror no longer configured', async (w) => void (w.setting = null)],
    ['mirror unreachable', async () => {}],
    [
      'mirror answers with another length',
      async (w) => void w.servers.set(asset(FILES[0]!).mirror, { body: GOOD, headLength: 99 }),
    ],
    [
      'breaker open',
      async (w, x) => {
        const other = asset(FILES[1]!);
        w.servers.set(other.url, { body: GOOD });
        await x.ensureRemoteAsset(other.spec); // Its failed probe opens the breaker.
        w.gets.length = 0;
        w.heads.length = 0;
        // Even a mirror that is back is not asked until the window ends.
        w.servers.set(asset(FILES[0]!).mirror, { body: GOOD });
      },
    ],
  ];
  for (const [name, arrange] of cases) {
    const w = world();
    w.setting = MIRROR;
    const x = await load(w);
    const a = asset(FILES[0]!);
    w.servers.set(a.url, { body: GOOD });
    await arrange(w, x);
    w.files.set(a.mirrorPart, GOOD.subarray(0, 6000)); // Left by an aborted mirror transfer.
    await x.ensureRemoteAsset(a.spec);
    const canonical = w.gets.filter((g) => g.url === a.url);
    assert.deepEqual(
      canonical.map((g) => [g.resumeData, g.mirrorPartExisted]),
      [['6000', false]],
      `${name}: one canonical transfer, resumed at the mirror partial's length`
    );
    assert.ok(w.gets.every((g) => g.url === a.url), `${name}: nothing requested from the mirror`);
    if (name === 'breaker open') assert.deepEqual(w.heads, [], 'not even probed');
    assert.equal(md5(w.files.get(a.final)!), md5(GOOD), name);
    assert.equal(w.files.has(a.mirrorPart), false, name);
    assert.equal(w.files.has(a.part), false, name);
  }
});

test('the handoff keeps the longer usable partial and never moves one longer than the file', async () => {
  const over = GOOD.length + 10;
  const cases: [string, number | null, number, string | undefined][] = [
    // name, canonical .part size (null = none), mirror partial size, expected Range offset
    ['canonical longer', 10_000, 6000, '10000'],
    ['canonical shorter', 3000, 6000, '6000'],
    ['canonical absent', null, 6000, '6000'],
    ['mirror partial complete', null, GOOD.length, undefined],
    ['mirror partial longer than the file', 3000, over, '3000'],
    ['mirror partial longer than the file, no canonical', null, over, undefined],
    ['canonical longer than the file', over, 6000, '6000'],
    ['empty mirror partial', null, 0, undefined],
  ];
  const bytes = (n: number) => (n <= GOOD.length ? GOOD.subarray(0, n) : Buffer.concat([GOOD, GOOD]).subarray(0, n));
  for (const [name, canonicalSize, mirrorSize, offset] of cases) {
    const w = world();
    const x = await load(w); // No mirror: the setting was removed.
    const a = asset('labse.Q4_K_M.gguf');
    w.servers.set(a.url, { body: GOOD });
    if (canonicalSize !== null) w.files.set(a.part, bytes(canonicalSize));
    w.files.set(a.mirrorPart, bytes(mirrorSize));
    await x.ensureRemoteAsset(a.spec);
    assert.deepEqual(
      w.gets.map((g) => [g.resumeData, g.mirrorPartExisted]),
      // A complete, correct partial is verified and installed without any request.
      name === 'mirror partial complete' ? [] : [[offset, false]],
      name
    );
    assert.equal(md5(w.files.get(a.final)!), md5(GOOD), name);
    assert.equal(w.files.has(a.mirrorPart), false, name);
  }
});

test('a size-only asset never adopts a mirror partial: its gate could not check those bytes', async () => {
  const w = world();
  const x = await load(w);
  const a = asset('labse.Q4_K_M.gguf', { md5: null });
  w.servers.set(a.url, { body: GOOD });
  w.files.set(a.mirrorPart, EVIL.subarray(0, 6000));
  await x.ensureRemoteAsset(a.spec);
  assert.deepEqual(w.gets.map((g) => [g.url, g.resumeData, g.mirrorPartExisted]), [[a.url, undefined, false]]);
  assert.equal(md5(w.files.get(a.final)!), md5(GOOD), 'the mirror bytes did not reach the installed file');
});

test('a corrupted handed-off prefix ends in a full, correct download, never an installed bad file', async () => {
  // A prefix (bytes 100-199 wrong) and a complete-length file whose MD5 is wrong.
  for (const bad of [EVIL.subarray(0, 6000), EVIL]) {
    const w = world();
    w.setting = MIRROR; // Configured, but not there.
    const x = await load(w);
    const a = asset('labse.Q4_K_M.gguf');
    w.servers.set(a.url, { body: GOOD });
    w.files.set(a.mirrorPart, Buffer.from(bad));
    await x.ensureRemoteAsset(a.spec);
    const resumed = bad.length < GOOD.length ? [[a.url, String(bad.length)]] : []; // Full: verify only.
    assert.deepEqual(
      w.gets.map((g) => [g.url, g.resumeData]),
      [...resumed, [a.url, undefined]],
      `${bad.length}: the whole-file MD5 rejects it and the retry starts from byte 0`
    );
    assert.equal(md5(w.files.get(a.final)!), md5(GOOD));
    assert.deepEqual(w.events, ['failed labse.Q4_K_M.gguf', 'installed labse.Q4_K_M.gguf']);
    assert.equal(w.files.has(a.part), false);
    assert.equal(w.files.has(a.mirrorPart), false);
  }
});

test('the mirror is never consulted for a size-only spec, other hosts, or an invalid setting', async () => {
  const cases: [string, unknown, object][] = [
    ['no MD5 pinned', MIRROR, { md5: null }],
    ['malformed MD5', MIRROR, { md5: 'abc' }],
    ['another host', MIRROR, { url: 'https://hiraia.org/models/labse.Q4_K_M.gguf' }],
    ['public-IP setting', 'http://8.8.8.8/mirror/models', {}],
    ['hostname setting', 'http://laptop.local:8080/mirror/models', {}],
    ['non-string setting', 42, {}],
  ];
  for (const [name, setting, extra] of cases) {
    const w = world();
    w.setting = setting;
    const x = await load(w);
    const a = asset('labse.Q4_K_M.gguf', extra);
    w.servers.set(a.spec.url, { body: GOOD });
    for (const url of [`${MIRROR}/labse.Q4_K_M.gguf`, 'http://8.8.8.8/mirror/models/labse.Q4_K_M.gguf']) {
      w.servers.set(url, { body: GOOD });
    }
    // A malformed digest can match nothing, so the canonical download fails closed too.
    if (name === 'malformed MD5') await assert.rejects(x.ensureRemoteAsset(a.spec), /MD5/);
    else await x.ensureRemoteAsset(a.spec);
    assert.deepEqual(w.heads, [], name);
    assert.deepEqual(w.gets.map((g) => g.url), [a.spec.url], name);
  }
});
