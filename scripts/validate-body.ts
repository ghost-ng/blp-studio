#!/usr/bin/env npx tsx
/**
 * Validate V1 animation body decoding across ALL segments in ALL files.
 * Reports: bit width stats, size match, smoothness, rotation channel presence.
 */

import { readFileSync, readdirSync } from 'fs'
import { resolve, join } from 'path'

const dir = resolve(process.argv[2] || '')
const files = readdirSync(dir).filter(f => f.endsWith('.anim'))

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
  set bitPosition(p: number) { this.pos = p }
}

interface SegResult {
  segIdx: number
  frames: number
  bodySize: number
  consumed: number
  diff: number
  maxDelta: number
  smooth: boolean
}

let totalFiles = 0
let totalSegs = 0
let totalMatch = 0
let totalSmooth = 0
let hasRotAnim = false

for (const file of files) {
  const filepath = join(dir, file)
  const data = readFileSync(filepath)
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const u32 = (o: number) => view.getUint32(o, true)
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

  if (rAnim > 0) hasRotAnim = true

  cursor += bfSize
  cursor += valA * 12 + valB * 12 + valC * 12

  // Read animated headers
  interface AnimHeader { offset: [number,number,number]; scale: [number,number,number] }
  const headers: AnimHeader[] = []
  for (let i = 0; i < totalAnim; i++) {
    headers.push({
      offset: [f32(cursor), f32(cursor+4), f32(cursor+8)],
      scale:  [f32(cursor+12), f32(cursor+16), f32(cursor+20)],
    })
    cursor += 24
  }

  totalFiles++
  const results: SegResult[] = []

  for (let seg = 0; seg < count1; seg++) {
    const g = segGroups[seg]
    if (g[0] === 0) continue

    const segStart = frameBounds[seg]
    const segEnd = seg < count1 - 1 ? frameBounds[seg + 1] : frameCount
    const segFrames = segEnd - segStart

    const bodyStart = BASE + g[3]
    const bodyEnd = seg < count1 - 1 ? BASE + segGroups[seg + 1][3] : AC + u32(AC + 0x00)
    const bodySize = bodyEnd - bodyStart

    // Read bit widths
    const bw: number[] = []
    for (let i = 0; i < totalAnim; i++) bw.push(data[bodyStart + i])
    const sumBW = bw.reduce((a, b) => a + b, 0)

    // Read initial values
    const initStart = bodyStart + totalAnim
    const reader = new BitReader(data, initStart)
    const initValues: number[][] = []
    for (let ch = 0; ch < totalAnim; ch++) {
      const x = reader.readLSB(bw[ch])
      const y = reader.readLSB(bw[ch])
      const z = reader.readLSB(bw[ch])
      initValues.push([x, y, z])
    }

    // Decode all frames for smoothness check
    const allValues: number[][][] = [] // [frame][channel][xyz]
    // Frame 0 = initials
    const frame0: number[][] = []
    for (let ch = 0; ch < totalAnim; ch++) {
      const [qx, qy, qz] = initValues[ch]
      const maxQ = (1 << bw[ch]) - 1
      const h = headers[ch]
      frame0.push([
        maxQ > 0 ? h.offset[0] + (qx / maxQ) * h.scale[0] : h.offset[0],
        maxQ > 0 ? h.offset[1] + (qy / maxQ) * h.scale[1] : h.offset[1],
        maxQ > 0 ? h.offset[2] + (qz / maxQ) * h.scale[2] : h.offset[2],
      ])
    }
    allValues.push(frame0)

    // Frames 1..N-1
    for (let f = 1; f < segFrames; f++) {
      const frame: number[][] = []
      for (let ch = 0; ch < totalAnim; ch++) {
        const qx = reader.readLSB(bw[ch])
        const qy = reader.readLSB(bw[ch])
        const qz = reader.readLSB(bw[ch])
        const maxQ = (1 << bw[ch]) - 1
        const h = headers[ch]
        frame.push([
          maxQ > 0 ? h.offset[0] + (qx / maxQ) * h.scale[0] : h.offset[0],
          maxQ > 0 ? h.offset[1] + (qy / maxQ) * h.scale[1] : h.offset[1],
          maxQ > 0 ? h.offset[2] + (qz / maxQ) * h.scale[2] : h.offset[2],
        ])
      }
      allValues.push(frame)
    }

    // Size check
    const totalBitsUsed = reader.bitPosition
    const consumed = totalAnim + Math.ceil(totalBitsUsed / 8)
    const diff = bodySize - consumed

    // Smoothness check across ALL channels
    let maxDelta = 0
    for (let ch = 0; ch < totalAnim; ch++) {
      for (let f = 1; f < allValues.length; f++) {
        for (let c = 0; c < 3; c++) {
          const delta = Math.abs(allValues[f][ch][c] - allValues[f-1][ch][c])
          if (delta > maxDelta) maxDelta = delta
        }
      }
    }

    totalSegs++
    if (diff === 0) totalMatch++
    if (maxDelta < 10) totalSmooth++

    results.push({ segIdx: seg, frames: segFrames, bodySize, consumed, diff, maxDelta, smooth: maxDelta < 10 })
  }

  // Print per-file summary
  const maxDiff = Math.max(...results.map(r => Math.abs(r.diff)))
  const allSmooth = results.every(r => r.smooth)
  const status = allSmooth ? 'OK' : 'WARN'
  console.log(`${status} ${file}: bones=${boneCount} frames=${frameCount} segs=${count1} rAnim=${rAnim} tAnim=${tAnim} sAnim=${sAnim}`)
  for (const r of results) {
    const sizeStatus = r.diff === 0 ? 'EXACT' : `+${r.diff}B`
    console.log(`  seg${r.segIdx}: ${r.frames}f body=${r.bodySize} used=${r.consumed} ${sizeStatus} maxDelta=${r.maxDelta.toFixed(3)} ${r.smooth ? 'smooth' : 'JUMPY'}`)
  }
}

console.log(`\n=== SUMMARY ===`)
console.log(`Files: ${totalFiles}`)
console.log(`Segments: ${totalSegs} (${totalSmooth} smooth, ${totalSegs - totalSmooth} jumpy)`)
console.log(`Size exact matches: ${totalMatch}/${totalSegs}`)
console.log(`Has rotation animated channels: ${hasRotAnim}`)
