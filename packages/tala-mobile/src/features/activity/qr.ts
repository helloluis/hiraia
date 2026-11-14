/**
 * QR code generation with no native dependency: a compact TypeScript port of the QR Code generator
 * library by Project Nayuki (https://www.nayuki.io/page/qr-code-generator-library, MIT License,
 * Copyright © Project Nayuki), byte mode only, plus a tiny PNG writer so the symbol can be shown
 * through <Image source={{uri: 'data:image/png;base64,…'}}> without react-native-svg.
 *
 * Tala 0.4.4 renders the same text with zxing at EC level H and a glyph badge; the student parses the
 * TEXT, so any correct symbol of the same payload is wire-compatible. Level M is used here: a
 * ~550-byte payload fits version 18–19 (89–93 modules) instead of 24+ at H, which scans better on
 * cheap cameras, and there is no badge to protect.
 */

export type EcLevel = 'L' | 'M' | 'Q' | 'H';
const EC_FORMAT_BITS: Record<EcLevel, number> = { L: 1, M: 0, Q: 3, H: 2 };
const EC_INDEX: Record<EcLevel, number> = { L: 0, M: 1, Q: 2, H: 3 };

// Tables indexed [ecLevel][version]; version 0 is a placeholder.
const ECC_CODEWORDS_PER_BLOCK = [
  [
    -1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30,
    30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30,
  ],
  [
    -1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28,
    28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28,
  ],
  [
    -1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30,
    30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30,
  ],
  [
    -1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30,
    30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30,
  ],
];
const NUM_ERROR_CORRECTION_BLOCKS = [
  [
    -1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14,
    15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25,
  ],
  [
    -1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23,
    25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49,
  ],
  [
    -1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34,
    34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68,
  ],
  [
    -1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35,
    37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81,
  ],
];

function numRawDataModules(version: number): number {
  let result = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const numAlign = Math.floor(version / 7) + 2;
    result -= (25 * numAlign - 10) * numAlign - 55;
    if (version >= 7) result -= 36;
  }
  return result;
}

function numDataCodewords(version: number, ec: EcLevel): number {
  return (
    Math.floor(numRawDataModules(version) / 8) -
    ECC_CODEWORDS_PER_BLOCK[EC_INDEX[ec]]![version]! *
      NUM_ERROR_CORRECTION_BLOCKS[EC_INDEX[ec]]![version]!
  );
}

function rsDivisor(degree: number): number[] {
  const result = new Array<number>(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < result.length; j++) {
      result[j] = rsMultiply(result[j]!, root);
      if (j + 1 < result.length) result[j]! ^= result[j + 1]!;
    }
    root = rsMultiply(root, 0x02);
  }
  return result;
}

function rsRemainder(data: number[], divisor: number[]): number[] {
  const result = divisor.map(() => 0);
  for (const b of data) {
    const factor = b ^ result.shift()!;
    result.push(0);
    divisor.forEach((coef, i) => (result[i]! ^= rsMultiply(coef, factor)));
  }
  return result;
}

function rsMultiply(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
}

export type QrSymbol = { size: number; modules: boolean[][] };

/** Encode UTF-8 bytes of `text` in byte mode at the smallest version that fits. */
export function encodeQr(text: string, ec: EcLevel = 'M'): QrSymbol {
  const data = new TextEncoder().encode(text);
  let version = 1;
  for (;;) {
    const capacityBits = numDataCodewords(version, ec) * 8;
    const needed = 4 + (version <= 9 ? 8 : 16) + data.length * 8;
    if (needed <= capacityBits) break;
    if (version >= 40) throw new Error('Data too long for a QR code');
    version++;
  }
  // Bit stream: mode 0100, count, bytes, terminator, pad.
  const bits: number[] = [];
  const push = (value: number, length: number) => {
    for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  push(4, 4);
  push(data.length, version <= 9 ? 8 : 16);
  for (const b of data) push(b, 8);
  const capacity = numDataCodewords(version, ec) * 8;
  push(0, Math.min(4, capacity - bits.length));
  push(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < capacity; pad ^= 0xec ^ 0x11) push(pad, 8);
  const codewords: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let b = 0;
    for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j]!;
    codewords.push(b);
  }
  // Error correction, interleaved.
  const numBlocks = NUM_ERROR_CORRECTION_BLOCKS[EC_INDEX[ec]]![version]!;
  const blockEccLen = ECC_CODEWORDS_PER_BLOCK[EC_INDEX[ec]]![version]!;
  const rawCodewords = Math.floor(numRawDataModules(version) / 8);
  const numShortBlocks = numBlocks - (rawCodewords % numBlocks);
  const shortBlockLen = Math.floor(rawCodewords / numBlocks);
  const blocks: number[][] = [];
  const divisor = rsDivisor(blockEccLen);
  for (let i = 0, k = 0; i < numBlocks; i++) {
    const datLen = shortBlockLen - blockEccLen + (i < numShortBlocks ? 0 : 1);
    const dat = codewords.slice(k, k + datLen);
    k += datLen;
    const ecc = rsRemainder(dat, divisor);
    if (i < numShortBlocks) dat.push(0);
    blocks.push(dat.concat(ecc));
  }
  const all: number[] = [];
  for (let i = 0; i < blocks[0]!.length; i++)
    blocks.forEach((block, j) => {
      if (i !== shortBlockLen - blockEccLen || j >= numShortBlocks) all.push(block[i]!);
    });

  // Modules.
  const size = version * 4 + 17;
  const modules: boolean[][] = Array.from({ length: size }, () =>
    new Array<boolean>(size).fill(false)
  );
  const isFunction: boolean[][] = Array.from({ length: size }, () =>
    new Array<boolean>(size).fill(false)
  );
  const set = (x: number, y: number, dark: boolean) => {
    modules[y]![x] = dark;
    isFunction[y]![x] = true;
  };
  const drawFinder = (x: number, y: number) => {
    for (let dy = -4; dy <= 4; dy++)
      for (let dx = -4; dx <= 4; dx++) {
        const dist = Math.max(Math.abs(dx), Math.abs(dy));
        const xx = x + dx,
          yy = y + dy;
        if (xx >= 0 && xx < size && yy >= 0 && yy < size) set(xx, yy, dist !== 2 && dist !== 4);
      }
  };
  const drawAlign = (x: number, y: number) => {
    for (let dy = -2; dy <= 2; dy++)
      for (let dx = -2; dx <= 2; dx++)
        set(x + dx, y + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  };
  const drawFormat = (mask: number) => {
    const data = (EC_FORMAT_BITS[ec] << 3) | mask;
    let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const bitsValue = ((data << 10) | rem) ^ 0x5412;
    const bit = (i: number) => ((bitsValue >>> i) & 1) !== 0;
    for (let i = 0; i <= 5; i++) set(8, i, bit(i));
    set(8, 7, bit(6));
    set(8, 8, bit(7));
    set(7, 8, bit(8));
    for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i));
    set(8, size - 8, true);
  };
  const drawVersion = () => {
    if (version < 7) return;
    let rem = version;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bitsValue = (version << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const bit = ((bitsValue >>> i) & 1) !== 0;
      const a = size - 11 + (i % 3),
        b = Math.floor(i / 3);
      set(a, b, bit);
      set(b, a, bit);
    }
  };
  const alignPositions = (): number[] => {
    if (version === 1) return [];
    const numAlign = Math.floor(version / 7) + 2;
    const step = version === 32 ? 26 : Math.ceil((version * 4 + 4) / (numAlign * 2 - 2)) * 2;
    const result = [6];
    for (let pos = size - 7; result.length < numAlign; pos -= step) result.splice(1, 0, pos);
    return result;
  };
  // Function patterns.
  for (let i = 0; i < size; i++) {
    set(6, i, i % 2 === 0);
    set(i, 6, i % 2 === 0);
  }
  drawFinder(3, 3);
  drawFinder(size - 4, 3);
  drawFinder(3, size - 4);
  const aligns = alignPositions();
  for (let i = 0; i < aligns.length; i++)
    for (let j = 0; j < aligns.length; j++)
      if (
        !(
          (i === 0 && j === 0) ||
          (i === 0 && j === aligns.length - 1) ||
          (i === aligns.length - 1 && j === 0)
        )
      )
        drawAlign(aligns[i]!, aligns[j]!);
  drawFormat(0);
  drawVersion();
  // Data placement.
  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++)
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (!isFunction[y]![x] && i < all.length * 8) {
          modules[y]![x] = ((all[i >>> 3]! >>> (7 - (i & 7))) & 1) !== 0;
          i++;
        }
      }
  }
  // Masking: pick the lowest penalty.
  const maskBit = (mask: number, x: number, y: number) => {
    switch (mask) {
      case 0:
        return (x + y) % 2 === 0;
      case 1:
        return y % 2 === 0;
      case 2:
        return x % 3 === 0;
      case 3:
        return (x + y) % 3 === 0;
      case 4:
        return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
      case 5:
        return ((x * y) % 2) + ((x * y) % 3) === 0;
      case 6:
        return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
      default:
        return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
    }
  };
  const applyMask = (mask: number) => {
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++)
        if (!isFunction[y]![x] && maskBit(mask, x, y)) modules[y]![x] = !modules[y]![x];
  };
  const penalty = (): number => {
    let result = 0;
    const runPenalty = (history: number[]) => {
      const n = history[1]!;
      let core =
        n > 0 && history[2] === n && history[3] === n * 3 && history[4] === n && history[5] === n;
      let score = core && history[0]! >= 4 * n && history[6]! >= n ? 1 : 0;
      core = core && history[6]! >= 4 * n && history[0]! >= n;
      return score + (core ? 1 : 0);
    };
    const line = (get: (i: number) => boolean) => {
      let run = 0,
        color = false;
      const history = [0, 0, 0, 0, 0, 0, 0];
      const addRun = (len: number) => {
        history.pop();
        history.unshift(len);
      };
      for (let k = 0; k < size; k++) {
        if (get(k) === color) {
          run++;
          if (run === 5) result += 3;
          else if (run > 5) result += 1;
        } else {
          addRun(run);
          if (!color) result += runPenalty(history) * 40;
          color = get(k);
          run = 1;
        }
      }
      addRun(run + (color ? 0 : size));
      if (color) addRun(size);
      result += runPenalty(history) * 40;
    };
    for (let y = 0; y < size; y++) line((x) => modules[y]![x]!);
    for (let x = 0; x < size; x++) line((y) => modules[y]![x]!);
    let dark = 0;
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        if (modules[y]![x]) dark++;
        if (
          x < size - 1 &&
          y < size - 1 &&
          modules[y]![x] === modules[y]![x + 1] &&
          modules[y]![x] === modules[y + 1]![x] &&
          modules[y]![x] === modules[y + 1]![x + 1]
        )
          result += 3;
      }
    const total = size * size;
    const k = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1;
    return result + k * 10;
  };
  let best = 0,
    bestPenalty = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    applyMask(mask);
    drawFormat(mask);
    const p = penalty();
    if (p < bestPenalty) {
      bestPenalty = p;
      best = mask;
    }
    applyMask(mask);
  }
  applyMask(best);
  drawFormat(best);
  return { size, modules };
}

// ---- PNG (stored deflate, no compression library needed) ----

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function u32(n: number): Uint8Array {
  return new Uint8Array([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type);
  const body = new Uint8Array(typeBytes.length + data.length);
  body.set(typeBytes);
  body.set(data, typeBytes.length);
  const out = new Uint8Array(4 + body.length + 4);
  out.set(u32(data.length));
  out.set(body, 4);
  out.set(u32(crc32(body)), 4 + body.length);
  return out;
}

/** zlib stream with stored (uncompressed) deflate blocks. */
function zlibStored(data: Uint8Array): Uint8Array {
  const blocks: Uint8Array[] = [new Uint8Array([0x78, 0x01])];
  for (let offset = 0; offset < data.length || offset === 0; offset += 65535) {
    const len = Math.min(65535, data.length - offset);
    const last = offset + len >= data.length;
    const header = new Uint8Array([
      last ? 1 : 0,
      len & 255,
      len >>> 8,
      ~len & 255,
      (~len >>> 8) & 255,
    ]);
    blocks.push(header, data.slice(offset, offset + len));
    if (last) break;
  }
  let a = 1,
    b = 0;
  for (const d of data) {
    a = (a + d) % 65521;
    b = (b + a) % 65521;
  }
  blocks.push(u32(((b << 16) | a) >>> 0));
  const total = blocks.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of blocks) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function toBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/**
 * A 1-bit greyscale PNG of the symbol, `scale` pixels per module with a `margin`-module quiet zone
 * (the standard asks for 4), as a data URI. For an 89-module symbol at scale 4 this is ~390 px and
 * well under 20 KB uncompressed.
 */
export function qrPngDataUri(symbol: QrSymbol, scale = 4, margin = 4): string {
  const px = (symbol.size + margin * 2) * scale;
  const rowBytes = Math.ceil(px / 8);
  const raw = new Uint8Array((rowBytes + 1) * px);
  for (let y = 0; y < px; y++) {
    const row = y * (rowBytes + 1);
    raw[row] = 0; // filter: none
    const my = Math.floor(y / scale) - margin;
    for (let x = 0; x < px; x++) {
      const mx = Math.floor(x / scale) - margin;
      const dark =
        my >= 0 && my < symbol.size && mx >= 0 && mx < symbol.size && symbol.modules[my]![mx]!;
      if (!dark) raw[row + 1 + (x >> 3)]! |= 0x80 >> (x & 7); // 1 = white in 1-bit grey
    }
  }
  const ihdr = new Uint8Array(13);
  ihdr.set(u32(px), 0);
  ihdr.set(u32(px), 4);
  ihdr.set([1, 0, 0, 0, 0], 8); // bit depth 1, greyscale
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlibStored(raw)),
    chunk('IEND', new Uint8Array()),
  ];
  const total = parts.reduce((n, p) => n + p.length, 0);
  const png = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    png.set(p, o);
    o += p.length;
  }
  return `data:image/png;base64,${toBase64(png)}`;
}
