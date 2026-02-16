#!/usr/bin/env npx tsx
/**
 * Validate animated channel header = [min, max] per component.
 * Check that rotation headers have values in [-1,1],
 * position headers have reasonable coordinates,
 * scale headers have reasonable magnitudes.
 */

import { readFileSync, readdirSync } from 'fs'
import { resolve, join } from 'path'

const ANIM_MAGIC = 0x6AB06AB0

function main() {
  const dir = resolve(process.argv[2] || '')
  const files = readdirSync(dir).filter(f => f.endsWith('.anim'))

  let total = 0, rotOK = 0, posOK = 0, scaleOK = 0, allOK = 0
  let rotTotal = 0, posTotal = 0, scaleTotal = 0
  const failures: string[] = []

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
    const secOff2 = u32(AC + 0x4C)
    const secOff3 = u32(AC + 0x50)

    // Navigate to bitfield
    let cursor = AC + 0x44 + 16
    if (count1 >= 2) cursor += count1 * 4 + 4
    cursor += count1 * 16

    const bitfieldSize = secOff2 - secOff3 < 0 ? secOff2 - u32(AC + 0x48) : 0
    // Recalculate properly
    const secOff1 = u32(AC + 0x48)
    const bfSize = secOff2 - secOff1
    if (bfSize < 0 || bfSize > 10000) continue

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
    if (totalAnim === 0) continue

    total++

    // Read animated channel headers at secOff[3]
    // Skip constant data section to get to animated headers
    const constDataSize = secOff3 - secOff2
    cursor += bfSize // past bitfield
    cursor += constDataSize // past constant data

    // Now cursor should be at the animated channel headers
    // Each header: 6 float32 = 24 bytes: [v0, v1, v2, v3, v4, v5]
    // Hypothesis: [min_x, max_x, min_y, max_y, min_z, max_z] OR [min_x, min_y, min_z, max_x, max_y, max_z]

    let rValid = true, tValid = true, sValid = true

    // Read rotation headers
    for (let i = 0; i < rAnim; i++) {
      if (cursor + 24 > data.length) { rValid = false; break }
      const vals = [f32(cursor), f32(cursor+4), f32(cursor+8), f32(cursor+12), f32(cursor+16), f32(cursor+20)]
      rotTotal++
      // Rotation (smallest-3): all values should be in [-1, 1]
      if (vals.every(v => isFinite(v) && Math.abs(v) <= 1.01)) {
        // Valid
      } else {
        rValid = false
        if (failures.length < 20) failures.push(`${f}: rot[${i}] = [${vals.map(v => v.toFixed(4)).join(', ')}]`)
      }
      cursor += 24
    }

    // Read position headers
    for (let i = 0; i < tAnim; i++) {
      if (cursor + 24 > data.length) { tValid = false; break }
      const vals = [f32(cursor), f32(cursor+4), f32(cursor+8), f32(cursor+12), f32(cursor+16), f32(cursor+20)]
      posTotal++
      // Position: all values should be finite and reasonable
      if (vals.every(v => isFinite(v) && Math.abs(v) < 100000)) {
        // Valid
      } else {
        tValid = false
        if (failures.length < 20) failures.push(`${f}: pos[${i}] = [${vals.map(v => v.toFixed(4)).join(', ')}]`)
      }
      cursor += 24
    }

    // Read scale headers
    for (let i = 0; i < sAnim; i++) {
      if (cursor + 24 > data.length) { sValid = false; break }
      const vals = [f32(cursor), f32(cursor+4), f32(cursor+8), f32(cursor+12), f32(cursor+16), f32(cursor+20)]
      scaleTotal++
      // Scale: all values should be positive and reasonable
      if (vals.every(v => isFinite(v) && Math.abs(v) < 1000)) {
        // Valid
      } else {
        sValid = false
        if (failures.length < 20) failures.push(`${f}: scale[${i}] = [${vals.map(v => v.toFixed(4)).join(', ')}]`)
      }
      cursor += 24
    }

    if (rValid) rotOK++
    if (tValid) posOK++
    if (sValid) scaleOK++
    if (rValid && tValid && sValid) allOK++
  }

  console.log(`Total files: ${total}`)
  console.log(`Rotation valid: ${rotOK}/${total} (${rotTotal} channels total)`)
  console.log(`Position valid: ${posOK}/${total} (${posTotal} channels total)`)
  console.log(`Scale valid: ${scaleOK}/${total} (${scaleTotal} channels total)`)
  console.log(`ALL valid: ${allOK}/${total} (${(allOK/total*100).toFixed(1)}%)`)

  if (failures.length > 0) {
    console.log('\nFirst failures:')
    for (const f of failures) console.log(`  ${f}`)
  }

  // Also validate layout: try both [min_x, max_x, min_y, max_y, min_z, max_z]
  // and [min_x, min_y, min_z, max_x, max_y, max_z]
  console.log('\n=== LAYOUT VALIDATION ===')
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
    const secOff1 = u32(AC + 0x48)
    const secOff2 = u32(AC + 0x4C)
    const secOff3 = u32(AC + 0x50)

    let cursor = AC + 0x44 + 16
    if (count1 >= 2) cursor += count1 * 4 + 4
    cursor += count1 * 16

    const bfSize = secOff2 - secOff1
    if (bfSize < 0 || bfSize > 10000) continue

    const channelTypes: number[] = []
    const wordCount = Math.ceil(bfSize / 4)
    for (let w = 0; w < wordCount; w++) {
      const word = u32(cursor + w * 4)
      for (let i = 0; i < 16; i++) channelTypes.push((word >>> (i * 2)) & 3)
    }

    const rTypes: number[] = []
    for (let b = 0; b < boneCount; b++) rTypes.push(channelTypes[b] ?? 0)
    const rAnim = rTypes.filter(v => v === 2).length
    if (rAnim === 0) continue

    cursor += bfSize + (secOff3 - secOff2) // skip bitfield + constants

    // Read first rotation header: 6 floats
    if (cursor + 24 > data.length) continue
    const v = [f32(cursor), f32(cursor+4), f32(cursor+8), f32(cursor+12), f32(cursor+16), f32(cursor+20)]

    // Layout A: [min_x, max_x, min_y, max_y, min_z, max_z] → min_x ≤ max_x
    const interleavedValid = v[0] <= v[1] + 0.001 && v[2] <= v[3] + 0.001 && v[4] <= v[5] + 0.001
    // Layout B: [min_x, min_y, min_z, max_x, max_y, max_z] → min_x ≤ max_x
    const groupedValid = v[0] <= v[3] + 0.001 && v[1] <= v[4] + 0.001 && v[2] <= v[5] + 0.001

    if (interleavedValid) interleavedOK++
    if (groupedValid) groupedOK++
  }

  console.log(`Rotation min≤max [interleaved]: ${interleavedOK}`)
  console.log(`Rotation min≤max [grouped]: ${groupedOK}`)
}

main()
