#!/usr/bin/env npx tsx
/**
 * Validate that grouped midpoint [(v0+v3)/2, (v1+v4)/2, (v2+v5)/2]
 * produces reasonable values for all animated channel types.
 */
import { readFileSync, readdirSync } from 'fs'
import { resolve, join } from 'path'

const ANIM_MAGIC = 0x6AB06AB0

function main() {
  const dir = resolve(process.argv[2] || '')
  const files = readdirSync(dir).filter(f => f.endsWith('.anim'))

  let total = 0
  let rotOK = 0, posOK = 0, scaleOK = 0, allOK = 0

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
    if (rAnim + tAnim + sAnim === 0) continue

    cursor += bfSize + (secOff3 - secOff2) // past bitfield + constant data

    total++
    let rValid = true, tValid = true, sValid = true

    // Rotation: grouped midpoint → exponential map magnitude should be < π
    for (let i = 0; i < rAnim; i++) {
      if (cursor + 24 > data.length) { rValid = false; break }
      const mx = (f32(cursor) + f32(cursor + 12)) / 2
      const my = (f32(cursor + 4) + f32(cursor + 16)) / 2
      const mz = (f32(cursor + 8) + f32(cursor + 20)) / 2
      const angle = Math.sqrt(mx * mx + my * my + mz * mz)
      if (!isFinite(angle) || angle > Math.PI + 0.1) rValid = false
      cursor += 24
    }

    // Position: grouped midpoint should be finite and reasonable
    for (let i = 0; i < tAnim; i++) {
      if (cursor + 24 > data.length) { tValid = false; break }
      const px = (f32(cursor) + f32(cursor + 12)) / 2
      const py = (f32(cursor + 4) + f32(cursor + 16)) / 2
      const pz = (f32(cursor + 8) + f32(cursor + 20)) / 2
      if (!isFinite(px) || !isFinite(py) || !isFinite(pz) ||
          Math.abs(px) > 100000 || Math.abs(py) > 100000 || Math.abs(pz) > 100000) tValid = false
      cursor += 24
    }

    // Scale: grouped midpoint should be finite and reasonable
    for (let i = 0; i < sAnim; i++) {
      if (cursor + 24 > data.length) { sValid = false; break }
      const sx = (f32(cursor) + f32(cursor + 12)) / 2
      const sy = (f32(cursor + 4) + f32(cursor + 16)) / 2
      const sz = (f32(cursor + 8) + f32(cursor + 20)) / 2
      if (!isFinite(sx) || !isFinite(sy) || !isFinite(sz) ||
          Math.abs(sx) > 1000 || Math.abs(sy) > 1000 || Math.abs(sz) > 1000) sValid = false
      cursor += 24
    }

    if (rValid) rotOK++
    if (tValid) posOK++
    if (sValid) scaleOK++
    if (rValid && tValid && sValid) allOK++
  }

  console.log(`Total files: ${total}`)
  console.log(`Rotation midpoints valid: ${rotOK}/${total} (${(rotOK/total*100).toFixed(1)}%)`)
  console.log(`Position midpoints valid: ${posOK}/${total} (${(posOK/total*100).toFixed(1)}%)`)
  console.log(`Scale midpoints valid: ${scaleOK}/${total} (${(scaleOK/total*100).toFixed(1)}%)`)
  console.log(`ALL valid: ${allOK}/${total} (${(allOK/total*100).toFixed(1)}%)`)
}
main()
