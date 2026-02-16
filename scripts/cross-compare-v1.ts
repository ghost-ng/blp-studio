#!/usr/bin/env npx tsx
/**
 * Cross-compare multiple V1 animations to find structural patterns.
 * Focuses on the relationship between header counts and data layout.
 */

import { readFileSync, readdirSync } from 'fs'
import { resolve, join } from 'path'

const ANIM_MAGIC = 0x6AB06AB0

interface V1Info {
  name: string
  data: Buffer
  bones: number
  frames: number
  count1: number
  count2: number
  count3: number
  count4: number
  val94: number // at 0x94
  val98: number // at 0x98
  val9C: number // at 0x9C
  secOff: number[] // 4 values at 0xA4-0xB0
  dataSize: number
  fileSize: number
}

function main() {
  const dir = resolve(process.argv[2] || '')
  const files = readdirSync(dir).filter(f => f.endsWith('.anim'))

  const anims: V1Info[] = []
  for (const f of files) {
    const data = readFileSync(join(dir, f))
    if (data.length < 0xB4) continue
    const v = new DataView(data.buffer, data.byteOffset, data.byteLength)
    if (v.getUint32(0, true) !== ANIM_MAGIC) continue
    if (v.getUint32(0x48, true) === 0xFFFFFFFF) continue // skip V0

    const bones = v.getUint32(0x10, true) & 0xFFFF
    const frames = v.getUint32(0x0C, true)
    const count1 = v.getUint32(0x80, true)
    const count2 = v.getUint32(0x84, true)
    const count3 = v.getUint32(0x88, true)
    const count4 = v.getUint32(0x8C, true)
    const val94 = v.getUint32(0x94, true)
    const val98 = v.getUint32(0x98, true)
    const val9C = v.getUint32(0x9C, true)
    const secOff = [v.getUint32(0xA4, true), v.getUint32(0xA8, true), v.getUint32(0xAC, true), v.getUint32(0xB0, true)]
    const dataSize = v.getUint32(0x60, true)

    anims.push({ name: f, data, bones, frames, count1, count2, count3, count4, val94, val98, val9C, secOff, dataSize, fileSize: data.length })
  }

  console.log(`Loaded ${anims.length} V1 animations\n`)

  // GROUP 1: Check if val94/val98/val9C are always consistent with some formula
  console.log('=== val94, val98, val9C analysis ===')
  console.log('bones | count1 | count2 | count3 | count4 | val94 | val98 | val9C | c1+v94+v98 | c2+c3+c4')
  const sorted = anims.sort((a, b) => a.bones - b.bones || a.count1 - b.count1)

  // Deduplicate by unique (bones, count1-4, val94-9C) tuples
  const seen = new Set<string>()
  for (const a of sorted) {
    const key = `${a.bones},${a.count1},${a.count2},${a.count3},${a.count4},${a.val94},${a.val98},${a.val9C}`
    if (seen.has(key)) continue
    seen.add(key)
    console.log(`  ${a.bones.toString().padStart(3)} | ${a.count1.toString().padStart(6)} | ${a.count2.toString().padStart(6)} | ${a.count3.toString().padStart(6)} | ${a.count4.toString().padStart(6)} | ${a.val94.toString().padStart(5)} | ${a.val98.toString().padStart(5)} | ${a.val9C.toString().padStart(5)} | ${(a.count1 + a.val94 + a.val98).toString().padStart(10)} | ${(a.count2 + a.count3 + a.count4).toString().padStart(9)}`)
  }

  // GROUP 2: Check secOff[0] formula
  console.log('\n=== secOff[0] analysis ===')
  console.log('Expected: secOff[0] depends on count1?')
  const secOff0Vals = new Map<number, number[]>()
  for (const a of anims) {
    const key = a.count1
    if (!secOff0Vals.has(key)) secOff0Vals.set(key, [])
    secOff0Vals.get(key)!.push(a.secOff[0])
  }
  for (const [c1, offs] of [...secOff0Vals.entries()].sort((a, b) => a[0] - b[0])) {
    const unique = [...new Set(offs)]
    console.log(`  count1=${c1}: secOff[0] = [${unique.join(', ')}]`)
  }

  // GROUP 3: secOff differences
  console.log('\n=== secOff[1]-secOff[0] = count1*16 check ===')
  let mismatch = 0
  for (const a of anims) {
    const diff = a.secOff[1] - a.secOff[0]
    if (diff !== a.count1 * 16) {
      console.log(`  MISMATCH: ${a.name}: diff=${diff}, expected=${a.count1 * 16}`)
      mismatch++
    }
  }
  console.log(`  ${mismatch === 0 ? 'ALL MATCH' : `${mismatch} mismatches`} (${anims.length} total)`)

  // GROUP 4: secOff[2]-secOff[1] analysis
  console.log('\n=== secOff[2]-secOff[1] analysis ===')
  const diff21Vals = new Map<number, string[]>()
  for (const a of anims) {
    const diff = a.secOff[2] - a.secOff[1]
    if (!diff21Vals.has(diff)) diff21Vals.set(diff, [])
    diff21Vals.get(diff)!.push(`${a.name}(b=${a.bones})`)
  }
  for (const [diff, names] of [...diff21Vals.entries()].sort((a, b) => a[0] - b[0])) {
    console.log(`  diff=${diff}: ${names.length} anims (example: ${names[0]})`)
  }

  // GROUP 5: secOff[3]-secOff[2] vs boneCount/frame/count relationship
  console.log('\n=== secOff[3]-secOff[2] analysis ===')
  // Check various formulas
  const formulas: { desc: string, fn: (a: V1Info) => number }[] = [
    { desc: 'bones*12', fn: a => a.bones * 12 },
    { desc: 'bones*16', fn: a => a.bones * 16 },
    { desc: 'val9C*12', fn: a => a.val9C * 12 },
    { desc: '(count1+val94)*12', fn: a => (a.count1 + a.val94) * 12 },
    { desc: '(count1+val94+val98)*4', fn: a => (a.count1 + a.val94 + a.val98) * 4 },
    { desc: 'val98*4', fn: a => a.val98 * 4 },
    { desc: '(val94+val98)*4', fn: a => (a.val94 + a.val98) * 4 },
    { desc: 'bones*3*4', fn: a => a.bones * 3 * 4 },
    { desc: '(val94+val98+val9C)*4', fn: a => (a.val94 + a.val98 + a.val9C) * 4 },
  ]
  for (const { desc, fn } of formulas) {
    let matches = 0
    for (const a of anims) {
      if (a.secOff[3] - a.secOff[2] === fn(a)) matches++
    }
    if (matches > 0) console.log(`  ${desc}: ${matches}/${anims.length} match`)
  }

  // Also dump raw values for variety
  const diff32Set = new Map<string, number>()
  for (const a of anims) {
    const diff = a.secOff[3] - a.secOff[2]
    const key = `bones=${a.bones},diff=${diff}`
    diff32Set.set(key, (diff32Set.get(key) || 0) + 1)
  }
  console.log(`\n  Sample values (bones, sec3-sec2):`)
  for (const [key, count] of [...diff32Set.entries()].slice(0, 20)) {
    console.log(`    ${key}: ${count} anims`)
  }

  // GROUP 6: "last section" size (dataSize - secOff[3])
  console.log('\n=== Last section size (dataSize - secOff[3]) ===')
  const lastSecSizes = new Map<number, number>()
  for (const a of anims) {
    const sz = a.dataSize - a.secOff[3]
    lastSecSizes.set(sz, (lastSecSizes.get(sz) || 0) + 1)
  }
  for (const [sz, count] of [...lastSecSizes.entries()].sort((a, b) => a[0] - b[0])) {
    console.log(`  size=${sz}: ${count} anims`)
  }

  // GROUP 7: Relationship: secOff[0] vs count1
  console.log('\n=== secOff[0] relationship ===')
  // Check if secOff[0] = 52 + f(count1, count2, ...)
  for (const a of anims.slice(0, 30)) {
    const extra = a.secOff[0] - 52
    console.log(`  ${a.name.replace('BLOB_', '').substring(0, 30).padEnd(30)}: secOff[0]=${a.secOff[0]} (52+${extra}) count1=${a.count1} count2=${a.count2}`)
  }
}

main()
