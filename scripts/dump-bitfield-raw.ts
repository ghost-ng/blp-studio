#!/usr/bin/env npx tsx
/**
 * Dump raw bitfield entries for first few files to understand the actual encoding.
 * Also try bone-interleaved layout: [R₀,T₀,S₀, R₁,T₁,S₁, ...]
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

  const magic = u32(0)
  if (magic !== 0x6AB06AB0) continue
  if (u32(0x48) === 0xFFFFFFFF) continue

  const AC = 0x60
  const boneCount = u32(AC + 0x10)
  const valA = u32(AC + 0x34)
  const valB = u32(AC + 0x38)
  const valC = u32(AC + 0x3C)
  const secOff1 = u32(AC + 0x48)
  const secOff2 = u32(AC + 0x4C)
  const bitfieldSize = secOff2 - secOff1
  const count1 = u32(AC + 0x20)

  let cursor = AC + 0x44 + 16
  if (count1 >= 2) { cursor += count1 * 4 + 4 }
  cursor += count1 * 16

  const entries: number[] = []
  const wordCount = Math.ceil(bitfieldSize / 4)
  for (let w = 0; w < wordCount; w++) {
    const word = u32(cursor + w * 4)
    for (let i = 0; i < 16; i++) entries.push((word >>> (i * 2)) & 3)
  }

  console.log(`\n${file}: bones=${boneCount} bfSize=${bitfieldSize} words=${wordCount} entries=${entries.length}`)
  console.log(`  valA=${valA} valB=${valB} valC=${valC}`)

  // Count type distribution across ALL entries
  const typeCounts = [0, 0, 0, 0]
  for (let i = 0; i < boneCount * 3; i++) typeCounts[entries[i] ?? 0]++
  console.log(`  Total type distribution (first ${boneCount*3} entries): type0=${typeCounts[0]} type1=${typeCounts[1]} type2=${typeCounts[2]} type3=${typeCounts[3]}`)

  // Test: channel-grouped packed [R₀..Rₙ T₀..Tₙ S₀..Sₙ]
  console.log(`\n  === PACKED CHANNEL-GROUPED ===`)
  const pCounts = { r: [0,0,0,0], t: [0,0,0,0], s: [0,0,0,0] }
  for (let b = 0; b < boneCount; b++) {
    pCounts.r[entries[b]]++
    pCounts.t[entries[boneCount + b]]++
    pCounts.s[entries[2 * boneCount + b]]++
  }
  console.log(`  R: ${pCounts.r.join(',')}  T: ${pCounts.t.join(',')}  S: ${pCounts.s.join(',')}`)
  console.log(`  rConst(1)=${pCounts.r[1]} =valA? ${pCounts.r[1]===valA}  tConst(1)=${pCounts.t[1]} =valB? ${pCounts.t[1]===valB}  sConst(1)=${pCounts.s[1]} =valC? ${pCounts.s[1]===valC}`)

  // Test: bone-interleaved [R₀,T₀,S₀, R₁,T₁,S₁, ...]
  console.log(`\n  === BONE-INTERLEAVED ===`)
  const bCounts = { r: [0,0,0,0], t: [0,0,0,0], s: [0,0,0,0] }
  for (let b = 0; b < boneCount; b++) {
    bCounts.r[entries[3*b]]++
    bCounts.t[entries[3*b + 1]]++
    bCounts.s[entries[3*b + 2]]++
  }
  console.log(`  R: ${bCounts.r.join(',')}  T: ${bCounts.t.join(',')}  S: ${bCounts.s.join(',')}`)
  console.log(`  rConst(1)=${bCounts.r[1]} =valA? ${bCounts.r[1]===valA}  tConst(1)=${bCounts.t[1]} =valB? ${bCounts.t[1]===valB}  sConst(1)=${bCounts.s[1]} =valC? ${bCounts.s[1]===valC}`)

  // Test: per-group word-aligned with different type mapping
  // What if 0=constant, 1=identity, 2=animated?
  console.log(`\n  === PACKED, type0=const ===`)
  console.log(`  rConst(0)=${pCounts.r[0]} =valA? ${pCounts.r[0]===valA}  tConst(0)=${pCounts.t[0]} =valB? ${pCounts.t[0]===valB}  sConst(0)=${pCounts.s[0]} =valC? ${pCounts.s[0]===valC}`)

  // Test: bone-interleaved, type0=const
  console.log(`\n  === BONE-INTERLEAVED, type0=const ===`)
  console.log(`  rConst(0)=${bCounts.r[0]} =valA? ${bCounts.r[0]===valA}  tConst(0)=${bCounts.t[0]} =valB? ${bCounts.t[0]===valB}  sConst(0)=${bCounts.s[0]} =valC? ${bCounts.s[0]===valC}`)

  // Dump first 10 bones' raw entries (both layouts)
  console.log(`\n  First 10 bones (packed channel-grouped):`)
  for (let b = 0; b < Math.min(10, boneCount); b++) {
    const r = entries[b], t = entries[boneCount + b], s = entries[2 * boneCount + b]
    console.log(`    bone${b}: R=${r} T=${t} S=${s}`)
  }
  console.log(`\n  First 10 bones (bone-interleaved):`)
  for (let b = 0; b < Math.min(10, boneCount); b++) {
    const r = entries[3*b], t = entries[3*b+1], s = entries[3*b+2]
    console.log(`    bone${b}: R=${r} T=${t} S=${s}`)
  }

  // Raw hex of first words
  console.log(`\n  Raw words:`)
  for (let w = 0; w < Math.min(6, wordCount); w++) {
    const word = u32(cursor + w * 4)
    const bits = word.toString(2).padStart(32, '0')
    const e: number[] = []
    for (let i = 0; i < 16; i++) e.push((word >>> (i * 2)) & 3)
    console.log(`    word${w}: 0x${word.toString(16).padStart(8,'0')} entries=[${e.join(',')}]`)
  }
}
