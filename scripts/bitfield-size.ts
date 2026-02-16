#!/usr/bin/env npx tsx
/**
 * Figure out correct bitfield size formula.
 * For each file, determine the actual bitfield size by finding data start.
 */

import { readFileSync, readdirSync } from 'fs'
import { resolve, join } from 'path'

const ANIM_MAGIC = 0x6AB06AB0

function main() {
  const dir = resolve(process.argv[2] || '')
  const files = readdirSync(dir).filter(f => f.endsWith('.anim'))

  // Map: boneCount -> actual bitfield words
  const sizeMap = new Map<number, Set<number>>()
  let total = 0

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
    const secOff2 = u32(AC + 0x4C)
    const secOff3 = u32(AC + 0x50)

    // Find bitfield start (cursor after segment groups)
    let cursor = AC + 0x44 // after block A sentinel
    cursor += 16 // section offsets
    if (count1 >= 2) cursor += count1 * 4 + 4
    cursor += count1 * 16 // segment groups

    const bitfieldStart = cursor - AC // relative to AC

    // The data region (R+T+S constants) starts at secOff[2] from AC
    // So bitfield is between cursor and AC+secOff2
    const dataRegionStart = secOff2  // relative to AC
    const bitfieldSize = dataRegionStart - bitfieldStart

    if (bitfieldSize < 0 || bitfieldSize > 200) continue // sanity check

    const bitfieldWords = bitfieldSize / 4
    if (!Number.isInteger(bitfieldWords)) continue

    total++
    if (!sizeMap.has(boneCount)) sizeMap.set(boneCount, new Set())
    sizeMap.get(boneCount)!.add(bitfieldWords)
  }

  console.log(`Analyzed ${total} files\n`)
  console.log('boneCount | bitfield words | ceil(bones*3*2/32) | ceil(bones*3/16) | match?')
  for (const [bones, words] of [...sizeMap.entries()].sort((a, b) => a[0] - b[0])) {
    const expected3 = Math.ceil(bones * 3 * 2 / 32)
    const expected2 = Math.ceil(bones * 3 / 16)
    const actual = [...words].sort((a, b) => a - b).join(',')
    const matches = words.size === 1 && [...words][0] === expected3
    console.log(`  ${bones.toString().padStart(3)} | ${actual.padStart(14)} | ${expected3.toString().padStart(18)} | ${expected2.toString().padStart(16)} | ${matches ? '✓' : '✗'}`)
  }

  // Try to find the formula
  console.log('\n\nLooking for correct formula...')
  const formulas: { name: string, fn: (b: number) => number }[] = [
    { name: 'ceil(b*3*2/32)', fn: b => Math.ceil(b * 3 * 2 / 32) },
    { name: 'ceil(b*3/16)', fn: b => Math.ceil(b * 3 / 16) },
    { name: 'ceil(b*2/16)', fn: b => Math.ceil(b * 2 / 16) },
    { name: 'ceil((b*3+15)/16)', fn: b => Math.ceil((b * 3 + 15) / 16) },
    { name: 'ceil(b/4)', fn: b => Math.ceil(b / 4) },
    { name: 'ceil(b/8)*2', fn: b => Math.ceil(b / 8) * 2 },
    { name: 'floor(b/4)+1', fn: b => Math.floor(b / 4) + 1 },
    { name: 'ceil(b*6/32)', fn: b => Math.ceil(b * 6 / 32) },
    { name: 'ceil((valA+valB)*2/32)', fn: b => 0 }, // placeholder
  ]

  for (const { name, fn } of formulas) {
    let matches = 0
    for (const [bones, words] of sizeMap) {
      if (words.size === 1 && [...words][0] === fn(bones)) matches++
    }
    console.log(`  ${name}: ${matches}/${sizeMap.size} bone counts match`)
  }
}

main()
