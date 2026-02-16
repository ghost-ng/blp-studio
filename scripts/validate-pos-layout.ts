#!/usr/bin/env npx tsx
/**
 * Check whether position animated headers use interleaved [min_x, max_x, ...]
 * or grouped [min_x, min_y, min_z, max_x, max_y, max_z] layout.
 */
import { readFileSync, readdirSync } from 'fs'
import { resolve, join } from 'path'

const ANIM_MAGIC = 0x6AB06AB0

function main() {
  const dir = resolve(process.argv[2] || '')
  const files = readdirSync(dir).filter(f => f.endsWith('.anim'))

  let total = 0
  let interleavedOK = 0, groupedOK = 0

  for (const f of files) {
    const data = readFileSync(join(dir, f))
    if (data.length < 0xB4) continue
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
    if (view.getUint32(0, true) !== ANIM_MAGIC) continue
    if (view.getUint32(0x48, true) === 0xFFFFFFFF) continue

    const AC = 0x60
    const u32 = (o: number) => view.getUint32(o, true)
    const f32 = (o: number) => view.getFloat32(o, true)

    const boneCount = u32(AC + 0x10)
    const count1 = u32(AC + 0x20)
    const valA = u32(AC + 0x34)
    const valB = u32(AC + 0x38)
    const valC = u32(AC + 0x3C)
    const secOff1 = u32(AC + 0x48)
    const secOff2 = u32(AC + 0x4C)
    const secOff3 = u32(AC + 0x50)

    // Navigate to animated headers
    let cursor = AC + 0x44 + 16
    if (count1 >= 2) cursor += count1 * 4 + 4
    cursor += count1 * 16

    const bfSize = secOff2 - secOff1
    if (bfSize < 0 || bfSize > 10000) continue

    // Read bitfield to count animated channels
    const channelTypes: number[] = []
    const wordCount = Math.ceil(bfSize / 4)
    for (let w = 0; w < wordCount; w++) {
      const word = u32(cursor + w * 4)
      for (let i = 0; i < 16; i++) channelTypes.push((word >>> (i * 2)) & 3)
    }
    const rTypes: number[] = [], tTypes: number[] = []
    for (let b = 0; b < boneCount; b++) rTypes.push(channelTypes[b] ?? 0)
    for (let b = 0; b < boneCount; b++) tTypes.push(channelTypes[boneCount + b] ?? 0)
    const rAnim = rTypes.filter(v => v === 2).length
    const tAnim = tTypes.filter(v => v === 2).length
    if (tAnim === 0) continue

    // Skip to animated headers: past bitfield + constant data
    cursor += bfSize + (secOff3 - secOff2)
    // Skip rotation animated headers
    cursor += rAnim * 24

    // Now at position animated headers
    let iOK = true, gOK = true
    for (let i = 0; i < tAnim; i++) {
      if (cursor + 24 > data.length) { iOK = false; gOK = false; break }
      const v = [f32(cursor), f32(cursor+4), f32(cursor+8), f32(cursor+12), f32(cursor+16), f32(cursor+20)]

      // Interleaved: [min_x, max_x, min_y, max_y, min_z, max_z]
      if (v[0] > v[1] + 0.001 || v[2] > v[3] + 0.001 || v[4] > v[5] + 0.001) iOK = false
      // Grouped: [min_x, min_y, min_z, max_x, max_y, max_z]
      if (v[0] > v[3] + 0.001 || v[1] > v[4] + 0.001 || v[2] > v[5] + 0.001) gOK = false

      cursor += 24
    }

    total++
    if (iOK) interleavedOK++
    if (gOK) groupedOK++
  }

  console.log(`Total files with animated positions: ${total}`)
  console.log(`Interleaved [min_x, max_x, ...] min≤max: ${interleavedOK}/${total} (${(interleavedOK/total*100).toFixed(1)}%)`)
  console.log(`Grouped [min_x, min_y, min_z, max_x, ...] min≤max: ${groupedOK}/${total} (${(groupedOK/total*100).toFixed(1)}%)`)
}
main()
