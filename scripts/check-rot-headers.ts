#!/usr/bin/env npx tsx
/**
 * Check if rotation animated headers also have duplicate pairs like position headers.
 * Also check scale headers.
 */
import { readFileSync, readdirSync } from 'fs'
import { resolve, join } from 'path'

const ANIM_MAGIC = 0x6AB06AB0

function main() {
  const dir = resolve(process.argv[2] || '')
  const files = readdirSync(dir).filter(f => f.endsWith('.anim'))

  let rTotal = 0, rDup = 0, tTotal = 0, tDup = 0, sTotal = 0, sDup = 0
  const rSamples: number[][] = []
  const tSamples: number[][] = []
  const sSamples: number[][] = []

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
    const rTypes: number[] = [], tTypes: number[] = [], sTypes: number[] = []
    for (let b = 0; b < boneCount; b++) rTypes.push(channelTypes[b] ?? 0)
    for (let b = 0; b < boneCount; b++) tTypes.push(channelTypes[boneCount + b] ?? 0)
    for (let b = 0; b < boneCount; b++) sTypes.push(channelTypes[2 * boneCount + b] ?? 0)
    const rAnim = rTypes.filter(v => v === 2).length
    const tAnim = tTypes.filter(v => v === 2).length
    const sAnim = sTypes.filter(v => v === 2).length

    cursor += bfSize + (secOff3 - secOff2)

    // Rotation headers
    for (let i = 0; i < rAnim; i++) {
      if (cursor + 24 > data.length) break
      const v = [f32(cursor), f32(cursor+4), f32(cursor+8), f32(cursor+12), f32(cursor+16), f32(cursor+20)]
      rTotal++
      const isDup = Math.abs(v[0]-v[1]) < 0.0001 && Math.abs(v[2]-v[3]) < 0.0001 && Math.abs(v[4]-v[5]) < 0.0001
      if (isDup) rDup++
      if (rSamples.length < 10 && !isDup) rSamples.push(v)
      cursor += 24
    }

    // Position headers
    for (let i = 0; i < tAnim; i++) {
      if (cursor + 24 > data.length) break
      const v = [f32(cursor), f32(cursor+4), f32(cursor+8), f32(cursor+12), f32(cursor+16), f32(cursor+20)]
      tTotal++
      const isDup = Math.abs(v[0]-v[1]) < 0.0001 && Math.abs(v[2]-v[3]) < 0.0001 && Math.abs(v[4]-v[5]) < 0.0001
      if (isDup) tDup++
      if (tSamples.length < 5 && !isDup) tSamples.push(v)
      cursor += 24
    }

    // Scale headers
    for (let i = 0; i < sAnim; i++) {
      if (cursor + 24 > data.length) break
      const v = [f32(cursor), f32(cursor+4), f32(cursor+8), f32(cursor+12), f32(cursor+16), f32(cursor+20)]
      sTotal++
      const isDup = Math.abs(v[0]-v[1]) < 0.0001 && Math.abs(v[2]-v[3]) < 0.0001 && Math.abs(v[4]-v[5]) < 0.0001
      if (isDup) sDup++
      if (sSamples.length < 5 && !isDup) sSamples.push(v)
      cursor += 24
    }
  }

  console.log(`Rotation headers: ${rDup}/${rTotal} duplicate pairs (${(rDup/rTotal*100).toFixed(1)}%)`)
  console.log(`Position headers: ${tDup}/${tTotal} duplicate pairs (${(tDup/tTotal*100).toFixed(1)}%)`)
  console.log(`Scale headers: ${sDup}/${sTotal} duplicate pairs (${(sDup/sTotal*100).toFixed(1)}%)`)

  if (rSamples.length) {
    console.log(`\nNon-duplicate rotation samples:`)
    for (const s of rSamples) console.log(`  [${s.map(v=>v.toFixed(6)).join(', ')}]  diffs: ${(s[0]-s[1]).toFixed(6)}, ${(s[2]-s[3]).toFixed(6)}, ${(s[4]-s[5]).toFixed(6)}`)
  }
  if (tSamples.length) {
    console.log(`\nNon-duplicate position samples:`)
    for (const s of tSamples) console.log(`  [${s.map(v=>v.toFixed(6)).join(', ')}]  diffs: ${(s[0]-s[1]).toFixed(6)}, ${(s[2]-s[3]).toFixed(6)}, ${(s[4]-s[5]).toFixed(6)}`)
  }
  if (sSamples.length) {
    console.log(`\nNon-duplicate scale samples:`)
    for (const s of sSamples) console.log(`  [${s.map(v=>v.toFixed(6)).join(', ')}]  diffs: ${(s[0]-s[1]).toFixed(6)}, ${(s[2]-s[3]).toFixed(6)}, ${(s[4]-s[5]).toFixed(6)}`)
  }
}
main()
