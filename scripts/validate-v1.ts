#!/usr/bin/env npx tsx
/**
 * Validate V1 AC11 decoder across ALL animations.
 * Tests: valA × 12 + valB × 12 + valC × 12 === secOff[3] - secOff[2]
 * And that constant data reads as valid floats.
 */

import { readFileSync, readdirSync } from 'fs'
import { resolve, join } from 'path'

const ANIM_MAGIC = 0x6AB06AB0

function main() {
  const dir = resolve(process.argv[2] || '')
  const files = readdirSync(dir).filter(f => f.endsWith('.anim'))
  let total = 0, match = 0, fail = 0
  const failures: string[] = []

  for (const f of files) {
    const data = readFileSync(join(dir, f))
    if (data.length < 0xB4) continue
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
    if (view.getUint32(0, true) !== ANIM_MAGIC) continue
    if (view.getUint32(0x48, true) === 0xFFFFFFFF) continue // skip V0

    const AC = 0x60
    const u32 = (o: number) => view.getUint32(o, true)
    const f32 = (o: number) => view.getFloat32(o, true)
    const count1 = u32(AC + 0x20)
    const valA = u32(AC + 0x34) // rotation entries
    const valB = u32(AC + 0x38) // position entries
    const valC = u32(AC + 0x3C) // scale entries (= boneCount)
    const boneCount = u32(AC + 0x10)

    // Read section offsets (at AC+0x44 = after sentinel)
    const secOff2 = u32(AC + 0x4C)
    const secOff3 = u32(AC + 0x50)

    const section3Size = secOff3 - secOff2
    const expectedSize = valA * 12 + valB * 12 + valC * 12

    total++
    if (section3Size === expectedSize) {
      match++
    } else {
      fail++
      if (failures.length < 20)
        failures.push(`${f}: sec3=${section3Size} expected=${expectedSize} (valA=${valA} valB=${valB} valC=${valC} bones=${boneCount} c1=${count1})`)
    }
  }

  console.log(`\nValidation: ${match}/${total} match (${fail} failures)`)
  if (failures.length > 0) {
    console.log('\nFailures:')
    for (const f of failures) console.log(`  ${f}`)
  }

  // Also validate valC === boneCount
  console.log('\n--- valC === boneCount check ---')
  let valCMatch = 0, valCFail = 0
  for (const f of files) {
    const data = readFileSync(join(dir, f))
    if (data.length < 0xB4) continue
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
    if (view.getUint32(0, true) !== ANIM_MAGIC) continue
    if (view.getUint32(0x48, true) === 0xFFFFFFFF) continue
    const boneCount = view.getUint32(0x70, true)
    const valC = view.getUint32(0x9C, true)
    if (valC === boneCount) valCMatch++
    else valCFail++
  }
  console.log(`  valC===boneCount: ${valCMatch}/${valCMatch + valCFail}`)

  // Validate rotation data: first valA entries should have all components in [-1,1]
  console.log('\n--- Rotation validation (3-float smallest-3) ---')
  let rotTotal = 0, rotOK = 0
  for (const f of files) {
    const data = readFileSync(join(dir, f))
    if (data.length < 0xB4) continue
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
    if (view.getUint32(0, true) !== ANIM_MAGIC) continue
    if (view.getUint32(0x48, true) === 0xFFFFFFFF) continue

    const AC = 0x60
    const u32 = (o: number) => view.getUint32(o, true)
    const f32 = (o: number) => view.getFloat32(o, true)
    const count1 = u32(AC + 0x20)
    const valA = u32(AC + 0x34)
    const boneCount = u32(AC + 0x10)

    // Find bitfield start
    let cursor = AC + 0x44 // after block A sentinel
    cursor += 16 // skip section offsets
    if (count1 >= 2) {
      cursor += count1 * 4 + 4 // frame boundaries + sentinel
    }
    cursor += count1 * 16 // segment groups
    // Skip bitfield
    const bitsNeeded = boneCount * 3
    const wordsNeeded = Math.ceil((bitsNeeded * 2) / 32)
    cursor += wordsNeeded * 4

    // Read valA rotation entries (3 floats each)
    let allOK = true
    for (let i = 0; i < valA; i++) {
      if (cursor + 12 > data.length) { allOK = false; break }
      for (let j = 0; j < 3; j++) {
        const v = f32(cursor + j * 4)
        if (!isFinite(v) || Math.abs(v) > 1.01) allOK = false
      }
      cursor += 12
    }
    rotTotal++
    if (allOK) rotOK++
  }
  console.log(`  Valid rotations: ${rotOK}/${rotTotal}`)

  // Validate scale data: last valC entries should all be reasonable
  console.log('\n--- Scale validation ---')
  let scaleTotal = 0, scaleOK = 0
  for (const f of files) {
    const data = readFileSync(join(dir, f))
    if (data.length < 0xB4) continue
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
    if (view.getUint32(0, true) !== ANIM_MAGIC) continue
    if (view.getUint32(0x48, true) === 0xFFFFFFFF) continue

    const AC = 0x60
    const u32 = (o: number) => view.getUint32(o, true)
    const f32 = (o: number) => view.getFloat32(o, true)
    const count1 = u32(AC + 0x20)
    const valA = u32(AC + 0x34)
    const valB = u32(AC + 0x38)
    const valC = u32(AC + 0x3C)
    const boneCount = u32(AC + 0x10)

    // Find data start
    let cursor = AC + 0x44
    cursor += 16 // section offsets
    if (count1 >= 2) cursor += count1 * 4 + 4
    cursor += count1 * 16
    const bitsNeeded = boneCount * 3
    const wordsNeeded = Math.ceil((bitsNeeded * 2) / 32)
    cursor += wordsNeeded * 4

    // Skip R and T data
    cursor += valA * 12 + valB * 12

    // Read valC scale entries
    let allOK = true
    for (let i = 0; i < valC; i++) {
      if (cursor + 12 > data.length) { allOK = false; break }
      for (let j = 0; j < 3; j++) {
        const v = f32(cursor + j * 4)
        if (!isFinite(v) || Math.abs(v) > 100) allOK = false
      }
      cursor += 12
    }
    scaleTotal++
    if (allOK) scaleOK++
  }
  console.log(`  Valid scales: ${scaleOK}/${scaleTotal}`)
}

main()
