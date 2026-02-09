/**
 * Generate a 256x256 PNG icon for BLP Studio using Canvas API
 * via Electron's nativeImage. Run with: node scripts/gen-icon.mjs
 *
 * Falls back to creating a minimal 1x1 placeholder if canvas is unavailable.
 */

import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outPath = join(__dirname, '..', 'resources', 'icon.png');

// Create a simple 256x256 RGBA buffer with a "BLP" design
const SIZE = 256;
const pixels = Buffer.alloc(SIZE * SIZE * 4);

function setPixel(x, y, r, g, b, a = 255) {
  if (x < 0 || x >= SIZE || y < 0 || y >= SIZE) return;
  const i = (y * SIZE + x) * 4;
  pixels[i] = r;
  pixels[i + 1] = g;
  pixels[i + 2] = b;
  pixels[i + 3] = a;
}

function fillRect(x0, y0, w, h, r, g, b, a = 255) {
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      setPixel(x, y, r, g, b, a);
    }
  }
}

function fillCircle(cx, cy, radius, r, g, b, a = 255) {
  const r2 = radius * radius;
  for (let y = cy - radius; y <= cy + radius; y++) {
    for (let x = cx - radius; x <= cx + radius; x++) {
      const dx = x - cx, dy = y - cy;
      if (dx * dx + dy * dy <= r2) {
        setPixel(x, y, r, g, b, a);
      }
    }
  }
}

// Background: rounded dark blue square
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    // Rounded corners (radius 32)
    const R = 32;
    let inside = true;
    if (x < R && y < R && (x - R) ** 2 + (y - R) ** 2 > R * R) inside = false;
    if (x >= SIZE - R && y < R && (x - (SIZE - R - 1)) ** 2 + (y - R) ** 2 > R * R) inside = false;
    if (x < R && y >= SIZE - R && (x - R) ** 2 + (y - (SIZE - R - 1)) ** 2 > R * R) inside = false;
    if (x >= SIZE - R && y >= SIZE - R && (x - (SIZE - R - 1)) ** 2 + (y - (SIZE - R - 1)) ** 2 > R * R) inside = false;

    if (inside) {
      // Dark gradient: #1a1f3a -> #0f1629
      const t = y / SIZE;
      const cr = Math.round(26 * (1 - t) + 15 * t);
      const cg = Math.round(31 * (1 - t) + 22 * t);
      const cb = Math.round(58 * (1 - t) + 41 * t);
      setPixel(x, y, cr, cg, cb);
    }
  }
}

// Draw a stylized diamond/hexagon shape in the center (package symbol)
const cx = 128, cy = 118;
const S = 60;
for (let dy = -S; dy <= S; dy++) {
  const rowWidth = Math.round(S - Math.abs(dy) * 0.6);
  for (let dx = -rowWidth; dx <= rowWidth; dx++) {
    // Blue gradient for the shape
    const t = (dy + S) / (2 * S);
    const r = Math.round(59 * (1 - t) + 37 * t);
    const g = Math.round(130 * (1 - t) + 99 * t);
    const b = Math.round(246 * (1 - t) + 235 * t);
    setPixel(cx + dx, cy + dy, r, g, b);
  }
}

// Inner diamond (lighter)
const S2 = 40;
for (let dy = -S2; dy <= S2; dy++) {
  const rowWidth = Math.round(S2 - Math.abs(dy) * 0.6);
  for (let dx = -rowWidth; dx <= rowWidth; dx++) {
    const t = (dy + S2) / (2 * S2);
    const r = Math.round(96 * (1 - t) + 59 * t);
    const g = Math.round(165 * (1 - t) + 130 * t);
    const b = Math.round(250 * (1 - t) + 246 * t);
    setPixel(cx + dx, cy + dy, r, g, b);
  }
}

// "BLP" text below the shape - simple block letters
const textY = 195;
const letterH = 28;
const letterW = 16;
const gap = 6;
const textStartX = cx - Math.round((3 * letterW + 2 * gap) / 2);

// Letter B
const bx = textStartX;
fillRect(bx, textY, 4, letterH, 200, 210, 240);
fillRect(bx + 4, textY, letterW - 4, 4, 200, 210, 240);
fillRect(bx + 4, textY + Math.round(letterH / 2) - 2, letterW - 4, 4, 200, 210, 240);
fillRect(bx + 4, textY + letterH - 4, letterW - 4, 4, 200, 210, 240);
fillRect(bx + letterW - 4, textY, 4, Math.round(letterH / 2), 200, 210, 240);
fillRect(bx + letterW - 4, textY + Math.round(letterH / 2), 4, Math.round(letterH / 2), 200, 210, 240);

// Letter L
const lx = textStartX + letterW + gap;
fillRect(lx, textY, 4, letterH, 200, 210, 240);
fillRect(lx, textY + letterH - 4, letterW, 4, 200, 210, 240);

// Letter P
const px = textStartX + 2 * (letterW + gap);
fillRect(px, textY, 4, letterH, 200, 210, 240);
fillRect(px + 4, textY, letterW - 4, 4, 200, 210, 240);
fillRect(px + 4, textY + Math.round(letterH / 2) - 2, letterW - 4, 4, 200, 210, 240);
fillRect(px + letterW - 4, textY, 4, Math.round(letterH / 2), 200, 210, 240);

// Write raw RGBA as a minimal PNG
// We'll write a proper PNG using zlib-less uncompressed approach

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
    }
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function makeChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crcVal = crc32(typeData);
  const crc = Buffer.alloc(4);
  crc[0] = (crcVal >>> 24) & 0xFF;
  crc[1] = (crcVal >>> 16) & 0xFF;
  crc[2] = (crcVal >>> 8) & 0xFF;
  crc[3] = crcVal & 0xFF;
  return Buffer.concat([len, typeData, crc]);
}

// PNG signature
const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

// IHDR
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // color type: RGBA
ihdr[10] = 0; // compression
ihdr[11] = 0; // filter
ihdr[12] = 0; // interlace

// IDAT - uncompressed deflate blocks
// Each row: filter byte (0) + SIZE*4 RGBA bytes
const rowSize = 1 + SIZE * 4;
const rawData = Buffer.alloc(SIZE * rowSize);
for (let y = 0; y < SIZE; y++) {
  rawData[y * rowSize] = 0; // no filter
  pixels.copy(rawData, y * rowSize + 1, y * SIZE * 4, (y + 1) * SIZE * 4);
}

// zlib wrapper around uncompressed deflate
// zlib header: 0x78 0x01 (deflate, no compression)
const maxBlock = 65535;
const blocks = [];
let offset = 0;
while (offset < rawData.length) {
  const remaining = rawData.length - offset;
  const blockLen = Math.min(remaining, maxBlock);
  const isLast = offset + blockLen >= rawData.length;
  const header = Buffer.alloc(5);
  header[0] = isLast ? 1 : 0;
  header.writeUInt16LE(blockLen, 1);
  header.writeUInt16LE(blockLen ^ 0xFFFF, 3);
  blocks.push(header);
  blocks.push(rawData.subarray(offset, offset + blockLen));
  offset += blockLen;
}

// Adler-32 checksum
let s1 = 1, s2 = 0;
for (let i = 0; i < rawData.length; i++) {
  s1 = (s1 + rawData[i]) % 65521;
  s2 = (s2 + s1) % 65521;
}
const adlerVal = ((s2 << 16) | s1) >>> 0;
const adler = Buffer.alloc(4);
adler[0] = (adlerVal >>> 24) & 0xFF;
adler[1] = (adlerVal >>> 16) & 0xFF;
adler[2] = (adlerVal >>> 8) & 0xFF;
adler[3] = adlerVal & 0xFF;

const zlibData = Buffer.concat([Buffer.from([0x78, 0x01]), ...blocks, adler]);

// IEND
const png = Buffer.concat([
  sig,
  makeChunk('IHDR', ihdr),
  makeChunk('IDAT', zlibData),
  makeChunk('IEND', Buffer.alloc(0)),
]);

writeFileSync(outPath, png);
console.log(`Icon written to ${outPath} (${png.length} bytes)`);
