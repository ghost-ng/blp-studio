#!/usr/bin/env npx tsx
/**
 * Dump raw bytes of body sections to understand the layout.
 * Compare the "extra" region between consumed bitstream and body end.
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
const rAnim = Array.from({length: boneCount}, (_, b) => channelTypes[b] ?? 0).filter(v => v === 2).length
const tAnim = Array.from({length: boneCount}, (_, b) => channelTypes[boneCount + b] ?? 0).filter(v => v === 2).length
const sAnim = Array.from({length: boneCount}, (_, b) => channelTypes[2 * boneCount + b] ?? 0).filter(v => v === 2).length
const totalAnim = rAnim + tAnim + sAnim

console.log(`bones=${boneCount} frames=${frameCount} segs=${count1}`)
console.log(`rAnim=${rAnim} tAnim=${tAnim} sAnim=${sAnim} total=${totalAnim}`)
console.log(`File size: ${data.length} bytes`)

for (let seg = 0; seg < count1; seg++) {
  const g = segGroups[seg]
  if (g[0] === 0) continue

  const segStart = frameBounds[seg]
  const segEnd = seg < count1 - 1 ? frameBounds[seg + 1] : frameCount
  const segFrames = segEnd - segStart

  const bodyStart = BASE + g[3]
  const bodyEnd = seg < count1 - 1 ? BASE + segGroups[seg + 1][3] : AC + u32(AC + 0x00)
  const bodySize = bodyEnd - bodyStart

  const bw: number[] = []
  for (let i = 0; i < totalAnim; i++) bw.push(data[bodyStart + i])
  const sumBW = bw.reduce((a, b) => a + b, 0)
  const bitsPerFrame = sumBW * 3

  // Where does the consumed bitstream end? (old approach: continuous from after bw)
  const bitstreamConsumed = Math.ceil(bitsPerFrame * segFrames / 8)
  const consumed = totalAnim + bitstreamConsumed
  const extraStart = bodyStart + consumed
  const extraBytes = bodyEnd - extraStart

  console.log(`\n--- Segment ${seg}: ${segFrames} frames, bitsPerFrame=${bitsPerFrame} ---`)
  console.log(`bodyStart=0x${bodyStart.toString(16)} bodyEnd=0x${bodyEnd.toString(16)} bodySize=${bodySize}`)
  console.log(`consumed=${consumed} extra=${extraBytes} bytes at 0x${extraStart.toString(16)}`)

  // Dump extra bytes
  if (extraBytes > 0 && extraBytes < 500) {
    // As hex
    const hexLines: string[] = []
    for (let row = 0; row < Math.ceil(Math.min(extraBytes, 128) / 16); row++) {
      const off = extraStart + row * 16
      const bytes: string[] = []
      for (let i = 0; i < 16 && off + i < bodyEnd; i++) {
        bytes.push(data[off + i].toString(16).padStart(2, '0'))
      }
      hexLines.push(`  0x${off.toString(16)}: ${bytes.join(' ')}`)
    }
    console.log(`Hex dump of extra region:`)
    hexLines.forEach(l => console.log(l))

    // As uint16
    console.log(`As uint16 LE:`)
    const u16count = Math.min(Math.floor(extraBytes / 2), 32)
    for (let i = 0; i < u16count; i++) {
      const off = extraStart + i * 2
      const v = u16(off)
      console.log(`  [${i}] = ${v} (0x${v.toString(16).padStart(4, '0')})`)
    }

    // Check: does this look like per-channel uint16 xyz triples?
    if (extraBytes >= totalAnim * 2) {
      console.log(`\nAs per-channel uint16 values (${totalAnim} channels):`)
      for (let ch = 0; ch < Math.min(totalAnim, 8); ch++) {
        const off = extraStart + ch * 2
        if (off + 2 <= bodyEnd) {
          const v = u16(off)
          console.log(`  ch${ch}: ${v} (bw=${bw[ch]}, maxQ=${(1 << bw[ch])-1})`)
        }
      }
    }

    // Check if all zeros
    let allZero = true
    for (let i = 0; i < extraBytes; i++) {
      if (data[extraStart + i] !== 0) { allZero = false; break }
    }
    console.log(`All zeros: ${allZero}`)

    // Check for patterns
    const byteFreq: Record<number, number> = {}
    for (let i = 0; i < extraBytes; i++) {
      const b = data[extraStart + i]
      byteFreq[b] = (byteFreq[b] || 0) + 1
    }
    const uniqueBytes = Object.keys(byteFreq).length
    console.log(`Unique byte values: ${uniqueBytes}/256`)
    console.log(`Byte entropy estimate: ${uniqueBytes < 10 ? 'LOW (likely padding/structured)' : 'HIGH (likely data)'}`)
  }
}
