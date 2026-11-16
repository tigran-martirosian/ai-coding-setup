// A small QR Code encoder for the local pairing page: text in, an inline SVG out (the page's content policy loads
// nothing from outside). Error correction level M, versions 1 to 9 (up to 262 alphanumeric characters or 180
// bytes), alphanumeric mode when the text allows it (a pairing code does), else UTF-8 bytes. The structure and the
// tables follow Project Nayuki's QR Code generator library (MIT License, Copyright (c) Project Nayuki,
// https://www.nayuki.io/page/qr-code-generator-library), cut down to what this page needs.
//   qrSvg(text, { scale })  -> "<svg ...>" with a 4-module quiet zone; throws when the text is too long

const MAX_VERSION = 9; // the character count field keeps one length up to here
// Level M, per version (index 0 unused): error correction codewords per block, and the number of blocks.
const ECC_PER_BLOCK = [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22];
const BLOCKS = [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5];
const FORMAT_M = 0; // level M's two format bits
const ALNUM = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:";

// ---- the data bits

function segment(text) {
  const bits = [];
  const put = (value, len) => {
    for (let i = len - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  if ([...text].every((c) => ALNUM.includes(c))) {
    for (let i = 0; i + 1 < text.length; i += 2)
      put(ALNUM.indexOf(text[i]) * 45 + ALNUM.indexOf(text[i + 1]), 11);
    if (text.length % 2) put(ALNUM.indexOf(text.at(-1)), 6);
    return { mode: 0x2, count: text.length, countBits: 9, bits };
  }
  const bytes = new TextEncoder().encode(text);
  for (const b of bytes) put(b, 8);
  return { mode: 0x4, count: bytes.length, countBits: 8, bits };
}

function rawModules(ver) {
  let n = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const align = Math.floor(ver / 7) + 2;
    n -= (25 * align - 10) * align - 55;
    if (ver >= 7) n -= 36;
  }
  return n;
}

const dataCodewords = (ver) =>
  Math.floor(rawModules(ver) / 8) - ECC_PER_BLOCK[ver] * BLOCKS[ver];

// The smallest version that holds the text, and its data codewords with the padding.
function encodeData(text) {
  const seg = segment(text);
  for (let ver = 1; ver <= MAX_VERSION; ver++) {
    const capacity = dataCodewords(ver) * 8;
    const used = 4 + seg.countBits + seg.bits.length;
    if (used > capacity) continue;
    const bits = [];
    const put = (value, len) => {
      for (let i = len - 1; i >= 0; i--) bits.push((value >>> i) & 1);
    };
    put(seg.mode, 4);
    put(seg.count, seg.countBits);
    bits.push(...seg.bits);
    put(0, Math.min(4, capacity - bits.length));
    put(0, (8 - (bits.length % 8)) % 8);
    for (let pad = 0xec; bits.length < capacity; pad ^= 0xec ^ 0x11)
      put(pad, 8);
    const bytes = [];
    for (let i = 0; i < bits.length; i += 8)
      bytes.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
    return { ver, bytes };
  }
  throw new Error(
    `qr: ${text.length} characters do not fit a version ${MAX_VERSION} code`,
  );
}

// ---- Reed-Solomon over GF(2^8) with the polynomial 0x11D

function mul(x, y) {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
}

function divisor(degree) {
  const out = new Array(degree - 1).fill(0);
  out.push(1);
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < out.length; j++) {
      out[j] = mul(out[j], root);
      if (j + 1 < out.length) out[j] ^= out[j + 1];
    }
    root = mul(root, 0x02);
  }
  return out;
}

function remainder(data, div) {
  const out = div.map(() => 0);
  for (const b of data) {
    const factor = b ^ out.shift();
    out.push(0);
    div.forEach((coef, i) => {
      out[i] ^= mul(coef, factor);
    });
  }
  return out;
}

// The data split in blocks, each with its error correction, interleaved.
function withEcc(ver, data) {
  const blocks = BLOCKS[ver];
  const eccLen = ECC_PER_BLOCK[ver];
  const raw = Math.floor(rawModules(ver) / 8);
  const shortBlocks = blocks - (raw % blocks);
  const shortLen = Math.floor(raw / blocks);
  const div = divisor(eccLen);
  const all = [];
  for (let i = 0, k = 0; i < blocks; i++) {
    const dat = data.slice(
      k,
      k + shortLen - eccLen + (i < shortBlocks ? 0 : 1),
    );
    k += dat.length;
    const ecc = remainder(dat, div);
    if (i < shortBlocks) dat.push(0);
    all.push(dat.concat(ecc));
  }
  const out = [];
  for (let i = 0; i < all[0].length; i++)
    all.forEach((block, j) => {
      if (i !== shortLen - eccLen || j >= shortBlocks) out.push(block[i]);
    });
  return out;
}

// ---- the module grid

const bit = (x, i) => ((x >>> i) & 1) !== 0;

function alignmentAt(ver, size) {
  if (ver === 1) return [];
  const count = Math.floor(ver / 7) + 2;
  const step = Math.ceil((ver * 4 + 4) / (count * 2 - 2)) * 2;
  const out = [6];
  for (let pos = size - 7; out.length < count; pos -= step)
    out.splice(1, 0, pos);
  return out;
}

function grid(ver) {
  const size = ver * 4 + 17;
  const dark = Array.from({ length: size }, () => new Array(size).fill(false));
  const fixed = Array.from({ length: size }, () => new Array(size).fill(false));
  const set = (x, y, on) => {
    dark[y][x] = on;
    fixed[y][x] = true;
  };
  for (let i = 0; i < size; i++) {
    set(6, i, i % 2 === 0);
    set(i, 6, i % 2 === 0);
  }
  for (const [cx, cy] of [
    [3, 3],
    [size - 4, 3],
    [3, size - 4],
  ])
    for (let dy = -4; dy <= 4; dy++)
      for (let dx = -4; dx <= 4; dx++) {
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        const x = cx + dx;
        const y = cy + dy;
        if (x >= 0 && x < size && y >= 0 && y < size)
          set(x, y, d !== 2 && d !== 4);
      }
  const at = alignmentAt(ver, size);
  const last = at.length - 1;
  for (let i = 0; i <= last; i++)
    for (let j = 0; j <= last; j++) {
      if (
        (i === 0 && j === 0) ||
        (i === 0 && j === last) ||
        (i === last && j === 0)
      )
        continue;
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++)
          set(
            at[i] + dx,
            at[j] + dy,
            Math.max(Math.abs(dx), Math.abs(dy)) !== 1,
          );
    }
  if (ver >= 7) {
    let rem = ver;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = (ver << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      set(a, b, bit(bits, i));
      set(b, a, bit(bits, i));
    }
  }
  return { size, dark, fixed, set };
}

function drawFormat(g, mask) {
  const data = (FORMAT_M << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  const bits = ((data << 10) | rem) ^ 0x5412;
  const { size, set } = g;
  for (let i = 0; i <= 5; i++) set(8, i, bit(bits, i));
  set(8, 7, bit(bits, 6));
  set(8, 8, bit(bits, 7));
  set(7, 8, bit(bits, 8));
  for (let i = 9; i < 15; i++) set(14 - i, 8, bit(bits, i));
  for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(bits, i));
  for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(bits, i));
  set(8, size - 8, true);
}

function drawCodewords(g, words) {
  const { size, dark, fixed } = g;
  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++)
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const y = ((right + 1) & 2) === 0 ? size - 1 - vert : vert;
        if (!fixed[y][x] && i < words.length * 8) {
          dark[y][x] = bit(words[i >>> 3], 7 - (i & 7));
          i++;
        }
      }
  }
}

const MASKS = [
  (x, y) => (x + y) % 2 === 0,
  (_x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

function applyMask(g, mask) {
  for (let y = 0; y < g.size; y++)
    for (let x = 0; x < g.size; x++)
      if (!g.fixed[y][x] && MASKS[mask](x, y)) g.dark[y][x] = !g.dark[y][x];
}

// The standard's penalty: long runs, 2x2 blocks, finder-like patterns, and a dark share far from half.
function penalty({ size, dark }) {
  let score = 0;
  const lines = [];
  for (let i = 0; i < size; i++) {
    lines.push(dark[i]);
    lines.push(dark.map((row) => row[i]));
  }
  const finder = [1, 0, 1, 1, 1, 0, 1];
  for (const line of lines) {
    for (let i = 0, run = 1; i < size; i++, run++)
      if (i === size - 1 || line[i] !== line[i + 1]) {
        if (run >= 5) score += run - 2;
        run = 0;
      }
    const at = (i) => (i >= 0 && i < size ? line[i] : false);
    for (let i = 0; i + 7 <= size; i++) {
      if (!finder.every((f, k) => at(i + k) === (f === 1))) continue;
      const lightBefore = [1, 2, 3, 4].every((k) => !at(i - k));
      const lightAfter = [7, 8, 9, 10].every((k) => !at(i + k));
      if (lightBefore || lightAfter) score += 40;
    }
  }
  for (let y = 0; y + 1 < size; y++)
    for (let x = 0; x + 1 < size; x++) {
      const c = dark[y][x];
      if (
        c === dark[y][x + 1] &&
        c === dark[y + 1][x] &&
        c === dark[y + 1][x + 1]
      )
        score += 3;
    }
  const total = size * size;
  const darkCount = dark.reduce((n, row) => n + row.filter(Boolean).length, 0);
  score += (Math.ceil(Math.abs(darkCount * 20 - total * 10) / total) - 1) * 10;
  return score;
}

// The module grid for `text`: rows of booleans, true for dark.
export function qrModules(text) {
  const { ver, bytes } = encodeData(text);
  const words = withEcc(ver, bytes);
  let best = null;
  for (let mask = 0; mask < 8; mask++) {
    const g = grid(ver);
    drawFormat(g, mask);
    drawCodewords(g, words);
    applyMask(g, mask);
    const score = penalty(g);
    if (!best || score < best.score) best = { score, dark: g.dark };
  }
  return best.dark;
}

// The code as an SVG: one path of dark squares on white, 4 light modules round it, `scale` pixels a module.
export function qrSvg(text, { scale = 6 } = {}) {
  const dark = qrModules(text);
  const n = dark.length + 8;
  let d = "";
  dark.forEach((row, y) =>
    row.forEach((on, x) => {
      if (on) d += `M${x + 4} ${y + 4}h1v1h-1z`;
    }),
  );
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" width="${n * scale}" height="${n * scale}" shape-rendering="crispEdges" role="img" aria-label="Pairing code as a QR code"><rect width="${n}" height="${n}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}
