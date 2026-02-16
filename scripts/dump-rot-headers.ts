#!/usr/bin/env npx tsx
/**
 * Dump animated headers for rotation channels to determine encoding type.
 * Check offset/scale ranges to identify if it's quaternion, euler, axis-angle, etc.
 */

import { readFileSync, readdirSync } from 'fs'
import { resolve, join } from 'path'

const dir = resolve(process.argv[2] || '')
const files = readdirSync(dir).filter(f => f.endsWith('.anim'))

for (const file of files) {
  const filepath = join(dir, file)
  const data = readFileSync(filepath)
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const u32 = (o: number) => view.getUint32(o, true)
  const f32 = (o: number) => view.getFloat32(o, true)

  const AC = 0x60
  const BASE = AC + 0x20
  const boneCount = u32(AC + 0x10)
  const count1 = u32(AC + 0x20)
  const valA = u32(AC + 0x34)
  const valB = u32(AC + 0x38)
  const valC = u32(AC + 0x3C)
  const secOff = [u32(AC + 0x44), u32(AC + 0x48), u32(AC + 0x4C), u32(AC + 0x50)]

  let cursor = AC + 0x44 + 16
  if (count1 >= 2) { cursor += count1 * 4 + 4 }
  cursor += count1 * 16

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

  if (rAnim === 0) continue

  cursor += bfSize
  cursor += valA * 12 + valB * 12 + valC * 12

  console.log(`${file}: rAnim=${rAnim} tAnim=${tAnim} sAnim=${sAnim}`)

  // Print rotation channel headers
  for (let i = 0; i < rAnim; i++) {
    const off = cursor + i * 24
    const offset = [f32(off), f32(off+4), f32(off+8)]
    const scale = [f32(off+12), f32(off+16), f32(off+20)]
    const min = offset.map((o, j) => o)
    const max = offset.map((o, j) => o + scale[j])
    console.log(`  rot[${i}]: offset=[${offset.map(v=>v.toFixed(6)).join(', ')}] scale=[${scale.map(v=>v.toFixed(6)).join(', ')}]`)
    console.log(`           range: x=[${min[0].toFixed(4)},${max[0].toFixed(4)}] y=[${min[1].toFixed(4)},${max[1].toFixed(4)}] z=[${min[2].toFixed(4)},${max[2].toFixed(4)}]`)
  }

  // Print first few position channel headers for comparison
  for (let i = 0; i < Math.min(3, tAnim); i++) {
    const off = cursor + (rAnim + i) * 24
    const offset = [f32(off), f32(off+4), f32(off+8)]
    const scale = [f32(off+12), f32(off+16), f32(off+20)]
    console.log(`  pos[${i}]: offset=[${offset.map(v=>v.toFixed(6)).join(', ')}] scale=[${scale.map(v=>v.toFixed(6)).join(', ')}]`)
  }

  // Also check constant rotation values to understand the encoding
  cursor = AC + 0x44 + 16
  if (count1 >= 2) { cursor += count1 * 4 + 4 }
  cursor += count1 * 16
  cursor += bfSize

  console.log(`  Constant rotations (valA=${valA}):`)
  for (let i = 0; i < Math.min(5, valA); i++) {
    console.log(`    constRot[${i}] = [${f32(cursor + i*12).toFixed(6)}, ${f32(cursor + i*12 + 4).toFixed(6)}, ${f32(cursor + i*12 + 8).toFixed(6)}]`)
  }

  console.log()
  break // Just check the first file with rotation channels
}
