/**
 * The web app's end of the drawing socket, against stand-in services that behave well, badly or not at all.
 * (The real job in its real sandbox is exercised by deploy/render/verify.mjs, which needs systemd and LibreOffice.)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { jpegSize, RenderError, rendererFromEnv, retiredRenderSettings, socketRenderer, RENDER_LIMITS } from './upload-render';

const MAGIC = Buffer.from('TALARND1', 'latin1');
const frame = (type: number, body: Buffer | Uint8Array): Buffer => {
  const head = Buffer.alloc(5);
  head.writeUInt8(type, 0);
  head.writeUInt32BE(body.length, 1);
  return Buffer.concat([head, Buffer.from(body)]);
};
const u32 = (n: number): Buffer => {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n, 0);
  return b;
};
const report = (over: Record<string, unknown> = {}): Buffer => frame(0x01, Buffer.from(JSON.stringify({ v: 1, ok: true, failed: [], uid: 64001, isolation: 'own-user', ...over })));
const done = (n: number): Buffer => frame(0x7f, u32(n));
const failed = (status: number): Buffer => frame(0x7e, Buffer.from([status]));

/** A whole (if empty) JPEG of the given size: start, a frame header, a comment for length, end. */
function jpeg(width: number, height: number, pad = 80): Buffer {
  const sof = Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01]);
  const comment = Buffer.concat([Buffer.from([0xff, 0xfe, (pad + 2) >> 8, (pad + 2) & 0xff]), Buffer.alloc(pad, 0x20)]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), comment, sof, Buffer.from([0xff, 0xd9])]);
}

interface Request {
  op: number;
  width: number;
  slides: number;
  file: Buffer;
}
type Behaviour = (sock: net.Socket, request: Request) => void;

/** A stand-in drawing service on a socket file. `onConnect` runs before anything is read. */
async function service(behave: Behaviour, onConnect?: (sock: net.Socket) => boolean): Promise<{ path: string; requests: Request[]; close(): Promise<void> }> {
  const dir = mkdtempSync(join(tmpdir(), 'tala-render-test-'));
  const path = join(dir, 'render.sock');
  const requests: Request[] = [];
  const open = new Set<net.Socket>();
  const server = net.createServer((sock) => {
    open.add(sock);
    sock.on('close', () => open.delete(sock));
    sock.on('error', () => undefined);
    if (onConnect && !onConnect(sock)) return;
    let got = Buffer.alloc(0);
    let answered = false;
    sock.on('data', (chunk: Buffer) => {
      got = Buffer.concat([got, chunk]);
      if (answered || got.length < 20) return;
      const length = got.readUInt32BE(16);
      if (got.length < 20 + length) return;
      answered = true;
      const request = { op: got.readUInt8(8), width: got.readUInt16BE(10), slides: got.readUInt16BE(12), file: got.subarray(20, 20 + length) };
      requests.push(request);
      behave(sock, request);
    });
  });
  await new Promise<void>((resolve) => server.listen(path, resolve));
  return {
    path,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => {
          rmSync(dir, { recursive: true, force: true });
          resolve();
        });
        // A stand-in that never reads would never notice that the other side has gone.
        for (const sock of open) sock.destroy();
      }),
  };
}

const kindOf = async (p: Promise<unknown>): Promise<string> => {
  try {
    await p;
    return 'drawn';
  } catch (err) {
    assert.ok(err instanceof RenderError, `a RenderError, not ${String(err)}`);
    return `${err.kind}: ${err.reason}`;
  }
};
const FILE = new Uint8Array([0x50, 0x4b, 3, 4, 9, 9, 9]);

test('a service that draws: the file and the slide count go over, the pictures come back in order', async () => {
  const s = await service((sock, r) => {
    sock.write(MAGIC);
    sock.write(report());
    for (let i = 0; i < r.slides; i++) sock.write(frame(0x02, jpeg(1280, 720 + i)));
    sock.write(frame(0x03, Buffer.from(JSON.stringify({ ms: { total: 5 } }))));
    sock.end(done(r.slides));
  });
  try {
    const renderer = socketRenderer({ socketPath: s.path, requireOwnUser: true, ownUid: 986 });
    const pictures = await renderer.render(FILE, 3);
    assert.deepEqual(pictures.map((p) => jpegSize(p)?.height), [720, 721, 722]);
    assert.deepEqual([s.requests[0]!.op, s.requests[0]!.width, s.requests[0]!.slides, [...s.requests[0]!.file]], [1, 1280, 3, [...FILE]]);
    // A probe asks for the report and nothing else.
    const seen = await renderer.probe();
    assert.deepEqual([seen.ok, seen.isolation, s.requests[1]!.op, s.requests[1]!.file.length], [true, 'own-user', 2, 0]);
  } finally {
    await s.close();
  }
});

test('no service: a socket that is not there, is not a socket, or is not listening means "no pictures here"', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tala-render-test-'));
  try {
    const missing = socketRenderer({ socketPath: join(dir, 'nothing.sock'), requireOwnUser: true });
    assert.match(await kindOf(missing.render(FILE, 1)), /^unavailable: socket ENOENT$/);
    writeFileSync(join(dir, 'plain-file'), 'x');
    assert.match(await kindOf(socketRenderer({ socketPath: join(dir, 'plain-file'), requireOwnUser: true }).render(FILE, 1)), /^unavailable: socket E(CONNREFUSED|NOTSOCK)$/);
    const s = await service(() => undefined);
    const gone = socketRenderer({ socketPath: s.path, requireOwnUser: true });
    await s.close();
    assert.match(await kindOf(gone.render(FILE, 1)), /^unavailable: socket E(NOENT|CONNREFUSED)$/);
    assert.match(await kindOf(gone.probe()), /^unavailable: /);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('turned away without a word: busy the first times, then a service that does not start', async () => {
  const s = await service(
    () => undefined,
    (sock) => {
      sock.destroy();
      return false;
    }
  );
  try {
    const renderer = socketRenderer({ socketPath: s.path, requireOwnUser: true, turnTries: 3, turnWaitMs: 5 });
    assert.deepEqual([await kindOf(renderer.render(FILE, 1)), await kindOf(renderer.render(FILE, 1)), await kindOf(renderer.render(FILE, 1))], [
      'busy: the drawing service is busy',
      'busy: the drawing service is busy',
      'unavailable: the drawing service does not start',
    ]);
  } finally {
    await s.close();
  }
});

test('one file at a time: a caller that is turned away waits a moment for its turn before it says busy', async () => {
  let connections = 0;
  const s = await service(
    (sock, r) => sock.end(Buffer.concat([MAGIC, report(), ...Array.from({ length: r.slides }, () => frame(0x02, jpeg(1280, 720))), done(r.slides)])),
    (sock) => {
      connections += 1;
      // The job before is still on its way out for the first two tries.
      if (connections <= 2) {
        sock.destroy();
        return false;
      }
      return true;
    }
  );
  try {
    const renderer = socketRenderer({ socketPath: s.path, requireOwnUser: true, ownUid: 986, turnTries: 4, turnWaitMs: 5 });
    assert.equal((await renderer.render(FILE, 2)).length, 2);
    assert.equal(connections, 3);
  } finally {
    await s.close();
  }
});

test('a job that refuses because its sandbox is not whole: nothing is drawn, and only its own short names reach the log', async () => {
  const s = await service((sock) => {
    sock.write(MAGIC);
    sock.write(report({ ok: false, failed: ['no-network-device', 'host-files-hidden', 'DROP TABLE users; --', 'x'.repeat(200)] }));
    sock.end(failed(3));
  });
  try {
    assert.equal(await kindOf(socketRenderer({ socketPath: s.path, requireOwnUser: true }).render(FILE, 2)), 'unavailable: the job refused to draw: sandbox check failed (no-network-device,host-files-hidden)');
  } finally {
    await s.close();
  }
});

test('pictures are not believed without the report that the sandbox held', async () => {
  const cases: Array<[string, Buffer[], RegExp]> = [
    ['no report at all', [done(0)], /^unavailable: no sandbox report$/],
    ['a report that says not ok, then "done" anyway', [report({ ok: false, failed: ['seccomp'] }), frame(0x02, jpeg(1280, 720)), done(1)], /^unavailable: no sandbox report$/],
    ['a report of another version', [report({ v: 2 }), frame(0x02, jpeg(1280, 720)), done(1)], /^unavailable: no sandbox report$/],
    ['a job that runs as root', [report({ uid: 0 }), frame(0x02, jpeg(1280, 720)), done(1)], /^unavailable: sandbox: the job runs as root$/],
    ['a job that shares its user with other processes', [report({ isolation: 'shared-user' }), frame(0x02, jpeg(1280, 720)), done(1)], /^unavailable: sandbox: the job does not run as a user of its own$/],
    ['a job that runs as the web app itself', [report({ uid: 986 }), frame(0x02, jpeg(1280, 720)), done(1)], /^unavailable: sandbox: the job does not run as a user of its own$/],
    ['a picture before the report', [frame(0x02, jpeg(1280, 720)), report(), done(1)], /^failed: unexpected answer \(picture out of place\)$/],
    ['programs missing', [report(), failed(4)], /^unavailable: programs missing$/],
  ];
  for (const [name, frames, expected] of cases) {
    const s = await service((sock) => sock.end(Buffer.concat([MAGIC, ...frames])));
    try {
      assert.match(await kindOf(socketRenderer({ socketPath: s.path, requireOwnUser: true, ownUid: 986 }).render(FILE, 1)), expected, name);
    } finally {
      await s.close();
    }
  }
  // On a developer's machine, and only there, a job that runs as the developer is accepted.
  const dev = await service((sock) => sock.end(Buffer.concat([MAGIC, report({ isolation: 'shared-user', uid: 1000 }), frame(0x02, jpeg(1280, 720)), done(1)])));
  try {
    assert.equal(await kindOf(socketRenderer({ socketPath: dev.path, requireOwnUser: false, ownUid: 1000 }).render(FILE, 1)), 'drawn');
  } finally {
    await dev.close();
  }
});

test('a file that cannot be drawn, a job that is killed, and answers that are not what was asked for all fail closed', async () => {
  const cases: Array<[string, Buffer[], RegExp, number?]> = [
    ['the job says it could not convert', [report(), failed(6)], /^failed: could not convert$/],
    ['the job says it ran out of time', [report(), failed(7)], /^failed: out of time$/],
    ['the archive was refused', [report(), failed(5)], /^failed: archive refused$/],
    ['killed after two pictures (no end)', [report(), frame(0x02, jpeg(1280, 720)), frame(0x02, jpeg(1280, 720))], /^failed: the drawing job was stopped before it finished$/, 3],
    ['killed before anything but the greeting', [], /^failed: the drawing job was stopped before it finished$/],
    ['fewer pictures than slides', [report(), frame(0x02, jpeg(1280, 720)), done(1)], /^failed: page count$/, 2],
    ['more pictures than slides', [report(), frame(0x02, jpeg(1280, 720)), frame(0x02, jpeg(1280, 720)), done(2)], /^failed: unexpected answer \(picture out of place\)$/, 1],
    ['"done" with a count that is not what was sent', [report(), frame(0x02, jpeg(1280, 720)), done(7)], /^failed: page count$/, 1],
    ['a picture that is not a JPEG', [report(), frame(0x02, Buffer.from('<svg onload=alert(1)>'.padEnd(200, ' '))), done(1)], /^failed: a picture is not a usable JPEG$/],
    ['a JPEG wider than asked', [report(), frame(0x02, jpeg(4000, 720)), done(1)], /^failed: a picture is not a usable JPEG$/],
    ['a JPEG taller than the ceiling', [report(), frame(0x02, jpeg(1280, RENDER_LIMITS.height + 1)), done(1)], /^failed: a picture is not a usable JPEG$/],
    ['a picture larger than a picture may be', [report(), frame(0x02, jpeg(1280, 720, 60000)).subarray(0, 5), Buffer.alloc(0)], /^failed: /],
    ['an unknown part', [report(), frame(0x55, Buffer.from('?')), done(0)], /^failed: unexpected answer \(unknown part\)$/],
    ['a report that is not JSON', [frame(0x01, Buffer.from('{nope')), done(0)], /^failed: unexpected answer \(report\)$/],
    ['two reports', [report(), report(), done(0)], /^failed: unexpected answer \(report out of place\)$/],
  ];
  for (const [name, frames, expected, slides] of cases) {
    const s = await service((sock) => sock.end(Buffer.concat([MAGIC, ...frames])));
    try {
      assert.match(await kindOf(socketRenderer({ socketPath: s.path, requireOwnUser: true, ownUid: 986 }).render(FILE, slides ?? 1)), expected, name);
    } finally {
      await s.close();
    }
  }
  // A part that claims to be larger than a picture may be is refused from its header, before its bytes are taken.
  const huge = await service((sock) => {
    const head = Buffer.alloc(5);
    head.writeUInt8(0x02, 0);
    head.writeUInt32BE(RENDER_LIMITS.pictureBytes + 1, 1);
    sock.write(Buffer.concat([MAGIC, report(), head, Buffer.alloc(1024)]));
  });
  try {
    assert.equal(await kindOf(socketRenderer({ socketPath: huge.path, requireOwnUser: true, ownUid: 986 }).render(FILE, 1)), 'failed: unexpected answer (part too large)');
  } finally {
    await huge.close();
  }
  // Something else behind the socket.
  const other = await service((sock) => sock.end('HTTP/1.1 400 Bad Request\r\n\r\n'));
  try {
    assert.equal(await kindOf(socketRenderer({ socketPath: other.path, requireOwnUser: true }).render(FILE, 1)), 'failed: unexpected answer (not the drawing service)');
  } finally {
    await other.close();
  }
});

test('a job that never finishes is given up on, and a job that hangs up early is still heard', async () => {
  const slow = await service((sock) => {
    sock.write(Buffer.concat([MAGIC, report()]));
  });
  try {
    const started = Date.now();
    assert.equal(await kindOf(socketRenderer({ socketPath: slow.path, requireOwnUser: true, ownUid: 986, timeoutMs: 300 }).render(FILE, 1)), 'failed: out of time');
    assert.ok(Date.now() - started < 3000);
  } finally {
    await slow.close();
  }
  // The job answers "too large" and closes while a big file is still on its way.
  const early = await service(
    () => undefined,
    (sock) => {
      sock.end(Buffer.concat([MAGIC, report(), failed(2)]));
      return false;
    }
  );
  try {
    assert.equal(await kindOf(socketRenderer({ socketPath: early.path, requireOwnUser: true, ownUid: 986 }).render(new Uint8Array(8 * 1024 * 1024), 1)), 'failed: file too large');
  } finally {
    await early.close();
  }
});

test('slide counts outside what a deck may have are not sent at all', async () => {
  const s = await service((sock) => sock.end(Buffer.concat([MAGIC, report(), done(0)])));
  try {
    const renderer = socketRenderer({ socketPath: s.path, requireOwnUser: true });
    for (const n of [0, -1, 1.5, RENDER_LIMITS.slides + 1]) assert.equal(await kindOf(renderer.render(FILE, n)), 'failed: slide count');
    assert.equal(s.requests.length, 0);
  } finally {
    await s.close();
  }
});

test('jpegSize reads a whole JPEG and nothing else', () => {
  assert.deepEqual(jpegSize(jpeg(1280, 720)), { width: 1280, height: 720 });
  assert.deepEqual(jpegSize(jpeg(16, 4096)), { width: 16, height: 4096 });
  const whole = jpeg(1280, 720);
  assert.equal(jpegSize(whole.subarray(0, whole.length - 2)), null, 'cut short');
  assert.equal(jpegSize(Buffer.concat([Buffer.from([0x89, 0x50]), whole.subarray(2)])), null, 'not a JPEG start');
  assert.equal(jpegSize(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xda, 0x00, 0x02]), Buffer.alloc(80), Buffer.from([0xff, 0xd9])])), null, 'no frame header before the data');
  assert.equal(jpegSize(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xfe, 0xff, 0xff]), Buffer.alloc(80), Buffer.from([0xff, 0xd9])])), null, 'a segment longer than the file');
  assert.equal(jpegSize(jpeg(0, 720)), null, 'no width');
  assert.equal(jpegSize(new Uint8Array(0)), null);
});

test('settings: off by default; only the socket of the sandboxed service turns pictures on; the old settings do nothing', async () => {
  assert.equal(rendererFromEnv({}), null);
  assert.equal(rendererFromEnv({ TALA_DECKS_PREVIEW_SOCKET: 'relative/render.sock' }), null);
  // The earlier setting that ran LibreOffice from the web app is not a way in any more.
  assert.equal(rendererFromEnv({ TALA_DECKS_PREVIEW_SOFFICE: '/usr/bin/soffice', TALA_DECKS_PREVIEW_ALLOW_NETWORK: '1' }), null);
  assert.deepEqual(retiredRenderSettings({ TALA_DECKS_PREVIEW_SOFFICE: '/usr/bin/soffice', TALA_DECKS_PREVIEW_ALLOW_NETWORK: '1', TALA_DECKS_PREVIEW_SOCKET: '/run/x' }), ['TALA_DECKS_PREVIEW_SOFFICE', 'TALA_DECKS_PREVIEW_ALLOW_NETWORK']);

  // A job that shares the developer's user is accepted only on a developer's machine that asks for it by name.
  const s = await service((sock) => sock.end(Buffer.concat([MAGIC, report({ isolation: 'shared-user', uid: process.getuid?.() ?? 1000 }), frame(0x02, jpeg(1280, 720)), done(1)])));
  try {
    const base = { TALA_DECKS_PREVIEW_SOCKET: s.path };
    const outcome = async (env: NodeJS.ProcessEnv) => kindOf(rendererFromEnv(env)!.render(FILE, 1));
    assert.match(await outcome(base), /^unavailable: sandbox: the job does not run as a user of its own$/);
    assert.match(await outcome({ ...base, TALA_ENV: 'local' }), /^unavailable: /);
    assert.equal(await outcome({ ...base, TALA_ENV: 'local', TALA_DECKS_PREVIEW_SHARED_USER: '1' }), 'drawn');
    assert.equal(await outcome({ ...base, TALA_DECKS_PREVIEW_SHARED_USER: '1' }), 'drawn');
    assert.match(await outcome({ ...base, TALA_ENV: 'production', TALA_DECKS_PREVIEW_SHARED_USER: '1' }), /^unavailable: /);
    assert.match(await outcome({ ...base, TALA_ENV: 'staging', TALA_DECKS_PREVIEW_SHARED_USER: '1' }), /^unavailable: /);
  } finally {
    await s.close();
  }
});
