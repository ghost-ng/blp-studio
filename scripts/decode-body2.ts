#!/usr/bin/env npx tsx
/**
 * Decode V1 animation body with corrected offset base (AC+0x20).
 *
 * Hypothesis for header layout: [offset_xyz, scale_xyz]
 * value = offset + (quantized / maxQ) * scale
 *
 * Body per segment:
 * 1. Bit widths: totalAnim bytes (1 per channel)
 * 2. Packed initial values: bit-packed, sum(bw)*3 bits
 * 3. Per-frame bitstream: sum(bw)*3 bits per frame (for frames 1..N-1, or all N)
 */

import { readFileSync } from 'fs'
import { resolve } from 'path'

const filepath = resolve(process.argv[2] || '')
const data = readFileSync(filepath)
const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
const u32 = (o: number) => view.getUint32(o, true)
const f32 = (o: number) => view.getFloat32(o, true)

const AC = 0x60
const BASE = AC + 0x20  // Reference base for secOff/g offsets

const frameCount = u32(0x0C)
const boneCount = u32(AC + 0x10)
const count1 = u32(AC + 0x20)
const valA = u32(AC + 0x34)
const valB = u32(AC + 0x38)
const valC = u32(AC + 0x3C)
const secOff = [u32(AC + 0x44), u32(AC + 0x48), u32(AC + 0x4C), u32(AC + 0x50)]

// Navigate past secOff array
let cursor = AC + 0x44 + 16
// Frame boundaries
const frameBounds: number[] = []
if (count1 >= 2) {
  for (let i = 0; i < count1; i++) { frameBounds.push(u32(cursor)); cursor += 4 }
  cursor += 4 // sentinel
} else { frameBounds.push(0) }
// Segment groups
const segGroups: number[][] = []
for (let s = 0; s < count1; s++) {
  segGroups.push([u32(cursor), u32(cursor+4), u32(cursor+8), u32(cursor+12)])
  cursor += 16
}

// Bitfield
const bfSize = secOff[2] - secOff[1]
const channelTypes: number[] = []
const wordCount = Math.ceil(bfSize / 4)
for (let w = 0; w < wordCount; w++) {
  const word = u32(cursor + w * 4)
  for (let i = 0; i < 16; i++) channelTypes.push((word >>> (i * 2)) & 3)
}
const rTypes: number[] = [], tTypes: number[] = [], sTypes: number[] = []
for (let b = 0; b < boneCount; b++) rTypes.push(channelTypes[b] ?? 0)
for (let b = 0; b < boneCount; b++) tTypes.push(channelTypes[boneCount + b] ?? 0)
for (let b = 0; b < boneCount; b++) sTypes.push(channelTypes[2 * boneCount + b] ?? 0)
const rAnim = rTypes.filter(v => v === 2).length
const tAnim = tTypes.filter(v => v === 2).length
const sAnim = sTypes.filter(v => v === 2).length
const totalAnim = rAnim + tAnim + sAnim
cursor += bfSize
cursor += valA * 12 + valB * 12 + valC * 12

// Read animated headers as [offset_xyz, scale_xyz]
interface AnimHeader { offset: [number,number,number]; scale: [number,number,number] }
const headers: AnimHeader[] = []
for (let i = 0; i < totalAnim; i++) {
  headers.push({
    offset: [f32(cursor), f32(cursor+4), f32(cursor+8)],
    scale:  [f32(cursor+12), f32(cursor+16), f32(cursor+20)],
  })
  cursor += 24
}

console.log(`bones=${boneCount} frames=${frameCount} count1=${count1}`)
console.log(`rAnim=${rAnim} tAnim=${tAnim} sAnim=${sAnim} total=${totalAnim}`)
console.log(`BASE=0x${BASE.toString(16)}`)

// Bitstream reader
class BitReader {
  private pos = 0
  constructor(private data: Uint8Array, private startOffset: number) {}

  readLSB(n: number): number {
    let val = 0
    for (let i = 0; i < n; i++) {
      const byteIdx = this.startOffset + Math.floor(this.pos / 8)
      const bitIdx = this.pos % 8
      if (byteIdx < this.data.length) {
        val |= ((this.data[byteIdx] >> bitIdx) & 1) << i
      }
      this.pos++
    }
    return val
  }

  readMSB(n: number): number {
    let val = 0
    for (let i = 0; i < n; i++) {
      const byteIdx = this.startOffset + Math.floor(this.pos / 8)
      const bitIdx = 7 - (this.pos % 8)
      if (byteIdx < this.data.length) {
        val = (val << 1) | ((this.data[byteIdx] >> bitIdx) & 1)
      }
      this.pos++
    }
    return val
  }

  get bitPosition() { return this.pos }
  set bitPosition(p: number) { this.pos = p }
}

// Process first segment
for (let seg = 0; seg < Math.min(1, count1); seg++) {
  const g = segGroups[seg]
  if (g[0] === 0) continue

  const segStart = frameBounds[seg]
  const segEnd = seg < count1 - 1 ? frameBounds[seg + 1] : frameCount
  const segFrames = segEnd - segStart

  const bodyStart = BASE + g[3]
  const bodyEnd = seg < count1 - 1 ? BASE + segGroups[seg + 1][3] : AC + u32(AC + 0x00)
  const bodySize = bodyEnd - bodyStart

  console.log(`\n--- Segment ${seg}: frames ${segStart}..${segEnd-1} (${segFrames} frames) ---`)
  console.log(`g=[${g.join(',')}] bodyStart=0x${bodyStart.toString(16)} bodySize=${bodySize}`)

  // Read bit widths
  const bw: number[] = []
  for (let i = 0; i < totalAnim; i++) bw.push(data[bodyStart + i])
  console.log(`Bit widths: [${bw.join(',')}]`)
  const sumBW = bw.reduce((a, b) => a + b, 0)
  console.log(`Sum(bw)=${sumBW}, sum*3=${sumBW*3} bits, packed=${Math.ceil(sumBW*3/8)} bytes`)

  // After bit widths: packed initial values
  const initStart = bodyStart + totalAnim
  const initBits = sumBW * 3
  const initBytes = Math.ceil(initBits / 8)

  console.log(`\nInitials: ${initBits} bits = ${initBytes} bytes at 0x${initStart.toString(16)}`)

  // Read initial values (LSB first)
  const reader = new BitReader(data, initStart)
  const initValues: number[][] = []
  for (let ch = 0; ch < totalAnim; ch++) {
    const x = reader.readLSB(bw[ch])
    const y = reader.readLSB(bw[ch])
    const z = reader.readLSB(bw[ch])
    initValues.push([x, y, z])
  }

  console.log(`\nDecoded initial values (frame ${segStart}):`)
  for (let ch = 0; ch < totalAnim; ch++) {
    const [qx, qy, qz] = initValues[ch]
    const maxQ = (1 << bw[ch]) - 1
    const h = headers[ch]
    const x = maxQ > 0 ? h.offset[0] + (qx / maxQ) * h.scale[0] : h.offset[0]
    const y = maxQ > 0 ? h.offset[1] + (qy / maxQ) * h.scale[1] : h.offset[1]
    const z = maxQ > 0 ? h.offset[2] + (qz / maxQ) * h.scale[2] : h.offset[2]

    const label = ch < rAnim ? `rot[${ch}]` : ch < rAnim + tAnim ? `pos[${ch-rAnim}]` : `scl[${ch-rAnim-tAnim}]`
    console.log(`  ${label} bw=${bw[ch]} q=[${qx},${qy},${qz}]/${maxQ} → [${x.toFixed(4)}, ${y.toFixed(4)}, ${z.toFixed(4)}]`)
  }

  // Per-frame bitstream
  const bitstreamBitOffset = reader.bitPosition
  const bitstreamByteStart = initStart + Math.ceil(bitstreamBitOffset / 8)
  const bitstreamSize = bodyEnd - bitstreamByteStart
  console.log(`\nBitstream at 0x${bitstreamByteStart.toString(16)} (bit offset ${bitstreamBitOffset})`)
  console.log(`Bitstream bytes: ${bitstreamSize}`)
  console.log(`Expected for ${segFrames-1} frames: ${Math.ceil(sumBW*3*(segFrames-1)/8)} bytes`)
  console.log(`Expected for ${segFrames} frames: ${Math.ceil(sumBW*3*segFrames/8)} bytes`)

  // Try reading first few frames from the bitstream
  // Continue from where initials ended (bitstream follows immediately)
  console.log(`\nDecoded per-frame values:`)
  for (let f = 0; f < Math.min(5, segFrames); f++) {
    if (f === 0) {
      console.log(`  Frame ${segStart}:`)
      for (let ch = 0; ch < Math.min(4, totalAnim); ch++) {
        const [qx, qy, qz] = initValues[ch]
        const maxQ = (1 << bw[ch]) - 1
        const h = headers[ch]
        const x = maxQ > 0 ? h.offset[0] + (qx / maxQ) * h.scale[0] : h.offset[0]
        const y = maxQ > 0 ? h.offset[1] + (qy / maxQ) * h.scale[1] : h.offset[1]
        const z = maxQ > 0 ? h.offset[2] + (qz / maxQ) * h.scale[2] : h.offset[2]
        const label = ch < rAnim ? `rot[${ch}]` : ch < rAnim + tAnim ? `pos[${ch-rAnim}]` : `scl[${ch-rAnim-tAnim}]`
        console.log(`    ${label} q=[${qx},${qy},${qz}] → [${x.toFixed(4)}, ${y.toFixed(4)}, ${z.toFixed(4)}]`)
      }
    } else {
      console.log(`  Frame ${segStart + f}:`)
      for (let ch = 0; ch < Math.min(4, totalAnim); ch++) {
        const qx = reader.readLSB(bw[ch])
        const qy = reader.readLSB(bw[ch])
        const qz = reader.readLSB(bw[ch])
        const maxQ = (1 << bw[ch]) - 1
        const h = headers[ch]
        const x = maxQ > 0 ? h.offset[0] + (qx / maxQ) * h.scale[0] : h.offset[0]
        const y = maxQ > 0 ? h.offset[1] + (qy / maxQ) * h.scale[1] : h.offset[1]
        const z = maxQ > 0 ? h.offset[2] + (qz / maxQ) * h.scale[2] : h.offset[2]
        const label = ch < rAnim ? `rot[${ch}]` : ch < rAnim + tAnim ? `pos[${ch-rAnim}]` : `scl[${ch-rAnim-tAnim}]`
        console.log(`    ${label} q=[${qx},${qy},${qz}] → [${x.toFixed(4)}, ${y.toFixed(4)}, ${z.toFixed(4)}]`)
      }
      // Skip remaining channels
      for (let ch = 4; ch < totalAnim; ch++) {
        reader.readLSB(bw[ch])
        reader.readLSB(bw[ch])
        reader.readLSB(bw[ch])
      }
    }
  }

  // Also check: after reading ALL frames, does the reader end at the body end?
  const totalBitsUsed = bitstreamBitOffset + sumBW * 3 * (segFrames - 1)
  const totalBytesUsed = totalAnim + Math.ceil(totalBitsUsed / 8)
  console.log(`\nTotal bytes used (bw + initials + ${segFrames-1} frames): ${totalBytesUsed}`)
  console.log(`Body size: ${bodySize}`)
  console.log(`Match: ${totalBytesUsed === bodySize ? 'YES' : `NO (diff=${bodySize - totalBytesUsed})`}`)

  // Try with ALL frames in bitstream (initials are frame 0 of bitstream)
  const totalBitsAll = sumBW * 3 * segFrames
  const totalBytesAll = totalAnim + Math.ceil(totalBitsAll / 8)
  console.log(`Total bytes (bw + ${segFrames} frames): ${totalBytesAll}`)
  console.log(`Match: ${totalBytesAll === bodySize ? 'YES' : `NO (diff=${bodySize - totalBytesAll})`}`)

  // Check smoothness: are consecutive frame values close to each other?
  console.log(`\nSmoothness check (channel 0, all frames):`)
  const ch0reader = new BitReader(data, initStart)
  const ch0values: number[][] = []

  // Read initial value for ch0
  const q0x = ch0reader.readLSB(bw[0])
  const q0y = ch0reader.readLSB(bw[0])
  const q0z = ch0reader.readLSB(bw[0])
  const maxQ0 = (1 << bw[0]) - 1
  const h0 = headers[0]
  ch0values.push([
    h0.offset[0] + (q0x / maxQ0) * h0.scale[0],
    h0.offset[1] + (q0y / maxQ0) * h0.scale[1],
    h0.offset[2] + (q0z / maxQ0) * h0.scale[2],
  ])

  // Skip remaining channel initials
  for (let ch = 1; ch < totalAnim; ch++) {
    ch0reader.readLSB(bw[ch])
    ch0reader.readLSB(bw[ch])
    ch0reader.readLSB(bw[ch])
  }

  // Read per-frame values for ch0
  for (let f = 1; f < segFrames; f++) {
    const qx = ch0reader.readLSB(bw[0])
    const qy = ch0reader.readLSB(bw[0])
    const qz = ch0reader.readLSB(bw[0])
    ch0values.push([
      h0.offset[0] + (qx / maxQ0) * h0.scale[0],
      h0.offset[1] + (qy / maxQ0) * h0.scale[1],
      h0.offset[2] + (qz / maxQ0) * h0.scale[2],
    ])
    // Skip remaining channels
    for (let ch = 1; ch < totalAnim; ch++) {
      ch0reader.readLSB(bw[ch])
      ch0reader.readLSB(bw[ch])
      ch0reader.readLSB(bw[ch])
    }
  }

  console.log(`  Channel 0 (pos[0]) values over ${segFrames} frames:`)
  for (let f = 0; f < segFrames; f++) {
    const v = ch0values[f]
    console.log(`    f${segStart + f}: [${v.map(x => x.toFixed(4)).join(', ')}]`)
  }

  // Check if values are smooth (small deltas between consecutive frames)
  let maxDelta = 0
  for (let f = 1; f < ch0values.length; f++) {
    for (let c = 0; c < 3; c++) {
      const delta = Math.abs(ch0values[f][c] - ch0values[f-1][c])
      if (delta > maxDelta) maxDelta = delta
    }
  }
  console.log(`  Max delta between consecutive frames: ${maxDelta.toFixed(6)}`)
  console.log(`  Values ${maxDelta < 5 ? 'SMOOTH' : 'NOT smooth'} (threshold=5)`)
}
