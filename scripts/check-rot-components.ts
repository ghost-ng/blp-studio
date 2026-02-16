#!/usr/bin/env npx tsx
/**
 * Check whether rotation channels use 3 or 4 components by comparing
 * g values to sum of bit widths.
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

  const AC = 0x60
  const BASE = AC + 0x20
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

  if (rAnim === 0) continue // Only care about files with rotation animations

  // Get bit widths from first segment body
  const g = segGroups[0]
  const bodyStart = BASE + g[3]
  const bw: number[] = []
  const totalAnim = rAnim + tAnim + sAnim
  for (let i = 0; i < totalAnim; i++) bw.push(data[bodyStart + i])

  // Channel ordering: first rAnim rotation channels, then tAnim translation, then sAnim scale
  const rotBW = bw.slice(0, rAnim)
  const posBW = bw.slice(rAnim, rAnim + tAnim)
  const sclBW = bw.slice(rAnim + tAnim)

  const sumRotBW = rotBW.reduce((a, b) => a + b, 0)
  const sumPosBW = posBW.reduce((a, b) => a + b, 0)
  const sumSclBW = sclBW.reduce((a, b) => a + b, 0)

  // g[1] = rotation bits per frame, g[2] = pos+scale bits per frame
  const g1 = g[1]
  const g2 = g[2]
  const g0 = g[0]

  // Check hypothesis: rotation uses 3 components
  const rot3 = sumRotBW * 3
  const rot4 = sumRotBW * 4
  const posScl3 = (sumPosBW + sumSclBW) * 3

  console.log(`${file}: rAnim=${rAnim} tAnim=${tAnim} sAnim=${sAnim}`)
  console.log(`  rotBW=[${rotBW.join(',')}] sumRotBW=${sumRotBW}`)
  console.log(`  posBW=[${posBW.join(',')}] sumPosBW=${sumPosBW}`)
  console.log(`  sclBW=[${sclBW.join(',')}] sumSclBW=${sumSclBW}`)
  console.log(`  g=[${g.join(',')}] g[0]=${g0} g[1]=${g1} g[2]=${g2}`)
  console.log(`  If rot×3: g[1]=${rot3} g[2]=${posScl3} total=${rot3+posScl3} → match g[0]=${g0}? ${rot3+posScl3===g0}`)
  console.log(`  If rot×4: g[1]=${rot4} g[2]=${posScl3} total=${rot4+posScl3} → match g[0]=${g0}? ${rot4+posScl3===g0}`)
  console.log(`  Actual g[1] matches rot×3=${g1===rot3}, rot×4=${g1===rot4}`)
  console.log()
}
