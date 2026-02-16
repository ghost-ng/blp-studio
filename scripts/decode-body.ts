#!/usr/bin/env npx tsx
/**
 * Try to decode V1 animation body using bit-packed quantized values.
 *
 * Hypothesis:
 * - Body starts with N bytes of bit widths (one per animated channel)
 * - Followed by initial values (uint8 per component per channel?)
 * - Then bit-packed quantized deltas or values for each frame
 */

import { readFileSync } from 'fs'
import { resolve } from 'path'

const filepath = resolve(process.argv[2] || '')
const data = readFileSync(filepath)
const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
const u32 = (o: number) => view.getUint32(o, true)
const f32 = (o: number) => view.getFloat32(o, true)

if (u32(0) !== 0x6AB06AB0 || u32(0x48) === 0xFFFFFFFF) {
  console.error('Not a V1 animation'); process.exit(1)
}

const AC = 0x60
const frameCount = u32(0x0C)
const boneCount = u32(AC + 0x10)
const count1 = u32(AC + 0x20)
const valA = u32(AC + 0x34)
const valB = u32(AC + 0x38)
const valC = u32(AC + 0x3C)
const secOff = [u32(AC + 0x44), u32(AC + 0x48), u32(AC + 0x4C), u32(AC + 0x50)]

// Navigate to bitfield
let cursor = AC + 0x44 + 16
if (count1 >= 2) cursor += count1 * 4 + 4
const segGroups: number[][] = []
for (let s = 0; s < count1; s++) {
  segGroups.push([u32(cursor), u32(cursor + 4), u32(cursor + 8), u32(cursor + 12)])
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

// Skip constant data
cursor += valA * 12 + valB * 12 + valC * 12

// Read animated headers
interface AnimHeader { base: [number, number, number]; range: [number, number, number] }
const headers: AnimHeader[] = []
for (let i = 0; i < totalAnim; i++) {
  headers.push({
    base: [f32(cursor), f32(cursor + 4), f32(cursor + 8)],
    range: [f32(cursor + 12), f32(cursor + 16), f32(cursor + 20)],
  })
  cursor += 24
}

// Compute reference base for secOff/g values
// secOff[1] maps to bitfield start, so base = bitfieldStart - secOff[1]
// But we computed bitfield at the cursor position before reading bitfield.
// Let me compute: base = where secOff[3] points (end of constants = start of animated headers)
const bitfieldStart_actual = cursor - totalAnim * 24 - valA * 12 - valB * 12 - valC * 12 - bfSize
// Actually simpler: cursor now points just past animated headers

console.log(`File: ${filepath}`)
console.log(`bones=${boneCount} frames=${frameCount} count1=${count1}`)
console.log(`rAnim=${rAnim} tAnim=${tAnim} sAnim=${sAnim} total=${totalAnim}`)
console.log(`Cursor after animated headers: 0x${cursor.toString(16)}`)
console.log(`Segment groups:`)

// Frame boundaries
let frameBoundsStart = AC + 0x44 + 16
const frameBounds: number[] = []
if (count1 >= 2) {
  for (let i = 0; i < count1; i++) { frameBounds.push(u32(frameBoundsStart + i * 4)) }
} else {
  frameBounds.push(0)
}

for (let s = 0; s < count1; s++) {
  const g = segGroups[s]
  const segStart = frameBounds[s]
  const segEnd = s < count1 - 1 ? frameBounds[s + 1] : frameCount
  console.log(`  seg[${s}]: g=[${g.join(',')}] frames=${segStart}..${segEnd-1} (${segEnd-segStart} frames)`)
}

// Body starts right at cursor (after animated headers)
const bodyStart = cursor
console.log(`\nBody starts at 0x${bodyStart.toString(16)}`)

// For each segment, analyze the body
for (let s = 0; s < count1; s++) {
  const g = segGroups[s]
  if (g[0] === 0) continue // no animated data in this segment

  const segStart = frameBounds[s]
  const segEnd = s < count1 - 1 ? frameBounds[s + 1] : frameCount
  const segFrames = segEnd - segStart

  // Compute segment body location
  // g[3] and secOff values share a reference base
  // body for segment s starts at bodyStart + (g[3] - (first segment g[3]))
  // Actually, for segment 0 the body starts right at bodyStart
  // For segment 1, at bodyStart + (g1[3] - g0[3])... let me check

  // Compute body offsets relative to the base reference
  // The headers are shared, so the per-segment body is offset by g[3]
  // All segments share the animated headers, so the body for each segment
  // is at different offsets. Let me compute relative to cursor.

  // Actually, let me compute the absolute position:
  // The base for secOff/g is: cursor_of_headers - secOff[3]
  // Because animated headers are at secOff[3]
  const base = cursor - 24 * totalAnim - (secOff[3] - secOff[2])
  // Hmm, this is getting complicated. Let me just use the pattern:
  // base = (bitfield start) - (secOff[2] - secOff[1]) ... no

  // Simplest: compute base from known anchor points
  // secOff[3] maps to the start of animated headers
  // animated headers start at cursor - totalAnim * 24
  const headersStart = cursor - totalAnim * 24
  const refBase = headersStart - secOff[3] + secOff[2]

  // Wait, constant data section: secOff[3]-secOff[2] = constant data size
  // Constant data starts at: headersStart - (secOff[3]-secOff[2])
  // Hmm, constant data is secOff[3]-secOff[2] bytes, and starts at headersStart - constSize

  // Let me just try: the reference for g[3] is the same as for secOff
  // Find it: secOff[2] maps to start of constant data, secOff[3] maps to start of animated headers
  // constantStart = headersStart - (secOff[3] - secOff[2])... no, that assumes constants are between secOff[2] and secOff[3]

  // Actually, secOff[2] - secOff[1] = bitfield size
  // secOff[3] - secOff[2] = constant data size
  // secOff[1] - secOff[0] = segment groups size
  //
  // And the file layout is:
  // [frame bounds] [seg groups] [bitfield] [constants] [animated headers] [body data]
  //
  // secOff[0] → start of seg groups
  // secOff[1] → start of bitfield
  // secOff[2] → start of constants
  // secOff[3] → start of animated headers
  // g[3] → start of segment body data
  //
  // All relative to same base = start of frame bounds = AC + 0x44 + 16 = the cursor just after the secOff array

  const dataBase = AC + 0x44 + 16 // right after secOff[0..3]
  const segBodyStart = dataBase + g[3]

  console.log(`\n--- Segment ${s} (frames ${segStart}..${segEnd-1}, ${segFrames} frames) ---`)
  console.log(`  g=[${g.join(',')}]`)
  console.log(`  segBodyStart = 0x${segBodyStart.toString(16)} (dataBase=0x${dataBase.toString(16)} + g[3]=${g[3]})`)

  // Verify: for segment 0, segBodyStart should be right after animated headers
  if (s === 0) {
    console.log(`  Expected body at cursor: 0x${cursor.toString(16)}`)
    console.log(`  Match: ${segBodyStart === cursor ? 'YES' : `NO (diff=${segBodyStart - cursor})`}`)
  }

  const segBodyEnd = s < count1 - 1
    ? dataBase + segGroups[s + 1][3]
    : AC + u32(AC + 0x00) // dataSize gives end

  const segBodySize = segBodyEnd - segBodyStart
  console.log(`  segBodySize = ${segBodySize} bytes (to 0x${segBodyEnd.toString(16)})`)

  if (segBodyStart >= data.length || segBodyStart + 4 > data.length) continue

  // Read first bytes of segment body
  console.log(`\n  First 64 bytes of segment body:`)
  const showLen = Math.min(64, data.length - segBodyStart)
  for (let row = 0; row < Math.ceil(showLen / 16); row++) {
    const off = segBodyStart + row * 16
    const bytes: string[] = []
    for (let i = 0; i < 16; i++) {
      if (off + i < data.length) bytes.push(data[off + i].toString(16).padStart(2, '0'))
      else bytes.push('  ')
    }
    console.log(`    0x${off.toString(16)}: ${bytes.slice(0,8).join(' ')}  ${bytes.slice(8).join(' ')}`)
  }

  // Try interpretation: first totalAnim bytes are bit widths
  const bitWidths: number[] = []
  for (let i = 0; i < totalAnim; i++) {
    if (segBodyStart + i < data.length) bitWidths.push(data[segBodyStart + i])
  }
  console.log(`\n  Potential bit widths: [${bitWidths.join(', ')}]`)
  const sumBW = bitWidths.reduce((a, b) => a + b, 0)
  console.log(`  Sum bit widths: ${sumBW}`)
  console.log(`  Sum × 3 (per component): ${sumBW * 3}`)
  console.log(`  Sum × 3 × frames = ${sumBW * 3 * segFrames} bits = ${(sumBW * 3 * segFrames / 8).toFixed(1)} bytes`)

  // Check g[0] relationship
  console.log(`  g[0] = ${g[0]}`)
  console.log(`  g[0] / segFrames = ${(g[0] / segFrames).toFixed(4)}`)
  console.log(`  g[0] × 8 / (sumBW × 3) = ${(g[0] * 8 / (sumBW * 3)).toFixed(4)} frames`)

  // What if body after bit widths is: initial values + bitstream?
  const afterBW = segBodyStart + totalAnim
  console.log(`\n  After bit widths (0x${afterBW.toString(16)}), first 48 bytes:`)
  for (let i = 0; i < Math.min(48, data.length - afterBW); i += 16) {
    const bytes: string[] = []
    for (let j = 0; j < 16; j++) {
      if (afterBW + i + j < data.length) bytes.push(data[afterBW + i + j].toString(16).padStart(2, '0'))
    }
    console.log(`    [${i}]: ${bytes.join(' ')}`)
  }

  // Try reading initial quantized values (totalAnim × 3 uint8 = 48 bytes for 16 channels)
  const initVals: number[][] = []
  for (let ch = 0; ch < totalAnim; ch++) {
    const off = afterBW + ch * 3
    if (off + 3 > data.length) break
    initVals.push([data[off], data[off + 1], data[off + 2]])
  }
  if (initVals.length === totalAnim) {
    console.log(`\n  Initial values (uint8 per component × ${totalAnim} channels):`)
    for (let ch = 0; ch < totalAnim; ch++) {
      const iv = initVals[ch]
      const bw = bitWidths[ch]
      const maxQ = (1 << bw) - 1
      const h = headers[ch]
      // Decode: value = base + (quantized / maxQ) * (range - base)
      const dx = h.range[0] - h.base[0]
      const dy = h.range[1] - h.base[1]
      const dz = h.range[2] - h.base[2]
      const x = h.base[0] + (iv[0] / maxQ) * dx
      const y = h.base[1] + (iv[1] / maxQ) * dy
      const z = h.base[2] + (iv[2] / maxQ) * dz

      const label = ch < rAnim ? `rot[${ch}]` : ch < rAnim + tAnim ? `pos[${ch - rAnim}]` : `scl[${ch - rAnim - tAnim}]`
      console.log(`    ${label} bw=${bw} init=[${iv.join(',')}] maxQ=${maxQ} → [${x.toFixed(4)}, ${y.toFixed(4)}, ${z.toFixed(4)}]`)
    }

    // Bitstream starts after initial values
    const bitstreamStart = afterBW + totalAnim * 3
    const bitstreamSize = segBodyEnd - bitstreamStart
    console.log(`\n  Bitstream: 0x${bitstreamStart.toString(16)}, ${bitstreamSize} bytes = ${bitstreamSize * 8} bits`)
    console.log(`  Expected bits for ${segFrames - 1} delta frames: ${sumBW * 3 * (segFrames - 1)} bits = ${(sumBW * 3 * (segFrames - 1) / 8).toFixed(1)} bytes`)
    console.log(`  Expected bits for ${segFrames} frames: ${sumBW * 3 * segFrames} bits = ${(sumBW * 3 * segFrames / 8).toFixed(1)} bytes`)

    // Try reading bitstream with frame-major layout
    if (bitstreamStart + 10 < data.length) {
      console.log(`\n  Bitstream decode attempt (frame-major, 3 components per channel):`)
      let bitPos = 0
      const readBits = (n: number): number => {
        let val = 0
        for (let i = 0; i < n; i++) {
          const byteIdx = bitstreamStart + Math.floor(bitPos / 8)
          const bitIdx = bitPos % 8
          if (byteIdx < data.length) {
            val |= ((data[byteIdx] >> bitIdx) & 1) << i
          }
          bitPos++
        }
        return val
      }

      // Read first 3 frames
      for (let f = 0; f < Math.min(3, segFrames); f++) {
        console.log(`    Frame ${segStart + f}:`)
        for (let ch = 0; ch < Math.min(4, totalAnim); ch++) {
          const bw = bitWidths[ch]
          const maxQ = (1 << bw) - 1
          const h = headers[ch]
          const qx = readBits(bw)
          const qy = readBits(bw)
          const qz = readBits(bw)
          const dx = h.range[0] - h.base[0]
          const dy = h.range[1] - h.base[1]
          const dz = h.range[2] - h.base[2]
          const x = h.base[0] + (qx / maxQ) * dx
          const y = h.base[1] + (qy / maxQ) * dy
          const z = h.base[2] + (qz / maxQ) * dz

          const label = ch < rAnim ? `rot[${ch}]` : ch < rAnim + tAnim ? `pos[${ch - rAnim}]` : `scl[${ch - rAnim - tAnim}]`
          console.log(`      ${label} q=[${qx},${qy},${qz}]/${maxQ} → [${x.toFixed(4)}, ${y.toFixed(4)}, ${z.toFixed(4)}]`)
        }
        // Skip remaining channels
        for (let ch = 4; ch < totalAnim; ch++) {
          readBits(bitWidths[ch] * 3)
        }
      }

      // Also try reading with MSB-first bit order
      console.log(`\n  Bitstream decode (MSB-first):`)
      bitPos = 0
      const readBitsMSB = (n: number): number => {
        let val = 0
        for (let i = 0; i < n; i++) {
          const byteIdx = bitstreamStart + Math.floor(bitPos / 8)
          const bitIdx = 7 - (bitPos % 8)
          if (byteIdx < data.length) {
            val = (val << 1) | ((data[byteIdx] >> bitIdx) & 1)
          }
          bitPos++
        }
        return val
      }

      for (let f = 0; f < Math.min(3, segFrames); f++) {
        console.log(`    Frame ${segStart + f}:`)
        for (let ch = 0; ch < Math.min(4, totalAnim); ch++) {
          const bw = bitWidths[ch]
          const maxQ = (1 << bw) - 1
          const h = headers[ch]
          const qx = readBitsMSB(bw)
          const qy = readBitsMSB(bw)
          const qz = readBitsMSB(bw)
          const dx = h.range[0] - h.base[0]
          const dy = h.range[1] - h.base[1]
          const dz = h.range[2] - h.base[2]
          const x = h.base[0] + (qx / maxQ) * dx
          const y = h.base[1] + (qy / maxQ) * dy
          const z = h.base[2] + (qz / maxQ) * dz

          const label = ch < rAnim ? `rot[${ch}]` : ch < rAnim + tAnim ? `pos[${ch - rAnim}]` : `scl[${ch - rAnim - tAnim}]`
          console.log(`      ${label} q=[${qx},${qy},${qz}]/${maxQ} → [${x.toFixed(4)}, ${y.toFixed(4)}, ${z.toFixed(4)}]`)
        }
        for (let ch = 4; ch < totalAnim; ch++) {
          readBitsMSB(bitWidths[ch] * 3)
        }
      }
    }
  }

  // Only analyze first segment for now
  if (s >= 0) break
}
