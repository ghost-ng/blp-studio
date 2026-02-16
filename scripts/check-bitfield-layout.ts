#!/usr/bin/env npx tsx
/**
 * Check whether bitfield layout is packed or per-group word-aligned.
 * Packed:     [R₀..Rₙ, T₀..Tₙ, S₀..Sₙ] contiguous, one total padding
 * Per-group:  [R₀..R(stride-1)] [T₀..T(stride-1)] [S₀..S(stride-1)] each word-aligned
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
  if (u32(0x48) === 0xFFFFFFFF) continue // V0

  const AC = 0x60
  const boneCount = u32(AC + 0x10)
  const valA = u32(AC + 0x34)
  const valB = u32(AC + 0x38)
  const valC = u32(AC + 0x3C)
  const secOff1 = u32(AC + 0x48)
  const secOff2 = u32(AC + 0x4C)

  const bitfieldSize = secOff2 - secOff1

  const packed = Math.ceil(boneCount * 3 / 16) * 4
  const perGroupWords = Math.ceil(boneCount / 16)
  const perGroup = perGroupWords * 4 * 3
  const stride = perGroupWords * 16 // entries per group

  // Read bitfield with both layouts
  const count1 = u32(AC + 0x20)
  let cursor = AC + 0x44 + 16
  if (count1 >= 2) { cursor += count1 * 4 + 4 }
  cursor += count1 * 16

  const channelTypes: number[] = []
  const wordCount = Math.ceil(bitfieldSize / 4)
  for (let w = 0; w < wordCount; w++) {
    const word = u32(cursor + w * 4)
    for (let i = 0; i < 16; i++) channelTypes.push((word >>> (i * 2)) & 3)
  }

  // Count with packed layout
  let rAnim_p = 0, tAnim_p = 0, sAnim_p = 0
  let rConst_p = 0, tConst_p = 0, sConst_p = 0
  for (let b = 0; b < boneCount; b++) {
    const r = channelTypes[b] ?? 0
    const t = channelTypes[boneCount + b] ?? 0
    const s = channelTypes[2 * boneCount + b] ?? 0
    if (r === 2) rAnim_p++; if (r === 1) rConst_p++
    if (t === 2) tAnim_p++; if (t === 1) tConst_p++
    if (s === 2) sAnim_p++; if (s === 1) sConst_p++
  }

  // Count with per-group layout
  let rAnim_g = 0, tAnim_g = 0, sAnim_g = 0
  let rConst_g = 0, tConst_g = 0, sConst_g = 0
  for (let b = 0; b < boneCount; b++) {
    const r = channelTypes[b] ?? 0
    const t = channelTypes[stride + b] ?? 0
    const s = channelTypes[2 * stride + b] ?? 0
    if (r === 2) rAnim_g++; if (r === 1) rConst_g++
    if (t === 2) tAnim_g++; if (t === 1) tConst_g++
    if (s === 2) sAnim_g++; if (s === 1) sConst_g++
  }

  const packedOK = (rConst_p === valA && tConst_p === valB && sConst_p === valC)
  const perGroupOK = (rConst_g === valA && tConst_g === valB && sConst_g === valC)

  console.log(`${file}: bones=${boneCount} bfSize=${bitfieldSize} packed=${packed} perGroup=${perGroup} stride=${stride}`)
  console.log(`  PACKED:    rAnim=${rAnim_p} tAnim=${tAnim_p} sAnim=${sAnim_p} rConst=${rConst_p} tConst=${tConst_p} sConst=${sConst_p} → match valABC: ${packedOK}`)
  console.log(`  PER-GROUP: rAnim=${rAnim_g} tAnim=${tAnim_g} sAnim=${sAnim_g} rConst=${rConst_g} tConst=${tConst_g} sConst=${sConst_g} → match valABC: ${perGroupOK}`)
  console.log(`  valA=${valA} valB=${valB} valC=${valC}`)
  console.log()

}
