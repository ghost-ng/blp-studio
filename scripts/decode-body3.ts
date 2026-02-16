#!/usr/bin/env npx tsx
/**
 * Decode V1 animation body - test uint16 initial values hypothesis.
 *
 * Hypothesis: body layout per segment is:
 *   1. totalAnim bytes: bit widths per channel
 *   2. totalAnim × 6 bytes: initial values as uint16_LE × 3 (xyz) per channel
 *   3. Bitstream: continuous bit-packed data for ALL segFrames frames
 */

import { readFileSync } from 'fs'
import { resolve } from 'path'

const filepath = resolve(process.argv[2] || '')
const data = readFileSync(filepath)
const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
const u32 = (o: number) => view.getUint32(o, true)
const u16 = (o: number) => view.getUint16(o, true)
const f32 = (o: number) => view.getFloat32(o, true)

const AC = 0x60
const BASE = AC + 0x20

const frameCount = u32(0x0C)
const boneCount = u32(AC + 0x10)
const count1 = u32(AC + 0x20)
const valA = u32(AC + 0x34)
const valB = u32(AC + 0x38)
const valC = u32(AC + 0x3C)
const secOff = [u32(AC + 0x44), u32(AC + 0x48), u32(AC + 0x4C), u32(AC + 0x50)]

let cursor = AC + 0x44 + 16
const frameBounds: number[] = []
if (count1 >= 2) {
  for (let i = 0; i < count1; i++) { frameBounds.push(u32(cursor)); cursor += 4 }
  cursor += 4
} else { frameBounds.push(0) }

const segGroups: number[][] = []
for (let s = 0; s < count1; s++) {
  segGroups.push([u32(cursor), u32(cursor+4), u32(cursor+8), u32(cursor+12)])
  cursor += 16
}

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

// Read animated headers [offset_xyz, scale_xyz]
interface AnimHeader { offset: [number,number,number]; scale: [number,number,number] }
const headers: AnimHeader[] = []
for (let i = 0; i < totalAnim; i++) {
  headers.push({
    offset: [f32(cursor), f32(cursor+4), f32(cursor+8)],
    scale:  [f32(cursor+12), f32(cursor+16), f32(cursor+20)],
  })
  cursor += 24
}

console.log(`bones=${boneCount} frames=${frameCount} segs=${count1}`)
console.log(`rAnim=${rAnim} tAnim=${tAnim} sAnim=${sAnim} total=${totalAnim}`)

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
  get bitPosition() { return this.pos }
}

function dequant(q: number, bw: number, offset: number, scale: number): number {
  const maxQ = (1 << bw) - 1
  return maxQ > 0 ? offset + (q / maxQ) * scale : offset
}

// Process all segments
for (let seg = 0; seg < count1; seg++) {
  const g = segGroups[seg]
  if (g[0] === 0) continue

  const segStart = frameBounds[seg]
  const segEnd = seg < count1 - 1 ? frameBounds[seg + 1] : frameCount
  const segFrames = segEnd - segStart

  const bodyStart = BASE + g[3]
  const bodyEnd = seg < count1 - 1 ? BASE + segGroups[seg + 1][3] : AC + u32(AC + 0x00)
  const bodySize = bodyEnd - bodyStart

  // 1. Read bit widths
  const bw: number[] = []
  for (let i = 0; i < totalAnim; i++) bw.push(data[bodyStart + i])
  const sumBW = bw.reduce((a, b) => a + b, 0)
  const bitsPerFrame = sumBW * 3

  console.log(`\n--- Segment ${seg}: frames ${segStart}..${segEnd-1} (${segFrames} frames) ---`)
  console.log(`g=[${g.join(',')}] bodyStart=0x${bodyStart.toString(16)} bodySize=${bodySize}`)
  console.log(`bw=[${bw.join(',')}] sumBW=${sumBW} bitsPerFrame=${bitsPerFrame}`)

  // 2. Read uint16 initial values
  const initStart = bodyStart + totalAnim
  console.log(`\nUint16 initials at 0x${initStart.toString(16)} (${totalAnim*6} bytes):`)
  const initValues: [number,number,number][] = []
  for (let ch = 0; ch < totalAnim; ch++) {
    const off = initStart + ch * 6
    const qx = u16(off)
    const qy = u16(off + 2)
    const qz = u16(off + 4)
    initValues.push([qx, qy, qz])

    const maxQ = (1 << bw[ch]) - 1
    const h = headers[ch]
    const x = dequant(qx, bw[ch], h.offset[0], h.scale[0])
    const y = dequant(qy, bw[ch], h.offset[1], h.scale[1])
    const z = dequant(qz, bw[ch], h.offset[2], h.scale[2])

    const label = ch < rAnim ? `rot[${ch}]` : ch < rAnim + tAnim ? `pos[${ch-rAnim}]` : `scl[${ch-rAnim-tAnim}]`
    if (seg === 0 && ch < 6) {
      console.log(`  ${label} bw=${bw[ch]} raw=[${qx},${qy},${qz}] maxQ=${maxQ} → [${x.toFixed(4)}, ${y.toFixed(4)}, ${z.toFixed(4)}]`)
    }
  }

  // 3. Bitstream
  const bitstreamStart = initStart + totalAnim * 6
  const bitstreamBytes = bodyEnd - bitstreamStart
  console.log(`\nBitstream at 0x${bitstreamStart.toString(16)} (${bitstreamBytes} bytes)`)

  // Check size: totalAnim + totalAnim*6 + bitstreamBytes = bodySize?
  const expectedBitstream_continuous = Math.ceil(bitsPerFrame * segFrames / 8)
  const expectedBitstream_noInit = Math.ceil(bitsPerFrame * (segFrames - 1) / 8)
  console.log(`Bitstream bytes available: ${bitstreamBytes}`)
  console.log(`Expected (${segFrames} frames, continuous): ${expectedBitstream_continuous}`)
  console.log(`Expected (${segFrames-1} frames, continuous): ${expectedBitstream_noInit}`)
  console.log(`Size calc: ${totalAnim} + ${totalAnim*6} + ${bitstreamBytes} = ${totalAnim + totalAnim*6 + bitstreamBytes} vs bodySize=${bodySize}`)

  // Try decoding bitstream
  const reader = new BitReader(data, bitstreamStart)

  // Decode all frames from bitstream and check smoothness vs initials
  const allValues: number[][][] = [] // [frame][channel][xyz]

  // Frame 0 = initials (uint16)
  const frame0: number[][] = []
  for (let ch = 0; ch < totalAnim; ch++) {
    const [qx, qy, qz] = initValues[ch]
    const h = headers[ch]
    frame0.push([
      dequant(qx, bw[ch], h.offset[0], h.scale[0]),
      dequant(qy, bw[ch], h.offset[1], h.scale[1]),
      dequant(qz, bw[ch], h.offset[2], h.scale[2]),
    ])
  }
  allValues.push(frame0)

  // Remaining frames from bitstream (segFrames - 1 frames)
  for (let f = 1; f < segFrames; f++) {
    const frame: number[][] = []
    for (let ch = 0; ch < totalAnim; ch++) {
      const qx = reader.readLSB(bw[ch])
      const qy = reader.readLSB(bw[ch])
      const qz = reader.readLSB(bw[ch])
      const h = headers[ch]
      frame.push([
        dequant(qx, bw[ch], h.offset[0], h.scale[0]),
        dequant(qy, bw[ch], h.offset[1], h.scale[1]),
        dequant(qz, bw[ch], h.offset[2], h.scale[2]),
      ])
    }
    allValues.push(frame)
  }

  // Also try: ALL segFrames frames from bitstream (initials separate as frame-0 override)
  const reader2 = new BitReader(data, bitstreamStart)
  const allValues2: number[][][] = []
  for (let f = 0; f < segFrames; f++) {
    const frame: number[][] = []
    for (let ch = 0; ch < totalAnim; ch++) {
      const qx = reader2.readLSB(bw[ch])
      const qy = reader2.readLSB(bw[ch])
      const qz = reader2.readLSB(bw[ch])
      const h = headers[ch]
      frame.push([
        dequant(qx, bw[ch], h.offset[0], h.scale[0]),
        dequant(qy, bw[ch], h.offset[1], h.scale[1]),
        dequant(qz, bw[ch], h.offset[2], h.scale[2]),
      ])
    }
    allValues2.push(frame)
  }

  // Check: does bitstream frame 0 match uint16 initials?
  if (allValues2.length > 0) {
    let initMatch = true
    for (let ch = 0; ch < totalAnim; ch++) {
      for (let c = 0; c < 3; c++) {
        if (Math.abs(allValues2[0][ch][c] - frame0[ch][c]) > 0.001) {
          initMatch = false
          break
        }
      }
      if (!initMatch) break
    }
    console.log(`Bitstream frame 0 matches uint16 initials: ${initMatch}`)
  }

  // Smoothness check approach 1: initials as frame 0, bitstream for frames 1..N-1
  let maxDelta1 = 0
  for (let ch = 0; ch < totalAnim; ch++) {
    for (let f = 1; f < allValues.length; f++) {
      for (let c = 0; c < 3; c++) {
        const delta = Math.abs(allValues[f][ch][c] - allValues[f-1][ch][c])
        if (delta > maxDelta1) maxDelta1 = delta
      }
    }
  }

  // Smoothness check approach 2: all frames from bitstream
  let maxDelta2 = 0
  for (let ch = 0; ch < totalAnim; ch++) {
    for (let f = 1; f < allValues2.length; f++) {
      for (let c = 0; c < 3; c++) {
        const delta = Math.abs(allValues2[f][ch][c] - allValues2[f-1][ch][c])
        if (delta > maxDelta2) maxDelta2 = delta
      }
    }
  }

  const bitsUsed1 = reader.bitPosition
  const bitsUsed2 = reader2.bitPosition

  console.log(`\nApproach 1 (init separate, ${segFrames-1} bitstream frames):`)
  console.log(`  Bits used: ${bitsUsed1} = ${Math.ceil(bitsUsed1/8)} bytes`)
  console.log(`  Total body: ${totalAnim + totalAnim*6 + Math.ceil(bitsUsed1/8)} vs ${bodySize} (diff=${bodySize - totalAnim - totalAnim*6 - Math.ceil(bitsUsed1/8)})`)
  console.log(`  MaxDelta: ${maxDelta1.toFixed(4)} ${maxDelta1 < 10 ? 'smooth' : 'JUMPY'}`)

  console.log(`\nApproach 2 (all ${segFrames} frames from bitstream):`)
  console.log(`  Bits used: ${bitsUsed2} = ${Math.ceil(bitsUsed2/8)} bytes`)
  console.log(`  Total body: ${totalAnim + totalAnim*6 + Math.ceil(bitsUsed2/8)} vs ${bodySize} (diff=${bodySize - totalAnim - totalAnim*6 - Math.ceil(bitsUsed2/8)})`)
  console.log(`  MaxDelta: ${maxDelta2.toFixed(4)} ${maxDelta2 < 10 ? 'smooth' : 'JUMPY'}`)

  // Print first few frames for channel 0
  if (seg === 0) {
    console.log(`\n  Channel 0 values (approach 2, all bitstream):`)
    for (let f = 0; f < Math.min(5, segFrames); f++) {
      const v = allValues2[f][0]
      console.log(`    f${segStart+f}: [${v.map(x => x.toFixed(4)).join(', ')}]`)
    }
    console.log(`  vs uint16 initials for ch0:`)
    const v = frame0[0]
    console.log(`    init: [${v.map(x => x.toFixed(4)).join(', ')}]`)
  }
}
