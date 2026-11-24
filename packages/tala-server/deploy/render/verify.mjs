#!/usr/bin/env node
/**
 * Checks the drawing service the way an inspector would: from the outside, through its socket, with ordinary
 * files, hostile files and abuse of the protocol; and from the inside, by running a hostile program in the job's
 * own box (hostile.py through sandbox-run.mjs). It makes every file it uses. Nothing is installed or changed; the
 * only things it leaves are the result files under --out.
 *
 *   on a server, as root, against the installed service:
 *       node verify.mjs --socket /run/tala-render/render.sock --out /var/tmp/tala-render-verify
 *   on a developer's machine, against `dev-units.mjs start` (give the same --soffice-dir/--fonts-dir/--userland):
 *       node verify.mjs --user --socket "$(node dev-units.mjs path)" [--soffice-dir DIR] [--fonts-dir DIR] --out DIR
 *
 *   --only probe,draw,files,protocol,turns,box    run some sections
 *   --slow                                        also wait out the real time ceilings (about four minutes more)
 *   --request-sec N                               the job's TALA_RENDER_REQUEST_SEC, when a test set-up shortened it
 *
 * Exit code 0 only when every check passed. results.json holds every answer in full; pictures of the ordinary
 * decks are written beside it for a look by eye.
 *
 * What "passed" means for a hostile file: the job refused it, failed on it, or was killed for it, in bounded time,
 * and the service answered the next request. A hostile file that is simply drawn (because LibreOffice ignored the
 * hostile part) also passes: the box is what protects, and `box` tests the box.
 */
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { here, readArgs, serviceLines, PRODUCTION_UNIT } from './units.mjs';

const { options } = readArgs(process.argv.slice(2));
const SOCKET = options.socket;
const USER = options.user === true;
if (!SOCKET) {
  console.error('usage: verify.mjs --socket PATH [--user] [--out DIR] [--only a,b] [--slow] (see the top of this file)');
  process.exit(2);
}
const OUT = options.out ? path.resolve(options.out) : null;
if (OUT) fs.mkdirSync(OUT, { recursive: true });
const ONLY = options.only ? new Set(String(options.only).split(',')) : null;
const wanted = (section) => !ONLY || ONLY.has(section);
const SLOW = process.argv.includes('--slow');
const REQUEST_SEC = Number(options.requestSec ?? 20);
const MiB = 1024 * 1024;

/* ------------------------------------------------------------------ results ------------------------------------------------------------------ */

const checks = [];
const record = { started: new Date().toISOString(), host: os.hostname(), socket: SOCKET, mode: USER ? 'developer (per-user service manager)' : 'installed service', node: process.version, sections: {} };
function check(section, name, ok, detail = '') {
  checks.push({ section, name, ok: !!ok, detail });
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? `  [${detail}]` : ''}`);
}
const note = (text) => console.log(`        ${text}`);
const heading = (text) => console.log(`\n== ${text}`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* ------------------------------------------------------------------ the socket ------------------------------------------------------------------ */

const MAGIC = Buffer.from('TALARND1', 'latin1');
const STATUS = ['ok', 'bad request', 'file too large', 'sandbox check failed', 'programs missing', 'archive refused', 'could not convert', 'out of time', 'page count', 'bad picture', 'job error'];
function header(op, width, pages, length) {
  const head = Buffer.alloc(20);
  MAGIC.copy(head, 0);
  head.writeUInt8(op, 8);
  head.writeUInt16BE(width, 10);
  head.writeUInt16BE(pages, 12);
  head.writeUInt32BE(length, 16);
  return head;
}
/** One exchange. `send`: exact bytes instead of a proper request. `hold`: keep the connection open this long, saying nothing more. */
function ask({ op = 1, file = Buffer.alloc(0), pages = 0, width = 1280, send, hold, timeoutMs = 160_000 } = {}) {
  return new Promise((resolve) => {
    const started = Date.now();
    const r = { bytes: 0, magic: false, report: null, stats: null, pictures: [], end: 'none', status: null, count: null, error: null, ms: 0 };
    const chunks = [];
    const sock = net.connect(SOCKET);
    const timer = setTimeout(() => {
      r.error = 'the tester gave up waiting';
      sock.destroy();
    }, timeoutMs);
    sock.on('connect', () => {
      if (send) sock.write(send);
      else {
        sock.write(header(op, op === 1 ? width : 0, pages, file.length));
        if (file.length) sock.write(file);
      }
      if (hold !== undefined) setTimeout(() => sock.end(), hold);
    });
    sock.on('data', (c) => chunks.push(c));
    sock.on('error', (e) => {
      if (e.code !== 'EPIPE' && e.code !== 'ECONNRESET') r.error = e.code ?? 'error';
    });
    sock.on('close', () => {
      clearTimeout(timer);
      const all = Buffer.concat(chunks);
      r.bytes = all.length;
      r.ms = Date.now() - started;
      if (all.length >= 8 && all.subarray(0, 8).equals(MAGIC)) {
        r.magic = true;
        let p = 8;
        while (p + 5 <= all.length) {
          const type = all.readUInt8(p);
          const len = all.readUInt32BE(p + 1);
          if (p + 5 + len > all.length) break;
          const body = all.subarray(p + 5, p + 5 + len);
          p += 5 + len;
          try {
            if (type === 1) r.report = JSON.parse(body.toString('utf8'));
            else if (type === 3) r.stats = JSON.parse(body.toString('utf8'));
          } catch {
            /* judged below as missing */
          }
          if (type === 2) r.pictures.push(Buffer.from(body));
          else if (type === 0x7e) {
            r.end = 'failed';
            r.status = body[0];
          } else if (type === 0x7f) {
            r.end = 'done';
            r.count = body.readUInt32BE(0);
          }
        }
      }
      resolve(r);
    });
  });
}
/** In one word, how an exchange ended. */
function outcome(r) {
  if (r.error && !r.bytes) return `no service (${r.error})`;
  if (!r.bytes) return 'turned away';
  if (!r.magic) return 'not the service';
  if (r.end === 'done') return r.pictures.length ? 'drawn' : 'done';
  if (r.end === 'failed') return `refused: ${STATUS[r.status] ?? r.status}`;
  return 'killed';
}
/** Waits until the service answers a probe again (a job that was killed takes a moment to be cleared away). */
async function ready(limitMs = 20_000) {
  const started = Date.now();
  for (;;) {
    const r = await ask({ op: 2, timeoutMs: 10_000 });
    if (r.end === 'done' && r.report?.ok) return { ok: true, ms: Date.now() - started, report: r.report };
    if (Date.now() - started > limitMs) return { ok: false, ms: Date.now() - started, last: outcome(r), report: r.report };
    await sleep(150);
  }
}
/** A draw that waits its turn (one job at a time). */
async function draw(file, pages, opts = {}) {
  for (let attempt = 0; ; attempt++) {
    const r = await ask({ file, pages, ...opts });
    if (outcome(r) !== 'turned away' || attempt > 100) return r;
    await sleep(150);
  }
}
function jpegSize(b) {
  if (b.length < 64 || b[0] !== 0xff || b[1] !== 0xd8 || b[b.length - 2] !== 0xff || b[b.length - 1] !== 0xd9) return null;
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) return null;
    const m = b[i + 1];
    if (m === 0xff) {
      i += 1;
      continue;
    }
    const len = b.readUInt16BE(i + 2);
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) };
    i += 2 + len;
  }
  return null;
}

/* ------------------------------------------------------------------ files, made here ------------------------------------------------------------------ */

const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
/**
 * A ZIP archive. An entry is { name, data } and may lie: `packed` (a ready deflate stream) with `unpackedSays`,
 * `flags`, `method`, or `nameBytes` (a name that is not text).
 */
function zip(entries, { tail = Buffer.alloc(0), zip64 = false } = {}) {
  const parts = [];
  const directory = [];
  let offset = 0;
  for (const e of entries) {
    const name = e.nameBytes ?? Buffer.from(e.name, 'utf8');
    const data = e.data ?? Buffer.alloc(0);
    const store = e.store ?? /\.(png|jpe?g|bin)$/i.test(e.name ?? '');
    const packed = e.packed ?? (store ? data : zlib.deflateRawSync(data, { level: 9 }));
    const method = e.method ?? (e.packed || !store ? 8 : 0);
    const unpacked = e.unpackedSays ?? data.length;
    const crc = e.packed ? e.crc ?? 0 : crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(e.flags ?? 0, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(unpacked >>> 0, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(e.flags ?? 0, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(unpacked >>> 0, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    directory.push(central, name);
    parts.push(local, name, packed);
    offset += 30 + name.length + packed.length;
  }
  const dir = Buffer.concat(directory);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(zip64 ? 0xffff : entries.length, 8);
  end.writeUInt16LE(zip64 ? 0xffff : entries.length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, dir, end, tail]);
}
/** `bytes` zeros, deflated without ever holding them. */
function deflatedZeros(bytes, raw) {
  return new Promise((resolve, reject) => {
    const d = raw ? zlib.createDeflateRaw({ level: 9 }) : zlib.createDeflate({ level: 9 });
    const out = [];
    d.on('data', (c) => out.push(c));
    d.on('end', () => resolve(Buffer.concat(out)));
    d.on('error', reject);
    const block = Buffer.alloc(MiB);
    let left = bytes;
    const pump = () => {
      while (left > 0) {
        const n = Math.min(left, block.length);
        left -= n;
        if (!d.write(n === block.length ? block : block.subarray(0, n))) return d.once('drain', pump);
      }
      d.end();
    };
    pump();
  });
}
/** A grey PNG of any size (all one colour, so it is tiny on disk however large it claims to be). */
async function png(width, height) {
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const out = Buffer.alloc(8 + data.length + 4);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc32(body), 8 + data.length);
    return out;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.writeUInt8(8, 8); // bit depth; colour type 0 = grey
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', await deflatedZeros(height * (width + 1), false)), chunk('IEND', Buffer.alloc(0))]);
}

const NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const EMPTY_TREE = '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>';
const textBox = (id, text, y = 600000, size = 4000) =>
  `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Text ${id}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="600000" y="${y}"/><a:ext cx="8000000" cy="1200000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr/><a:p><a:r><a:rPr lang="en-US" sz="${size}"/><a:t>${esc(text)}</a:t></a:r></a:p></p:txBody></p:sp>`;
const picture = (id, attr, x = 600000, y = 2400000) =>
  `<p:pic><p:nvPicPr><p:cNvPr id="${id}" name="Picture ${id}"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip ${attr}/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="2400000" cy="2400000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`;
const oleObject = (id, relId, kind) =>
  `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="${id}" name="Object ${id}"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="4000000" y="2400000"/><a:ext cx="3000000" cy="2000000"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/presentationml/2006/ole"><p:oleObj name="Worksheet" r:id="${relId}" imgW="3000000" imgH="2000000" progId="Excel.Sheet.12">${kind}</p:oleObj></a:graphicData></a:graphic></p:graphicFrame>`;
const THEME = `${XML}<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="T"><a:themeElements><a:clrScheme name="T"><a:dk1><a:srgbClr val="000000"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="1F3B4D"/></a:dk2><a:lt2><a:srgbClr val="EEECE1"/></a:lt2><a:accent1><a:srgbClr val="0E7C7B"/></a:accent1><a:accent2><a:srgbClr val="C0504D"/></a:accent2><a:accent3><a:srgbClr val="9BBB59"/></a:accent3><a:accent4><a:srgbClr val="8064A2"/></a:accent4><a:accent5><a:srgbClr val="4BACC6"/></a:accent5><a:accent6><a:srgbClr val="F79646"/></a:accent6><a:hlink><a:srgbClr val="0000FF"/></a:hlink><a:folHlink><a:srgbClr val="800080"/></a:folHlink></a:clrScheme><a:fontScheme name="T"><a:majorFont><a:latin typeface="Liberation Sans"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Liberation Sans"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="T"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="9525"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="25400"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="38100"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`;

/**
 * A small real presentation. `slides`: for each slide, { body, rels } (shapes after the title, and extra
 * relationship lines). `size`: the slide size in EMU. `replace`: part name -> Buffer|null to change or drop parts.
 * `add`: more entries. `mainType`: the content type of ppt/presentation.xml.
 */
function deck({ slides = 1, size = [12192000, 6858000], replace = {}, add = [], mainType = 'application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml', label = 'Tala drawing check' } = {}) {
  const list = Array.isArray(slides) ? slides : Array.from({ length: slides }, () => ({}));
  const parts = new Map();
  parts.set(
    '[Content_Types].xml',
    `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="bin" ContentType="application/vnd.openxmlformats-officedocument.oleObject"/><Override PartName="/ppt/presentation.xml" ContentType="${mainType}"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>${list.map((_s, i) => `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join('')}</Types>`
  );
  parts.set('_rels/.rels', `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="ppt/presentation.xml"/></Relationships>`);
  parts.set(
    'ppt/presentation.xml',
    `${XML}<p:presentation ${NS}><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>${list.map((_s, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 3}"/>`).join('')}</p:sldIdLst><p:sldSz cx="${size[0]}" cy="${size[1]}"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`
  );
  parts.set(
    'ppt/_rels/presentation.xml.rels',
    `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/slideMaster" Target="slideMasters/slideMaster1.xml"/><Relationship Id="rId2" Type="${REL}/theme" Target="theme/theme1.xml"/>${list.map((_s, i) => `<Relationship Id="rId${i + 3}" Type="${REL}/slide" Target="slides/slide${i + 1}.xml"/>`).join('')}</Relationships>`
  );
  parts.set(
    'ppt/slideMasters/slideMaster1.xml',
    `${XML}<p:sldMaster ${NS}><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:effectLst/></p:bgPr></p:bg><p:spTree>${EMPTY_TREE}</p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>`
  );
  parts.set('ppt/slideMasters/_rels/slideMaster1.xml.rels', `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="${REL}/theme" Target="../theme/theme1.xml"/></Relationships>`);
  parts.set('ppt/slideLayouts/slideLayout1.xml', `${XML}<p:sldLayout ${NS} type="blank"><p:cSld name="Blank"><p:spTree>${EMPTY_TREE}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`);
  parts.set('ppt/slideLayouts/_rels/slideLayout1.xml.rels', `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>`);
  parts.set('ppt/theme/theme1.xml', THEME);
  list.forEach((s, i) => {
    parts.set(`ppt/slides/slide${i + 1}.xml`, `${XML}<p:sld ${NS}${s.hidden ? ' show="0"' : ''}><p:cSld><p:spTree>${EMPTY_TREE}${textBox(2, s.title ?? `${label}: slide ${i + 1} of ${list.length}`)}${s.body ?? ''}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`);
    parts.set(`ppt/slides/_rels/slide${i + 1}.xml.rels`, `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>${s.rels ?? ''}</Relationships>`);
  });
  for (const [name, data] of Object.entries(replace)) {
    if (data === null) parts.delete(name);
    else parts.set(name, data);
  }
  return zip([...[...parts].map(([name, data]) => ({ name, data: Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8') })), ...add]);
}

/* ------------------------------------------------------------------ sections ------------------------------------------------------------------ */

async function sectionProbe() {
  heading('probe: what a job says about its own box');
  const r = await ask({ op: 2, timeoutMs: 15_000 });
  record.sections.probe = { outcome: outcome(r), report: r.report };
  check('probe', 'the service answers', r.magic, outcome(r));
  const rep = r.report ?? {};
  check('probe', 'the job checked its box and found it whole', rep.ok === true && Array.isArray(rep.failed) && rep.failed.length === 0, rep.failed?.join(',') ?? 'no report');
  if (!r.report) return;
  check('probe', 'not root, no capabilities', rep.uid !== 0 && rep.capabilities === 'none', `uid ${rep.uid}`);
  check('probe', 'no network device but its own loopback, and no way out', Array.isArray(rep.interfaces) && rep.interfaces.every((i) => i === 'lo') && String(rep.reachOut).startsWith('refused'), `${rep.interfaces?.join(',')}; ${rep.reachOut}`);
  check('probe', 'nothing of the host in sight', Array.isArray(rep.visible) && rep.visible.length === 0, rep.visible?.join(',') || `root: ${rep.root?.join(' ')}; etc: ${rep.etc?.join(' ')}`);
  check('probe', 'one place to write, in memory, small and empty', rep.writable?.length >= 1 && rep.writable.filter((w) => w.type === 'tmpfs').length === 1 && rep.scratchEntries === 0, rep.writable?.map((w) => `${w.path} ${w.type} ${w.bytes === null ? '?' : Math.round(w.bytes / MiB)} MiB`).join('; '));
  const L = rep.limits ?? {};
  check('probe', 'ceilings on memory, swap, processes, processor, file size, open files, core dumps', [L.memoryBytes, L.processes, L.fileBytes, L.openFiles, L.cpuSeconds].every((v) => /^\d+$/.test(String(v))) && L.swapBytes === '0' && L.coreBytes === '0', `memory ${Math.round(Number(L.memoryBytes) / MiB)} MiB, swap ${L.swapBytes}, processes ${L.processes}, cpu ${L.cpu}, cpu time ${L.cpuSeconds} s, file ${Math.round(Number(L.fileBytes) / MiB)} MiB, open files ${L.openFiles}`);
  check('probe', 'no stray environment (no secret can ride in)', Array.isArray(rep.environment) && rep.environment.length === 0, rep.environment?.join(','));
  if (USER) {
    check('probe', 'developer set-up: the job says it shares its user (the web app refuses that outside a developer machine)', rep.isolation === 'shared-user', rep.isolation);
  } else {
    check('probe', 'a user of its own: no process of anybody else in sight', rep.isolation === 'own-user' && rep.processes?.others === 0, `${rep.isolation}; sees ${rep.processes?.seen} process(es)`);
  }
  check('probe', 'LibreOffice, pdftoppm and pdfinfo are there', rep.missing?.length === 0, rep.missing?.join(','));
}

async function sectionDraw() {
  heading('draw: ordinary files');
  const cases = [
    { name: 'one slide', file: deck({ slides: 1 }), pages: 1, want: [1280, 720] },
    { name: 'twelve slides, wide', file: deck({ slides: 12 }), pages: 12, want: [1280, 720] },
    { name: 'four slides, 4:3, one hidden', file: deck({ slides: [{}, { hidden: true }, {}, {}], size: [9144000, 6858000] }), pages: 4, want: [1280, 960] },
    { name: 'a tall page (portrait A4)', file: deck({ slides: 2, size: [6858000, 9906000] }), pages: 2, want: [1280, 1849] },
    { name: 'a banner far taller than wide (kept under the height ceiling)', file: deck({ slides: 1, size: [914400, 51206400] }), pages: 1, want: [null, 4096] },
    { name: 'a picture on the slide', file: deck({ slides: [{ body: picture(5, 'r:embed="rId2"'), rels: `<Relationship Id="rId2" Type="${REL}/image" Target="../media/image1.png"/>` }], add: [{ name: 'ppt/media/image1.png', data: await png(64, 64) }] }), pages: 1, want: [1280, 720] },
    { name: 'narrower pictures when asked (640)', file: deck({ slides: 2 }), pages: 2, width: 640, want: [640, 360] },
  ];
  record.sections.draw = [];
  for (const c of cases) {
    const r = await draw(c.file, c.pages, c.width ? { width: c.width } : {});
    const sizes = r.pictures.map(jpegSize);
    const fits = sizes.length === c.pages && sizes.every((s) => s && (c.want[0] === null || s.width === c.want[0]) && Math.abs(s.height - c.want[1]) <= 2 && s.width <= (c.width ?? 1280));
    check('draw', c.name, outcome(r) === 'drawn' && r.count === c.pages && fits, `${outcome(r)}; ${sizes[0] ? `${sizes[0].width}x${sizes[0].height}` : 'no picture'} x${r.pictures.length}; ${r.ms} ms; peak ${r.stats?.peakBytes ? Math.round(r.stats.peakBytes / MiB) : '?'} MiB`);
    record.sections.draw.push({ name: c.name, outcome: outcome(r), ms: r.ms, stats: r.stats, sizes });
    if (OUT) r.pictures.forEach((p, i) => fs.writeFileSync(path.join(OUT, `draw-${c.name.replace(/[^a-z0-9]+/gi, '-').slice(0, 30)}-${i + 1}.jpg`), p));
  }
}

async function sectionFiles(canary) {
  heading('files: hostile and broken files (each must end in bounded time and leave the service working)');
  const good = deck({ slides: 2 });
  const refused = ['refused: archive refused'];
  const contained = ['drawn', 'killed', 'refused: could not convert', 'refused: out of time', 'refused: page count', 'refused: archive refused', 'refused: bad picture'];
  const link = (id, type, target) => `<Relationship Id="${id}" Type="${REL}/${type}" Target="${target}" TargetMode="External"/>`;
  const laughs = `<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY a "aaaaaaaaaaaaaaaaaaaa">${Array.from({ length: 9 }, (_x, i) => `<!ENTITY ${String.fromCharCode(98 + i)} "${`&${String.fromCharCode(97 + i)};`.repeat(10)}">`).join('')}]>\n<p:sld ${NS}><p:cSld><p:spTree>${EMPTY_TREE}${textBox(2, 'X').replace('X', '&j;')}</p:spTree></p:cSld></p:sld>`;
  const nest = (n) => `${'<p:grpSp><p:nvGrpSpPr><p:cNvPr id="9" name="g"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>'.repeat(n)}${textBox(3, 'deep')}${'</p:grpSp>'.repeat(n)}`;
  const cases = [
    // What is not a presentation at all.
    ['random bytes', async () => crypto.randomBytes(4096), refused],
    ['a PDF under a .pptx name', async () => Buffer.concat([Buffer.from('%PDF-1.7\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n'), Buffer.alloc(256, 0x20)]), refused],
    ['an old binary PowerPoint (.ppt) header', async () => Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), crypto.randomBytes(2048)]), refused],
    ['a web page', async () => Buffer.from(`<html><script>alert(1)</script>${' '.repeat(300)}</html>`), refused],
    ['a rich-text file', async () => Buffer.from(`{\\rtf1\\ansi{\\object\\objocx ${'41'.repeat(400)}}}`), refused],
    ['a ZIP that is a Word document', async () => zip([{ name: '[Content_Types].xml', data: Buffer.from('<Types/>') }, { name: 'word/document.xml', data: Buffer.from('<w:document/>') }]), refused],
    ['a ZIP that is an OpenDocument presentation', async () => zip([{ name: 'mimetype', data: Buffer.from('application/vnd.oasis.opendocument.presentation'), store: true }, { name: 'content.xml', data: Buffer.from('<office:document-content/>') }]), refused],
    ['an empty ZIP', async () => zip([]), refused],
    // A real presentation with an archive that tries something.
    ['half a presentation (cut off)', async () => good.subarray(0, Math.floor(good.length / 2)), refused],
    ['a presentation with bytes after its end', async () => Buffer.concat([good, crypto.randomBytes(64)]), refused],
    ['an entry that climbs out (../../../tmp/x)', async () => deck({ add: [{ name: '../../../tmp/tala-escape', data: Buffer.from('x') }] }), refused],
    ['an entry with an absolute name (/etc/cron.d/x)', async () => deck({ add: [{ name: '/etc/cron.d/tala-escape', data: Buffer.from('x') }] }), refused],
    ['an entry with a Windows path (..\\..\\x)', async () => deck({ add: [{ name: '..\\..\\tala-escape', data: Buffer.from('x') }] }), refused],
    ['an entry with a zero byte in its name', async () => deck({ add: [{ nameBytes: Buffer.from('ppt/media/a\0.png'), data: Buffer.from('x') }] }), refused],
    ['one part named twice (two readers could pick different ones)', async () => deck({ add: [{ name: 'ppt/slides/slide1.xml', data: Buffer.from('<p:sld/>') }] }), refused],
    ['an entry marked encrypted', async () => deck({ add: [{ name: 'ppt/media/secret.bin', data: Buffer.from('x'), flags: 1 }] }), refused],
    ['an entry with an unknown compression method', async () => deck({ add: [{ name: 'ppt/media/odd.bin', data: Buffer.from('x'), method: 14 }] }), refused],
    ['ZIP64 markers', async () => zip([{ name: '[Content_Types].xml', data: Buffer.from('<Types/>') }, { name: 'ppt/presentation.xml', data: Buffer.from('<p/>') }], { zip64: true }), refused],
    ['an honest zip bomb (says it unpacks to 300 MiB)', async () => deck({ add: [{ name: 'ppt/media/zeros.bin', packed: await deflatedZeros(300 * MiB, true), unpackedSays: 300 * MiB }] }), refused],
    ['a lying zip bomb (says 1 KiB, unpacks to 300 MiB)', async () => deck({ slides: [{ body: picture(5, 'r:embed="rId2"'), rels: `<Relationship Id="rId2" Type="${REL}/image" Target="../media/image1.png"/>` }], add: [{ name: 'ppt/media/image1.png', packed: await deflatedZeros(300 * MiB, true), unpackedSays: 1024 }] }), contained, 1],
    // A real presentation whose content tries something.
    ['a picture that claims 40,000 x 40,000 pixels', async () => deck({ slides: [{ body: picture(5, 'r:embed="rId2"'), rels: `<Relationship Id="rId2" Type="${REL}/image" Target="../media/image1.png"/>` }], add: [{ name: 'ppt/media/image1.png', data: await png(40000, 40000) }] }), contained, 1],
    ['entities that expand a billion times', async () => deck({ replace: { 'ppt/slides/slide1.xml': laughs } }), contained, 1],
    ['shapes nested 30,000 deep', async () => deck({ slides: [{ body: nest(30000) }] }), contained, 1],
    ['a slide that is cut off in the middle', async () => deck({ slides: 2, replace: { 'ppt/slides/slide2.xml': `${XML}<p:sld ${NS}><p:cSld><p:spTree>${EMPTY_TREE}<p:sp><p:nvSpPr>` } }), contained, 2],
    ['no slide master and no theme', async () => deck({ slides: 2, replace: { 'ppt/slideMasters/slideMaster1.xml': null, 'ppt/theme/theme1.xml': null } }), contained, 2],
    [
      'pictures, sound and objects linked to the network and to files of the host',
      async () =>
        deck({
          slides: [
            {
              body: `${picture(5, 'r:link="rId2"')}${picture(6, 'r:link="rId3"', 3200000)}${picture(7, 'r:link="rId4"', 5800000)}${oleObject(8, 'rId5', '<p:link updateAutomatic="1"/>')}<p:sp><p:nvSpPr><p:cNvPr id="10" name="click"><a:hlinkClick r:id="rId6"/></p:cNvPr><p:cNvSpPr/><p:nvPr><a:audioFile r:link="rId7"/></p:nvPr></p:nvSpPr><p:spPr/></p:sp>`,
              rels: [link('rId2', 'image', `http://127.0.0.1:${canary.port}/picture.png`), link('rId3', 'image', 'file:///etc/passwd'), link('rId4', 'image', `file://${canary.file}`), link('rId5', 'oleObject', 'file:///var/lib/tala/tala.db'), link('rId6', 'hyperlink', `http://127.0.0.1:${canary.port}/click`), link('rId7', 'audio', `http://127.0.0.1:${canary.port}/sound.wav`)].join(''),
            },
          ],
        }),
      contained,
      1,
    ],
    ['a macro-enabled presentation with a macro project', async () => deck({ mainType: 'application/vnd.ms-powerpoint.presentation.macroEnabled.main+xml', add: [{ name: 'ppt/vbaProject.bin', data: Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), crypto.randomBytes(4096)]) }] }), contained, 1],
    ['an embedded object of unknown kind', async () => deck({ slides: [{ body: oleObject(8, 'rId2', '<p:embed/>'), rels: `<Relationship Id="rId2" Type="${REL}/oleObject" Target="../embeddings/oleObject1.bin"/>` }], add: [{ name: 'ppt/embeddings/oleObject1.bin', data: Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), crypto.randomBytes(8192)]) }] }), contained, 1],
    ['a slide size the format does not allow (1 x 1)', async () => deck({ size: [1, 1] }), contained, 1],
    ['fewer slides than the web app said (2 in the file, 5 asked)', async () => good, ['refused: page count'], 5],
    ['more slides than the web app said (2 in the file, 1 asked)', async () => good, ['refused: page count'], 1],
  ];
  record.sections.files = [];
  for (const [name, build, accept, pages = 1] of cases) {
    const file = await build();
    const before = canary.hits();
    const r = await draw(file, pages);
    const o = outcome(r);
    const back = await ready();
    const quiet = canary.hits() === before;
    check('files', name, accept.includes(o) && r.ms < 130_000 && back.ok && quiet, `${o} in ${r.ms} ms; service back after ${back.ms} ms${quiet ? '' : '; THE CANARY WAS REACHED'}`);
    record.sections.files.push({ name, bytes: file.length, outcome: o, ms: r.ms, backMs: back.ms, backOk: back.ok, canaryReached: !quiet, stats: r.stats });
  }
  check('files', 'nothing asked the canary on this host for anything, all section long', canary.hits() === 0, `${canary.hits()} request(s)`);
}

async function sectionProtocol() {
  heading('protocol: a caller that does not keep to the rules');
  const good = deck({ slides: 1 });
  record.sections.protocol = [];
  const run = async (name, opts, accept, extra = '') => {
    let r = await ask(opts);
    for (let i = 0; outcome(r) === 'turned away' && i < 100; i++) {
      await sleep(150);
      r = await ask(opts);
    }
    const back = await ready(REQUEST_SEC * 1000 + 30_000);
    check('protocol', name, accept.includes(outcome(r)) && back.ok, `${outcome(r)} in ${r.ms} ms; service back after ${back.ms} ms${extra}`);
    record.sections.protocol.push({ name, outcome: outcome(r), ms: r.ms, backMs: back.ms });
  };
  const bad = ['refused: bad request'];
  await run('not a request at all (an HTTP line)', { send: Buffer.from('GET / HTTP/1.1\r\nHost: x\r\n\r\n') }, bad);
  await run('an unknown operation', { send: Buffer.concat([header(9, 1280, 1, good.length), good]) }, bad);
  await run('a width the service does not draw (60,000)', { file: good, pages: 1, width: 60000 }, bad);
  await run('no slides asked for', { file: good, pages: 0 }, bad);
  await run('more slides than a deck may have (401)', { file: good, pages: 401 }, bad);
  await run('a probe that brings a file', { send: Buffer.concat([header(2, 0, 0, good.length), good]) }, bad);
  await run('a file announced as 4 GiB', { send: header(1, 1280, 1, 0xffffffff) }, ['refused: file too large']);
  await run('a file announced as 80 MiB (over the ceiling), nothing sent', { send: header(1, 1280, 1, 80 * MiB) }, ['refused: file too large']);
  await run('hangs up in the middle of the file', { send: Buffer.concat([header(1, 1280, 1, good.length), good.subarray(0, 100)]), hold: 300 }, bad);
  if (SLOW || REQUEST_SEC <= 5) {
    await run(`connects and says nothing (the job gives up after ${REQUEST_SEC} s)`, { send: Buffer.alloc(0), hold: REQUEST_SEC * 1000 + 8000, timeoutMs: REQUEST_SEC * 1000 + 20_000 }, bad);
    await run(`sends half a file and waits (the job gives up after ${REQUEST_SEC} s)`, { send: Buffer.concat([header(1, 1280, 1, good.length), good.subarray(0, 100)]), hold: REQUEST_SEC * 1000 + 8000, timeoutMs: REQUEST_SEC * 1000 + 20_000 }, bad);
  } else note('skipped without --slow: a caller that connects and says nothing (the job gives up after 20 s)');
}

async function sectionTurns() {
  heading('turns: one job at a time, and nobody gets another\'s pictures');
  const decks = [3, 4, 5, 6, 7, 8].map((n) => ({ n, file: deck({ slides: n, size: [12192000, 6858000 + n * 200000], label: `Teacher ${n}` }) }));
  // All at once.
  const first = await Promise.all(decks.map((d) => ask({ file: d.file, pages: d.n })));
  const served = first.filter((r) => outcome(r) === 'drawn').length;
  const turnedAway = first.filter((r) => outcome(r) === 'turned away').length;
  check('turns', 'six files at the same moment: exactly one is drawn, the others are turned away at once', served === 1 && turnedAway === decks.length - 1, first.map(outcome).join(', '));
  check('turns', 'being turned away is quick (the web app says "busy" and the editor tries again)', first.filter((r) => outcome(r) === 'turned away').every((r) => r.ms < 2000), `${Math.max(0, ...first.filter((r) => outcome(r) === 'turned away').map((r) => r.ms))} ms at most`);
  // Everybody again, each waiting their turn, started together.
  const again = await Promise.all(decks.map((d) => draw(d.file, d.n)));
  const own = again.every((r, i) => outcome(r) === 'drawn' && r.pictures.length === decks[i].n && r.pictures.every((p) => Math.abs((jpegSize(p)?.height ?? 0) - Math.round((1280 * (6858000 + decks[i].n * 200000)) / 12192000)) <= 2));
  check('turns', 'all six, each waiting its turn: every teacher gets her own slide count and her own slide shape', own, again.map((r, i) => `${decks[i].n}:${r.pictures.length}x${jpegSize(r.pictures[0] ?? Buffer.alloc(0))?.height ?? '?'}`).join(' '));
  const back = await ready();
  check('turns', 'every job started with an empty scratch space', again.every((r) => r.report?.scratchEntries === 0) && back.report?.scratchEntries === 0, `scratch entries seen at the start of each job: ${again.map((r) => r.report?.scratchEntries).join(',')}`);
  record.sections.turns = { first: first.map(outcome), again: again.map((r) => ({ outcome: outcome(r), pictures: r.pictures.length, ms: r.ms })) };
}

/* ---- the box, from the inside ---- */

function inBox(mode, { set = [], args = [] } = {}) {
  const program = USER ? '/opt/tala-render/hostile.py' : '/opt/tala-render-verify/hostile.py';
  const argv = [
    path.join(here, 'sandbox-run.mjs'),
    ...(USER ? ['--user', ...(options.sofficeDir ? ['--soffice-dir', options.sofficeDir] : []), ...(options.fontsDir ? ['--fonts-dir', options.fontsDir] : []), ...(options.userland ? ['--userland', options.userland] : [])] : ['--bind', `${here}:/opt/tala-render-verify`]),
    ...set.flatMap((s) => ['--set', s]),
    '--quiet', '--', '/usr/bin/python3', program, mode, ...args,
  ];
  const started = Date.now();
  const run = spawnSync(process.execPath, argv, { encoding: 'utf8', maxBuffer: 256 * MiB, timeout: 400_000 });
  const lines = [];
  for (const line of (run.stdout ?? '').split('\n')) {
    try {
      if (line.trim().startsWith('{')) lines.push(JSON.parse(line));
    } catch {
      /* not one of ours */
    }
  }
  const summary = lines.findLast((l) => 'result' in l) ?? { result: 'unknown' };
  return { lines: lines.filter((l) => !('result' in l)), summary, ms: Date.now() - started, stderr: (run.stderr ?? '').slice(0, 2000) };
}
const unitNumber = (key) => {
  const raw = serviceLines(USER ? PRODUCTION_UNIT : fs.existsSync('/etc/systemd/system/tala-render@.service') ? '/etc/systemd/system/tala-render@.service' : PRODUCTION_UNIT).find((l) => l.startsWith(`${key}=`))?.slice(key.length + 1) ?? '';
  const m = raw.match(/^(\d+)([KMG]?)$/);
  return m ? Number(m[1]) * { '': 1, K: 1024, M: MiB, G: 1024 * MiB }[m[2]] : NaN;
};

async function sectionBox(canary) {
  heading('box: a hostile program in the job\'s own box (as if LibreOffice had been taken over)');
  record.sections.box = {};
  const survey = inBox('survey', { args: ['--canary', canary.file, '--tcp', `127.0.0.1:${canary.port}`, '--unix', canary.socket, '--unix', SOCKET, '--pid', String(process.pid)] });
  record.sections.box.survey = survey;
  const L = survey.lines;
  check('box', 'the hostile program ran in the box', survey.summary.result === 'success' && L.some((l) => l.kind === 'end'), `${survey.summary.result}${survey.stderr ? `; ${survey.stderr.split('\n')[0]}` : ''}`);
  if (!L.some((l) => l.kind === 'end')) return;
  const self = L.find((l) => l.kind === 'self') ?? {};
  const got = (kind) => L.filter((l) => l.kind === kind && l.allowed).map((l) => l.what);
  const tried = (kind) => L.filter((l) => l.kind === kind).length;
  const verdict = (kind, name) => check('box', name, tried(kind) > 0 && got(kind).length === 0, got(kind).length ? `ALLOWED: ${got(kind).join('; ')}` : `${tried(kind)} attempts, all stopped`);
  note(`it runs as uid ${self.uid}; its root holds: ${self.root?.join(' ')}; /etc holds: ${self.etc?.join(' ')}`);
  verdict('read', 'cannot read the database, the settings, home folders, system files, disks or the canary file of this host');
  verdict('read-other-process', 'cannot read the memory, environment or files of the tester\'s own process');
  verdict('write', 'cannot write anywhere outside its scratch space');
  check('box', 'can write in its scratch space (and only there), which was empty', got('write-scratch').length === 1 && Array.isArray(self.scratch) && self.scratch.length === 0, `scratch held: ${JSON.stringify(self.scratch)}`);
  verdict('raise-own-ceiling', 'cannot raise its own memory or process ceiling');
  verdict('leave-own-group', 'cannot move itself out from under its ceilings');
  verdict('run-from-scratch', 'cannot run a program it brought with it');
  check('box', 'cannot reach the network: no address, no name, no raw packet, not even this host\'s own ports', tried('network') > 0 && got('network').length === 0 && canary.hits() === 0, got('network').length ? `ALLOWED: ${got('network').join('; ')}` : `${tried('network')} attempts, all stopped; canary untouched`);
  verdict('unix-socket', 'cannot open any socket of the host (system bus, service manager, journal, the drawing door itself, the tester\'s)');
  verdict('privilege', 'cannot become root, change its root, mount, make namespaces or devices, trace or signal the first process, or lift a limit');
  verdict('setuid-program', 'privileged programs of the host give it nothing (sudo, su, mount, ping)');
  const info = L.filter((l) => l.kind === 'kernel-info');
  const sight = L.find((l) => l.kind === 'processes-in-sight')?.count;
  if (USER) {
    note(`developer set-up, as expected: it sees ${sight} processes and may signal the developer's own (${got('other-process').length ? 'allowed' : 'stopped'}). On a server the job is a user of its own.`);
    note(`kernel information it can read here: ${info.filter((l) => l.allowed).map((l) => l.what).join(', ') || 'none'}`);
  } else {
    check('box', 'sees no process but its own', typeof sight === 'number' && sight <= 3 && !info.find((l) => l.what === '/proc/1/cmdline')?.allowed, `${sight} in sight`);
    verdict('other-process', 'cannot signal the tester\'s process');
    check('box', 'of the kernel\'s own information it sees no host name, no memory table and no other service\'s group', !info.some((l) => l.allowed && ['/proc/sys/kernel/hostname', '/proc/meminfo', '/proc/kallsyms'].includes(l.what)), `readable: ${info.filter((l) => l.allowed).map((l) => l.what).join(', ') || 'none'}`);
  }
  check('box', 'its environment holds nothing but the job\'s own settings', (self.environment ?? []).every((n) => /^(PATH|LANG|HOME|USER|LOGNAME|SHELL|INVOCATION_ID|MANAGERPID|TALA_RENDER_\w+|SYSTEMD_\w+|JOURNAL_\w+|MEMORY_PRESSURE_\w+|LISTEN_\w+)$/.test(n)), (self.environment ?? []).join(' '));

  // Ceilings: each is hit for real.
  const memory = inBox('memory');
  const lastMib = Math.max(0, ...memory.lines.filter((l) => l.kind === 'memory').map((l) => l.mib));
  const memoryMax = unitNumber('MemoryMax');
  check('box', 'memory: the kernel kills the job at its ceiling', memory.summary.result === 'oom-kill' && lastMib > 0 && lastMib * MiB <= memoryMax, `${memory.summary.result} after ${lastMib} MiB of ${Math.round(memoryMax / MiB)} MiB`);
  const procs = inBox('processes');
  const p = procs.lines.findLast((l) => l.kind === 'processes') ?? {};
  check('box', 'processes: no more than the ceiling can be started', p.stopped_by === 'EAGAIN' && p.started < unitNumber('TasksMax'), `stopped by ${p.stopped_by} after ${p.started} of ${unitNumber('TasksMax')}`);
  const storm = inBox('storm');
  check('box', 'a real fork bomb ends with the job and takes nothing else down', ['success', 'signal', 'exit-code', 'oom-kill'].includes(storm.summary.result) && storm.ms < 30_000, `${storm.summary.result} in ${storm.ms} ms`);
  const disk = inBox('disk');
  const fills = disk.lines.filter((l) => l.kind === 'disk');
  const files = disk.lines.find((l) => l.kind === 'disk-files') ?? {};
  check('box', 'disk: only the scratch space fills, and it is full at its size', fills.length === 1 && fills[0].stopped_by === 'ENOSPC' && fills[0].mib <= 400, fills.map((f) => `${f.place}: ${f.mib} MiB then ${f.stopped_by}`).join('; '));
  check('box', 'disk: the number of files is bounded too', files.stopped_by === 'ENOSPC' && files.files <= 8192, `${files.files} files then ${files.stopped_by}`);
  const big = inBox('bigfile').lines.find((l) => l.kind === 'bigfile') ?? {};
  check('box', 'one file cannot grow past the file-size ceiling', big.stopped_by === 'EFBIG' && big.mib * MiB <= unitNumber('LimitFSIZE'), `${big.mib} MiB then ${big.stopped_by}`);
  const fds = inBox('files').lines.find((l) => l.kind === 'files') ?? {};
  check('box', 'open files are bounded', fds.stopped_by === 'EMFILE' && fds.opened <= unitNumber('LimitNOFILE'), `${fds.opened} then ${fds.stopped_by}`);
  const cpu = inBox('cpu', { set: ['LimitCPU=3'] });
  check('box', 'processor time: a job that spins is killed by the kernel (ceiling set to 3 s for the test)', cpu.summary.result === 'signal' && cpu.ms < 20_000, `${cpu.summary.result} ${cpu.summary.signal}; cpu ${cpu.summary.cpu}; ${cpu.ms} ms`);
  const wait = inBox('sleep', { set: ['RuntimeMaxSec=4'] });
  check('box', 'run time: a job that never ends is killed by systemd (ceiling set to 4 s for the test)', wait.summary.result === 'timeout' && wait.ms < 20_000, `${wait.summary.result} after ${wait.ms} ms`);
  if (SLOW) {
    const cpuReal = inBox('cpu');
    check('box', `processor time at the installed ceiling (${unitNumber('LimitCPU')} s)`, ['signal', 'timeout'].includes(cpuReal.summary.result) && cpuReal.ms < (unitNumber('RuntimeMaxSec') + 20) * 1000, `${cpuReal.summary.result} ${cpuReal.summary.signal ?? ''}; cpu ${cpuReal.summary.cpu}; ${cpuReal.ms} ms`);
    const waitReal = inBox('sleep');
    check('box', `run time at the installed ceiling (${unitNumber('RuntimeMaxSec')} s)`, waitReal.summary.result === 'timeout' && Math.abs(waitReal.ms / 1000 - unitNumber('RuntimeMaxSec')) < 15, `${waitReal.summary.result} after ${Math.round(waitReal.ms / 1000)} s`);
  } else note('skipped without --slow: processor time and run time at the installed ceilings (about four minutes)');

  // Nothing outlives a job.
  const orphans = inBox('orphans').lines.find((l) => l.kind === 'orphans') ?? { pids: [] };
  await sleep(1500);
  const alive = orphans.pids.filter((pid) => fs.existsSync(`/proc/${pid}`));
  check('box', 'processes that leave the job\'s session and ignore signals are gone when the job ends', orphans.pids.length === 4 && alive.length === 0, `started ${orphans.pids.length}, alive afterwards: ${alive.length}`);
  const after = inBox('survey').lines.find((l) => l.kind === 'self') ?? {};
  check('box', 'files a job left behind are not there for the next job', Array.isArray(after.scratch) && after.scratch.length === 0, `left in: ${orphans.files_left_in?.join(',')}; next job's scratch: ${JSON.stringify(after.scratch)}`);
  const strays = ['/dev/shm', '/tmp', '/var/tmp', '/run'].filter((d) => fs.existsSync(path.join(d, 'left-behind')) || (fs.existsSync(d) && fs.readdirSync(d).some((n) => /^(fill-\d+|\.hostile-\d+)$/.test(n))));
  check('box', 'and nothing of them is on the host', strays.length === 0, strays.join(',') || 'checked /dev/shm, /tmp, /var/tmp, /run');
  record.sections.box.ceilings = { memory: memory.summary, lastMib, processes: p, storm: storm.summary, disk: fills, files, big, fds, cpu: cpu.summary, wait: wait.summary, orphans };
  const back = await ready();
  check('box', 'after all of that the service draws as before', back.ok, `answered after ${back.ms} ms`);
}

/* ------------------------------------------------------------------ run ------------------------------------------------------------------ */

/** Things on THIS host that a job must never reach: a file, a TCP port on loopback and a socket file. */
async function canaries() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tala-render-canary-'));
  fs.chmodSync(dir, 0o755);
  const file = path.join(dir, 'canary.txt');
  fs.writeFileSync(file, `tala canary ${crypto.randomBytes(8).toString('hex')}\n`, { mode: 0o644 });
  let hits = 0;
  const count = (sock) => {
    hits += 1;
    sock.on('error', () => undefined);
    sock.end('HTTP/1.0 200 OK\r\nContent-Length: 0\r\n\r\n');
  };
  const tcp = net.createServer(count);
  await new Promise((resolve) => tcp.listen(0, '127.0.0.1', resolve));
  const socket = path.join(dir, 'canary.sock');
  const unix = net.createServer(count);
  await new Promise((resolve) => unix.listen(socket, resolve));
  fs.chmodSync(socket, 0o666);
  return {
    file, socket, port: tcp.address().port, hits: () => hits,
    close: async () => {
      await Promise.all([new Promise((r) => tcp.close(r)), new Promise((r) => unix.close(r))]);
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

console.log(`Tala drawing service check, ${record.mode}, socket ${SOCKET}, ${record.started}`);
const canary = await canaries();
try {
  if (wanted('probe')) await sectionProbe();
  if (wanted('draw')) await sectionDraw();
  if (wanted('files')) await sectionFiles(canary);
  if (wanted('protocol')) await sectionProtocol();
  if (wanted('turns')) await sectionTurns();
  if (wanted('box')) await sectionBox(canary);
  check('all', 'the canary on this host was never reached by anything', canary.hits() === 0, `${canary.hits()} request(s)`);
} finally {
  await canary.close();
}
const failed = checks.filter((c) => !c.ok);
record.finished = new Date().toISOString();
record.checks = checks;
record.passed = checks.length - failed.length;
record.failed = failed.length;
if (OUT) fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(record, null, 1));
console.log(`\n${checks.length - failed.length} of ${checks.length} checks passed${failed.length ? `; FAILED: ${failed.map((c) => `${c.section}: ${c.name}`).join(' | ')}` : ''}`);
process.exit(failed.length ? 1 : 0);
