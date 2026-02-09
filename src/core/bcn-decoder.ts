/**
 * Software BCn texture decoder — decodes BC1/BC4/BC5/BC7 compressed blocks to RGBA8.
 * Only decodes the first mip level (mip 0) for preview purposes.
 */

// ---- BC1 (DXT1): 4bpp, RGB(A) ----
function decodeBC1Block(block: Buffer, offset: number, out: Uint8Array, outOffset: number, stride: number) {
  const c0 = block.readUInt16LE(offset)
  const c1 = block.readUInt16LE(offset + 2)
  const bits = block.readUInt32LE(offset + 4)

  // Expand 5:6:5 to 8:8:8
  const r0 = ((c0 >> 11) & 0x1f) * 255 / 31
  const g0 = ((c0 >> 5) & 0x3f) * 255 / 63
  const b0 = (c0 & 0x1f) * 255 / 31
  const r1 = ((c1 >> 11) & 0x1f) * 255 / 31
  const g1 = ((c1 >> 5) & 0x3f) * 255 / 63
  const b1 = (c1 & 0x1f) * 255 / 31

  const colors = new Uint8Array(16) // 4 colors x RGBA
  colors[0] = r0; colors[1] = g0; colors[2] = b0; colors[3] = 255
  colors[4] = r1; colors[5] = g1; colors[6] = b1; colors[7] = 255

  if (c0 > c1) {
    colors[8]  = (2 * r0 + r1) / 3; colors[9]  = (2 * g0 + g1) / 3
    colors[10] = (2 * b0 + b1) / 3; colors[11] = 255
    colors[12] = (r0 + 2 * r1) / 3; colors[13] = (g0 + 2 * g1) / 3
    colors[14] = (b0 + 2 * b1) / 3; colors[15] = 255
  } else {
    colors[8]  = (r0 + r1) / 2; colors[9]  = (g0 + g1) / 2
    colors[10] = (b0 + b1) / 2; colors[11] = 255
    colors[12] = 0; colors[13] = 0; colors[14] = 0; colors[15] = 0 // transparent
  }

  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      const idx = (bits >> (2 * (y * 4 + x))) & 3
      const pix = outOffset + y * stride + x * 4
      out[pix]     = colors[idx * 4]
      out[pix + 1] = colors[idx * 4 + 1]
      out[pix + 2] = colors[idx * 4 + 2]
      out[pix + 3] = colors[idx * 4 + 3]
    }
  }
}

// ---- BC4 (ATI1): single channel (R), 4bpp ----
function decodeBC4Block(block: Buffer, offset: number, out: Uint8Array, outOffset: number, stride: number) {
  const a0 = block[offset]
  const a1 = block[offset + 1]

  // Build interpolated alpha table
  const alphas = new Uint8Array(8)
  alphas[0] = a0
  alphas[1] = a1
  if (a0 > a1) {
    for (let i = 1; i < 7; i++) alphas[i + 1] = ((7 - i) * a0 + i * a1) / 7
  } else {
    for (let i = 1; i < 5; i++) alphas[i + 1] = ((5 - i) * a0 + i * a1) / 5
    alphas[6] = 0
    alphas[7] = 255
  }

  // Read 48-bit index table (6 bytes starting at offset+2)
  let bits = 0n
  for (let i = 0; i < 6; i++) {
    bits |= BigInt(block[offset + 2 + i]) << BigInt(i * 8)
  }

  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      const idx = Number((bits >> BigInt(3 * (y * 4 + x))) & 7n)
      const val = alphas[idx]
      const pix = outOffset + y * stride + x * 4
      out[pix]     = val
      out[pix + 1] = val
      out[pix + 2] = val
      out[pix + 3] = 255
    }
  }
}

// ---- BC5 (ATI2): two channels (RG), 8bpp ----
function decodeBC5Block(block: Buffer, offset: number, out: Uint8Array, outOffset: number, stride: number) {
  // Decode two BC4 channels
  const rChannel = new Uint8Array(16)
  const gChannel = new Uint8Array(16)

  decodeBC4Channel(block, offset, rChannel)
  decodeBC4Channel(block, offset + 8, gChannel)

  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      const i = y * 4 + x
      const pix = outOffset + y * stride + x * 4
      out[pix]     = rChannel[i]
      out[pix + 1] = gChannel[i]
      // Reconstruct Z for normal maps: z = sqrt(1 - x^2 - y^2)
      const nx = rChannel[i] / 127.5 - 1.0
      const ny = gChannel[i] / 127.5 - 1.0
      const nz = Math.sqrt(Math.max(0, 1.0 - nx * nx - ny * ny))
      out[pix + 2] = Math.round((nz * 0.5 + 0.5) * 255)
      out[pix + 3] = 255
    }
  }
}

function decodeBC4Channel(block: Buffer, offset: number, out: Uint8Array) {
  const a0 = block[offset]
  const a1 = block[offset + 1]

  const alphas = new Uint8Array(8)
  alphas[0] = a0
  alphas[1] = a1
  if (a0 > a1) {
    for (let i = 1; i < 7; i++) alphas[i + 1] = ((7 - i) * a0 + i * a1) / 7
  } else {
    for (let i = 1; i < 5; i++) alphas[i + 1] = ((5 - i) * a0 + i * a1) / 5
    alphas[6] = 0
    alphas[7] = 255
  }

  let bits = 0n
  for (let i = 0; i < 6; i++) {
    bits |= BigInt(block[offset + 2 + i]) << BigInt(i * 8)
  }

  for (let i = 0; i < 16; i++) {
    const idx = Number((bits >> BigInt(3 * i)) & 7n)
    out[i] = alphas[idx]
  }
}

// ---- BC7: high quality 8bpp ----
// BC7 has 8 modes (0-7), each with different partition counts, color bits, etc.
// This is a simplified decoder that handles the most common modes.

const BC7_MODES = [
  { ns: 3, pb: 4, rb: 0, isb: 0, cb: 4, ab: 0, epb: 1, spb: 0, ib: 3, ib2: 0 },  // mode 0
  { ns: 2, pb: 6, rb: 0, isb: 0, cb: 6, ab: 0, epb: 0, spb: 1, ib: 3, ib2: 0 },  // mode 1
  { ns: 3, pb: 6, rb: 0, isb: 0, cb: 5, ab: 0, epb: 0, spb: 0, ib: 2, ib2: 0 },  // mode 2
  { ns: 2, pb: 6, rb: 0, isb: 0, cb: 7, ab: 0, epb: 1, spb: 0, ib: 2, ib2: 0 },  // mode 3
  { ns: 1, pb: 0, rb: 2, isb: 1, cb: 5, ab: 6, epb: 0, spb: 0, ib: 2, ib2: 3 },  // mode 4
  { ns: 1, pb: 0, rb: 2, isb: 0, cb: 7, ab: 8, epb: 0, spb: 0, ib: 2, ib2: 2 },  // mode 5
  { ns: 1, pb: 0, rb: 0, isb: 0, cb: 7, ab: 7, epb: 1, spb: 0, ib: 4, ib2: 0 },  // mode 6
  { ns: 2, pb: 6, rb: 0, isb: 0, cb: 5, ab: 5, epb: 1, spb: 0, ib: 2, ib2: 0 },  // mode 7
]

// BC7 partition tables for 2 and 3 subsets (standard spec tables)
// These are the 64 partition patterns for 2 subsets
const BC7_PARTITION_2: number[][] = []
const BC7_PARTITION_3: number[][] = []

// Anchor indices for 2-subset partitions (subset 1 anchor; subset 0 is always pixel 0)
const BC7_ANCHOR_2 = [
  15,15,15,15,15,15,15,15, 15,15,15,15,15,15,15,15,
  15, 2, 8, 2, 2, 8, 8,15,  2, 8, 2, 2, 8, 8, 2, 2,
  15,15, 6, 8, 2, 8,15,15,  2, 8, 2, 2, 2,15,15, 6,
   6, 2, 6, 8,15,15, 2, 2, 15,15,15,15,15, 2, 2,15,
]

// Anchor indices for 3-subset partitions (subset 1 anchor)
const BC7_ANCHOR_3A = [
   3, 3,15,15, 8, 3,15,15,  8, 8, 6, 6, 6, 5, 3, 3,
   3, 3, 8,15, 3, 3, 6,10,  5, 8, 8, 6, 8, 5,15,15,
   8,15, 3, 5, 6,10, 8,15, 15, 3,15, 5,15,15,15,15,
   3,15, 5, 5, 5, 8, 5,10,  5,10, 8,13,15,12, 3, 3,
]

// Anchor indices for 3-subset partitions (subset 2 anchor)
const BC7_ANCHOR_3B = [
  15, 8, 8, 3,15,15, 3, 8, 15,15,15,15,15,15,15, 8,
  15, 8,15, 3,15, 8,15, 8,  3,15, 6,10,15,15,10, 8,
  15, 3,15,10,10, 8, 9,10,  6,15, 8,15, 3, 6, 6, 8,
  15, 3,15,15,15,15,15,15, 15,15,15,15, 3,15,15, 8,
]

// Initialize partition tables with the standard values
function initPartitionTables() {
  // 2-subset partitions (64 entries, 16 pixels each)
  const p2Data = [
    0xCCCC,0x8888,0xEEEE,0xECC8,0xC880,0xFEEC,0xFEC8,0xEC80,
    0xC800,0xFFEC,0xFE80,0xE800,0xFFE8,0xFF00,0xFFF0,0xF000,
    0xF710,0x008E,0x7100,0x08CE,0x008C,0x7310,0x3100,0x8CCE,
    0x088C,0x3110,0x6666,0x366C,0x17E8,0x0FF0,0x718E,0x399C,
    0xAAAA,0xF0F0,0x5A5A,0x33CC,0x3C3C,0x55AA,0x9696,0xA55A,
    0x73CE,0x13C8,0x324C,0x3BDC,0x6996,0xC33C,0x9966,0x0660,
    0x0272,0x04E4,0x4E40,0x2720,0xC936,0x936C,0x39C6,0x639C,
    0x9336,0x9CC6,0x817E,0xE718,0xCCF0,0x0FCC,0x7744,0xEE22,
  ]
  for (const bits of p2Data) {
    const partition = new Array(16)
    for (let i = 0; i < 16; i++) {
      partition[i] = (bits >> i) & 1
    }
    BC7_PARTITION_2.push(partition)
  }

  // 3-subset partitions (64 entries)
  const p3Data = [
    0xAA685050,0x6A5A5040,0x5A5A4200,0x5450A0A8,0xA5A50000,0xA0A05050,0x5555A0A0,0x5A5A5050,
    0xAA550000,0xAA555500,0xAAAA5500,0x90909090,0x94949494,0xA4A4A4A4,0xA9A59450,0x2A0A4250,
    0xA5945040,0x0A425054,0xA5A5A500,0x55A0A0A0,0xA8A85454,0x6A6A4040,0xA4A45000,0x1A1A0500,
    0x0050A4A4,0xAAA59090,0x14696914,0x69691400,0xA08585A0,0xAA821414,0x50A4A450,0x6A5A0200,
    0xA9A58000,0x5090A0A8,0xA8A09050,0x24242424,0x00AA5500,0x24924924,0x24499224,0x50A50A50,
    0x500AA550,0xAAAA4444,0x66660000,0xA5A0A5A0,0x50A050A0,0x69286928,0x44AAAA44,0x66666600,
    0xAA444444,0x54A854A8,0x95809580,0x96969600,0xA85454A8,0x80959580,0xAA141414,0x96960000,
    0xAAAA1414,0xA05050A0,0xA50A5050,0x96000000,0x40804080,0xA9A8A9A8,0xAAAAAA44,0x2A4A5254,
  ]
  for (const bits of p3Data) {
    const partition = new Array(16)
    for (let i = 0; i < 16; i++) {
      partition[i] = (bits >> (i * 2)) & 3
    }
    BC7_PARTITION_3.push(partition)
  }
}

// Simple BC7 fallback: decode as grayscale from raw bytes (for when full decode is too complex)
function decodeBC7BlockSimple(block: Buffer, offset: number, out: Uint8Array, outOffset: number, stride: number) {
  // Determine mode from lowest set bit
  let modeByte = block[offset]
  let mode = 0
  while (mode < 8 && !(modeByte & (1 << mode))) mode++

  if (mode >= 8) {
    // Invalid block — fill with magenta
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        const pix = outOffset + y * stride + x * 4
        out[pix] = 255; out[pix + 1] = 0; out[pix + 2] = 255; out[pix + 3] = 255
      }
    }
    return
  }

  // Use a bit reader for the 128-bit block
  const bits = new DataView(block.buffer, block.byteOffset + offset, 16)
  let bitPos = mode + 1 // skip mode bits

  function readBits(count: number): number {
    let val = 0
    for (let i = 0; i < count; i++) {
      const byteIdx = (bitPos + i) >> 3
      if (byteIdx >= 16) break // safety: don't read past the 128-bit block
      const bitIdx = (bitPos + i) & 7
      if (bits.getUint8(byteIdx) & (1 << bitIdx)) {
        val |= 1 << i
      }
    }
    bitPos += count
    return val
  }

  const modeInfo = BC7_MODES[mode]
  const partition = modeInfo.pb > 0 ? readBits(modeInfo.pb > 4 ? 6 : 4) : 0

  // Read rotation and index selection bits
  const rotation = modeInfo.rb > 0 ? readBits(modeInfo.rb) : 0
  const indexSel = modeInfo.isb > 0 ? readBits(1) : 0

  // Read color endpoints
  const numEndpoints = modeInfo.ns * 2
  const r = new Uint8Array(numEndpoints)
  const g = new Uint8Array(numEndpoints)
  const b = new Uint8Array(numEndpoints)
  const a = new Uint8Array(numEndpoints)

  for (let i = 0; i < numEndpoints; i++) r[i] = readBits(modeInfo.cb)
  for (let i = 0; i < numEndpoints; i++) g[i] = readBits(modeInfo.cb)
  for (let i = 0; i < numEndpoints; i++) b[i] = readBits(modeInfo.cb)
  if (modeInfo.ab > 0) {
    for (let i = 0; i < numEndpoints; i++) a[i] = readBits(modeInfo.ab)
  } else {
    a.fill(255)
  }

  // Read P-bits
  if (modeInfo.epb > 0) {
    for (let i = 0; i < numEndpoints; i++) {
      const pbit = readBits(1)
      r[i] = (r[i] << 1) | pbit
      g[i] = (g[i] << 1) | pbit
      b[i] = (b[i] << 1) | pbit
      if (modeInfo.ab > 0) a[i] = (a[i] << 1) | pbit
    }
  } else if (modeInfo.spb > 0) {
    for (let i = 0; i < numEndpoints; i += 2) {
      const pbit = readBits(1)
      r[i] = (r[i] << 1) | pbit; r[i + 1] = (r[i + 1] << 1) | pbit
      g[i] = (g[i] << 1) | pbit; g[i + 1] = (g[i + 1] << 1) | pbit
      b[i] = (b[i] << 1) | pbit; b[i + 1] = (b[i + 1] << 1) | pbit
      if (modeInfo.ab > 0) {
        a[i] = (a[i] << 1) | pbit; a[i + 1] = (a[i + 1] << 1) | pbit
      }
    }
  }

  // Expand endpoints to 8 bits
  const totalColorBits = modeInfo.cb + (modeInfo.epb > 0 || modeInfo.spb > 0 ? 1 : 0)
  const totalAlphaBits = modeInfo.ab > 0 ? modeInfo.ab + (modeInfo.epb > 0 || modeInfo.spb > 0 ? 1 : 0) : 8

  for (let i = 0; i < numEndpoints; i++) {
    r[i] = (r[i] << (8 - totalColorBits)) | (r[i] >> (2 * totalColorBits - 8))
    g[i] = (g[i] << (8 - totalColorBits)) | (g[i] >> (2 * totalColorBits - 8))
    b[i] = (b[i] << (8 - totalColorBits)) | (b[i] >> (2 * totalColorBits - 8))
    if (modeInfo.ab > 0) {
      a[i] = (a[i] << (8 - totalAlphaBits)) | (a[i] >> (2 * totalAlphaBits - 8))
    }
  }

  // Get partition assignment
  let partitionTable: number[]
  if (modeInfo.ns === 1) {
    partitionTable = [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0]
  } else if (modeInfo.ns === 2) {
    partitionTable = BC7_PARTITION_2[partition % 64] || new Array(16).fill(0)
  } else {
    partitionTable = BC7_PARTITION_3[partition % 64] || new Array(16).fill(0)
  }

  // BC7 interpolation weights
  const weights2 = [0, 21, 43, 64]
  const weights3 = [0, 9, 18, 27, 37, 46, 55, 64]
  const weights4 = [0, 4, 9, 13, 17, 21, 26, 30, 34, 38, 43, 47, 51, 55, 60, 64]

  const weightsTable = modeInfo.ib === 2 ? weights2 : modeInfo.ib === 3 ? weights3 : weights4

  // Determine anchor indices (anchors get 1 fewer index bit)
  const anchors = new Set<number>()
  anchors.add(0) // subset 0 anchor is always pixel 0
  if (modeInfo.ns === 2) {
    anchors.add(BC7_ANCHOR_2[partition % 64])
  } else if (modeInfo.ns === 3) {
    anchors.add(BC7_ANCHOR_3A[partition % 64])
    anchors.add(BC7_ANCHOR_3B[partition % 64])
  }

  // Read index data (anchor indices have 1 fewer bit, MSB implicitly 0)
  const indices = new Uint8Array(16)
  for (let i = 0; i < 16; i++) {
    const bits2 = anchors.has(i) ? modeInfo.ib - 1 : modeInfo.ib
    indices[i] = bits2 > 0 ? readBits(bits2) : 0
  }

  // Interpolate and output
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      const i = y * 4 + x
      const subset = partitionTable[i]
      const e0 = subset * 2
      const e1 = subset * 2 + 1
      const w = weightsTable[indices[i] % weightsTable.length]

      const pix = outOffset + y * stride + x * 4
      out[pix]     = ((64 - w) * r[e0] + w * r[e1] + 32) >> 6
      out[pix + 1] = ((64 - w) * g[e0] + w * g[e1] + 32) >> 6
      out[pix + 2] = ((64 - w) * b[e0] + w * b[e1] + 32) >> 6
      out[pix + 3] = ((64 - w) * a[e0] + w * a[e1] + 32) >> 6

      // Apply rotation
      if (rotation === 1) { const t = out[pix + 3]; out[pix + 3] = out[pix]; out[pix] = t }
      else if (rotation === 2) { const t = out[pix + 3]; out[pix + 3] = out[pix + 1]; out[pix + 1] = t }
      else if (rotation === 3) { const t = out[pix + 3]; out[pix + 3] = out[pix + 2]; out[pix + 2] = t }
    }
  }
}

// ---- Uncompressed format decoders ----
function decodeR8(data: Buffer, width: number, height: number): Uint8Array {
  const out = new Uint8Array(width * height * 4)
  for (let i = 0; i < width * height; i++) {
    const v = i < data.length ? data[i] : 0
    out[i * 4] = v; out[i * 4 + 1] = v; out[i * 4 + 2] = v; out[i * 4 + 3] = 255
  }
  return out
}

function decodeRGBA8(data: Buffer, width: number, height: number): Uint8Array {
  const pixels = width * height
  const out = new Uint8Array(pixels * 4)
  const copyLen = Math.min(pixels * 4, data.length)
  data.copy(Buffer.from(out.buffer), 0, 0, copyLen)
  // Ensure alpha = 255 for any unset pixels
  for (let i = copyLen; i < pixels * 4; i += 4) {
    out[i + 3] = 255
  }
  return out
}

function decodeBGRA8(data: Buffer, width: number, height: number): Uint8Array {
  const out = new Uint8Array(width * height * 4)
  for (let i = 0; i < width * height; i++) {
    const off = i * 4
    if (off + 3 < data.length) {
      out[off]     = data[off + 2] // R from B
      out[off + 1] = data[off + 1] // G
      out[off + 2] = data[off]     // B from R
      out[off + 3] = data[off + 3] // A
    }
  }
  return out
}

function decodeRG16F(data: Buffer, width: number, height: number): Uint8Array {
  const out = new Uint8Array(width * height * 4)
  for (let i = 0; i < width * height; i++) {
    const off = i * 4
    if (off + 3 < data.length) {
      // Simple half-float to byte approximation
      const r = Math.min(255, Math.max(0, data.readUInt16LE(off) / 256))
      const g = Math.min(255, Math.max(0, data.readUInt16LE(off + 2) / 256))
      out[i * 4] = r; out[i * 4 + 1] = g; out[i * 4 + 2] = 128; out[i * 4 + 3] = 255
    }
  }
  return out
}

function decodeRGBA16F(data: Buffer, width: number, height: number): Uint8Array {
  const out = new Uint8Array(width * height * 4)
  for (let i = 0; i < width * height; i++) {
    const off = i * 8
    if (off + 7 < data.length) {
      out[i * 4]     = Math.min(255, Math.max(0, data.readUInt16LE(off) / 256))
      out[i * 4 + 1] = Math.min(255, Math.max(0, data.readUInt16LE(off + 2) / 256))
      out[i * 4 + 2] = Math.min(255, Math.max(0, data.readUInt16LE(off + 4) / 256))
      out[i * 4 + 3] = Math.min(255, Math.max(0, data.readUInt16LE(off + 6) / 256))
    }
  }
  return out
}

// ---- Main decoder ----

// Block format block sizes (bytes per 4x4 block)
const BLOCK_SIZES: Record<number, number> = {
  71: 8, 72: 8,     // BC1
  74: 16, 75: 16,   // BC2
  77: 16, 78: 16,   // BC3
  80: 8, 81: 8,     // BC4
  83: 16, 84: 16,   // BC5
  95: 16, 96: 16,   // BC6H
  98: 16, 99: 16,   // BC7
}

// Initialize BC7 partition tables on module load
initPartitionTables()

/**
 * Decode BCn compressed texture data to RGBA8 pixels (first mip only).
 * @param data Raw texture data (all mips, only mip 0 is decoded)
 * @param width Texture width in pixels
 * @param height Texture height in pixels
 * @param dxgiFmt DXGI format ID
 * @returns RGBA8 pixel data as Uint8Array (width * height * 4 bytes)
 */
export function decodeBCn(data: Buffer, width: number, height: number, dxgiFmt: number): Uint8Array {
  // Uncompressed formats
  if (dxgiFmt === 61) return decodeR8(data, width, height)
  if (dxgiFmt === 28 || dxgiFmt === 29) return decodeRGBA8(data, width, height)
  if (dxgiFmt === 87) return decodeBGRA8(data, width, height)
  if (dxgiFmt === 34) return decodeRG16F(data, width, height)
  if (dxgiFmt === 10) return decodeRGBA16F(data, width, height)

  const blockSize = BLOCK_SIZES[dxgiFmt]
  if (!blockSize) {
    // Unknown format — return gray
    const out = new Uint8Array(width * height * 4)
    out.fill(128)
    for (let i = 3; i < out.length; i += 4) out[i] = 255
    return out
  }

  const blocksX = Math.max(1, Math.ceil(width / 4))
  const blocksY = Math.max(1, Math.ceil(height / 4))
  const stride = width * 4
  const out = new Uint8Array(width * height * 4)

  for (let by = 0; by < blocksY; by++) {
    for (let bx = 0; bx < blocksX; bx++) {
      const blockIdx = by * blocksX + bx
      const blockOffset = blockIdx * blockSize
      if (blockOffset + blockSize > data.length) break

      const outOffset = by * 4 * stride + bx * 4 * 4

      switch (dxgiFmt) {
        case 71: case 72: // BC1
          decodeBC1Block(data, blockOffset, out, outOffset, stride)
          break
        case 80: case 81: // BC4
          decodeBC4Block(data, blockOffset, out, outOffset, stride)
          break
        case 83: case 84: // BC5
          decodeBC5Block(data, blockOffset, out, outOffset, stride)
          break
        case 98: case 99: // BC7
          decodeBC7BlockSimple(data, blockOffset, out, outOffset, stride)
          break
        default:
          // BC2, BC3, BC6H — fill with pattern to indicate unsupported
          for (let y = 0; y < 4; y++) {
            for (let x = 0; x < 4; x++) {
              const pix = outOffset + y * stride + x * 4
              if (pix + 3 < out.length) {
                const v = ((bx + by) % 2) ? 100 : 60
                out[pix] = v; out[pix + 1] = v; out[pix + 2] = v; out[pix + 3] = 255
              }
            }
          }
      }
    }
  }

  return out
}
