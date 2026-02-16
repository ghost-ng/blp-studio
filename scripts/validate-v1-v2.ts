#!/usr/bin/env npx tsx
/**
 * V2 validation: use secOff[2]-secOff[1] as bitfield size.
 */

import { readFileSync, readdirSync } from 'fs'
import { resolve, join } from 'path'

const ANIM_MAGIC = 0x6AB06AB0

function main() {
  const dir = resolve(process.argv[2] || '')
  const files = readdirSync(dir).filter(f => f.endsWith('.anim'))
  let total = 0, rotOK = 0, scaleOK = 0, posOK = 0, allOK = 0

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

    // Section offsets
    const secOff = [u32(AC + 0x44), u32(AC + 0x48), u32(AC + 0x4C), u32(AC + 0x50)]
    const bitfieldSize = secOff[2] - secOff[1]

    // Find bitfield position in file
    let cursor = AC + 0x44 + 16 // after secOff
    if (count1 >= 2) cursor += count1 * 4 + 4 // frame bounds + sentinel
    cursor += count1 * 16 // segment groups

    // Bitfield is bitfieldSize bytes
    const bitfieldStart = cursor
    cursor += bitfieldSize

    // Now read constant data
    const dataStart = cursor

    // Read valA rotation entries (3 floats each)
    let rOK = true
    for (let i = 0; i < valA; i++) {
      if (cursor + 12 > data.length) { rOK = false; break }
      for (let j = 0; j < 3; j++) {
        const v = f32(cursor + j * 4)
        if (!isFinite(v) || Math.abs(v) > 1.01) rOK = false
      }
      cursor += 12
    }

    // Read valB position entries (3 floats each)
    let pOK = true
    for (let i = 0; i < valB; i++) {
      if (cursor + 12 > data.length) { pOK = false; break }
      for (let j = 0; j < 3; j++) {
        const v = f32(cursor + j * 4)
        if (!isFinite(v) || Math.abs(v) > 100000) pOK = false
      }
      cursor += 12
    }

    // Read valC scale entries (3 floats each)
    let sOK = true
    for (let i = 0; i < valC; i++) {
      if (cursor + 12 > data.length) { sOK = false; break }
      for (let j = 0; j < 3; j++) {
        const v = f32(cursor + j * 4)
        if (!isFinite(v) || Math.abs(v) > 1000) sOK = false
      }
      cursor += 12
    }

    total++
    if (rOK) rotOK++
    if (pOK) posOK++
    if (sOK) scaleOK++
    if (rOK && pOK && sOK) allOK++
  }

  console.log(`Total: ${total}`)
  console.log(`Rotation valid: ${rotOK}/${total} (${(rotOK/total*100).toFixed(1)}%)`)
  console.log(`Position valid: ${posOK}/${total} (${(posOK/total*100).toFixed(1)}%)`)
  console.log(`Scale valid: ${scaleOK}/${total} (${(scaleOK/total*100).toFixed(1)}%)`)
  console.log(`ALL valid: ${allOK}/${total} (${(allOK/total*100).toFixed(1)}%)`)
}

main()
