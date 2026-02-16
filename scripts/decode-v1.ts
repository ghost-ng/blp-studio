#!/usr/bin/env npx tsx
/**
 * V1 AC11 animation decoder - focused on understanding data layout.
 * Parses header, bitfield, and data sections.
 */

import { readFileSync, readdirSync } from 'fs'
import { resolve, join } from 'path'

const ANIM_MAGIC = 0x6AB06AB0

function main() {
  const dir = resolve(process.argv[2] || '')
  const targetBones = parseInt(process.argv[3] || '14')
  const targetIdx = parseInt(process.argv[4] || '0')

  const files = readdirSync(dir).filter(f => f.endsWith('.anim'))
  const anims: { name: string, data: Buffer }[] = []

  for (const f of files) {
    const data = readFileSync(join(dir, f))
    if (data.length < 0xB4) continue
    const v = new DataView(data.buffer, data.byteOffset, data.byteLength)
    if (v.getUint32(0, true) !== ANIM_MAGIC) continue
    if (v.getUint32(0x48, true) === 0xFFFFFFFF) continue // skip V0
    const bones = v.getUint32(0x10, true) & 0xFFFF
    if (bones === targetBones) anims.push({ name: f, data })
  }

  anims.sort((a, b) => a.data.length - b.data.length)
  if (anims.length === 0) { console.log('No matching files'); return }

  const chosen = anims[Math.min(targetIdx, anims.length - 1)]
  console.log(`Decoding: ${chosen.name} (${chosen.data.length} bytes)`)
  decode(chosen.data)
}

function decode(data: Buffer) {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const u32 = (o: number) => view.getUint32(o, true)
  const f32 = (o: number) => view.getFloat32(o, true)

  const AC = 0x60
  const dataSize = u32(AC + 0x00)
  const boneCount = u32(AC + 0x10)
  const lastFrame = u32(AC + 0x14)
  const fps = f32(AC + 0x18)
  const count1 = u32(AC + 0x20) // temporal segments
  const count2 = u32(AC + 0x24)
  const count3 = u32(AC + 0x28)
  const count4 = u32(AC + 0x2C)
  const frameCount = lastFrame + 1

  // Block A: 3 values + sentinel at AC+52
  const valA = u32(AC + 0x34) // val94
  const valB = u32(AC + 0x38) // val98
  const valC = u32(AC + 0x3C) // val9C (= boneCount)

  console.log(`\nbones=${boneCount}, frames=${frameCount}, fps=${fps}`)
  console.log(`count1=${count1} (segments), count2=${count2}, count3=${count3}, count4=${count4}`)
  console.log(`valA=${valA}, valB=${valB}, valC=${valC}`)

  // After Block A sentinel at AC+64:
  // 4 section offsets
  let cursor = AC + 0x44 // after sentinel
  const secOff = [u32(cursor), u32(cursor + 4), u32(cursor + 8), u32(cursor + 12)]
  cursor += 16
  console.log(`\nsecOff = [${secOff.join(', ')}]`)
  console.log(`  sec0 size (count1*16): ${secOff[1] - secOff[0]}`)
  console.log(`  sec1 size: ${secOff[2] - secOff[1]}`)
  console.log(`  sec2 size: ${secOff[3] - secOff[2]}`)
  console.log(`  sec3 size (tail): ${dataSize - secOff[3]}`)

  // Frame boundaries: count1 values if count1>=2, then sentinel. None for count1=1.
  const frameBounds: number[] = []
  if (count1 >= 2) {
    for (let i = 0; i < count1; i++) {
      frameBounds.push(u32(cursor))
      cursor += 4
    }
    const sent = u32(cursor)
    console.log(`  frame bounds sentinel: ${sent === 0xFFFFFFFF ? 'OK' : 'MISSING!'}`)
    cursor += 4
  } else {
    frameBounds.push(0) // implicit
  }
  console.log(`\nFrame boundaries: [${frameBounds.join(', ')}]`)

  // Per-segment groups (count1 × 4 values each)
  const segGroups: number[][] = []
  for (let s = 0; s < count1; s++) {
    const g = [u32(cursor), u32(cursor + 4), u32(cursor + 8), u32(cursor + 12)]
    segGroups.push(g)
    cursor += 16
  }
  console.log(`\nPer-segment groups:`)
  for (let s = 0; s < count1; s++) {
    console.log(`  seg[${s}]: [${segGroups[s].join(', ')}]`)
  }

  // Bitfield starts at cursor
  const bitfieldStart = cursor
  const bitsNeeded = boneCount * 3 // 3 channels per bone
  const wordsNeeded = Math.ceil((bitsNeeded * 2) / 32) // 2 bits per entry, 32 bits per word
  const bitfieldBytes = wordsNeeded * 4

  console.log(`\nBitfield at offset ${bitfieldStart - AC} from AC (${bitsNeeded} entries, ${wordsNeeded} words, ${bitfieldBytes} bytes)`)

  // Read 2-bit values
  const channelTypes: number[] = []
  for (let w = 0; w < wordsNeeded; w++) {
    const word = u32(bitfieldStart + w * 4)
    for (let i = 0; i < 16; i++) {
      channelTypes.push((word >>> (i * 2)) & 3)
    }
  }

  // Try BOTH layouts: bone-interleaved [R0,T0,S0,R1,T1,S1,...] and channel-grouped [R0..RN,T0..TN,S0..SN]
  // Channel-grouped layout
  const rTypesCG: number[] = [], tTypesCG: number[] = [], sTypesCG: number[] = []
  for (let b = 0; b < boneCount; b++) rTypesCG.push(channelTypes[b])
  for (let b = 0; b < boneCount; b++) tTypesCG.push(channelTypes[boneCount + b])
  for (let b = 0; b < boneCount; b++) sTypesCG.push(channelTypes[2 * boneCount + b])

  // Bone-interleaved layout
  const rTypesBI: number[] = [], tTypesBI: number[] = [], sTypesBI: number[] = []
  for (let b = 0; b < boneCount; b++) {
    rTypesBI.push(channelTypes[b * 3 + 0])
    tTypesBI.push(channelTypes[b * 3 + 1])
    sTypesBI.push(channelTypes[b * 3 + 2])
  }

  // Check which matches valA/valB/valC
  const cgRconst = rTypesCG.filter(v => v === 1).length
  const cgTconst = tTypesCG.filter(v => v === 1).length
  const cgSconst = sTypesCG.filter(v => v === 1).length
  const biRconst = rTypesBI.filter(v => v === 1).length
  const biTconst = tTypesBI.filter(v => v === 1).length
  const biSconst = sTypesBI.filter(v => v === 1).length

  console.log(`\n=== LAYOUT COMPARISON ===`)
  console.log(`Channel-grouped: R_const=${cgRconst} T_const=${cgTconst} S_const=${cgSconst}`)
  console.log(`Bone-interleaved: R_const=${biRconst} T_const=${biTconst} S_const=${biSconst}`)
  console.log(`Header values: valA=${valA} valB=${valB} valC=${valC}`)
  console.log(`CG match valA? ${cgRconst === valA} | BI match valA? ${biRconst === valA}`)

  // Use channel-grouped layout (matches valA=R_const for 14-bone case)
  const rTypes = rTypesCG, tTypes = tTypesCG, sTypes = sTypesCG
  console.log(`\nUsing CHANNEL-GROUPED layout:`)
  const counts = [0, 0, 0, 0]
  for (let b = 0; b < boneCount; b++) {
    counts[rTypes[b]]++; counts[tTypes[b]]++; counts[sTypes[b]]++
    console.log(`  bone[${b.toString().padStart(2)}]: R=${rTypes[b]} T=${tTypes[b]} S=${sTypes[b]}`)
  }

  const rConst = rTypes.filter(v => v === 1).length
  const tConst = tTypes.filter(v => v === 1).length
  const sConst = sTypes.filter(v => v === 1).length
  const rAnim = rTypes.filter(v => v === 2).length
  const tAnim = tTypes.filter(v => v === 2).length
  const sAnim = sTypes.filter(v => v === 2).length
  const rIdent = rTypes.filter(v => v === 0).length
  const tIdent = tTypes.filter(v => v === 0).length
  const sIdent = sTypes.filter(v => v === 0).length

  console.log(`\nChannel summary:`)
  console.log(`  R: ${rIdent} identity, ${rConst} const, ${rAnim} animated`)
  console.log(`  T: ${tIdent} identity, ${tConst} const, ${tAnim} animated`)
  console.log(`  S: ${sIdent} identity, ${sConst} const, ${sAnim} animated`)
  console.log(`  valA=${valA} vs rConst+rAnim=${rConst + rAnim}, rConst=${rConst}, rAnim=${rAnim}`)
  console.log(`  valB=${valB} vs tConst+tAnim=${tConst + tAnim}+rAll=${rConst + rAnim + tConst + tAnim}`)
  console.log(`  valC=${valC} vs boneCount=${boneCount}`)

  // Now try to read data sections
  const dataStart = bitfieldStart + bitfieldBytes
  console.log(`\nData starts at AC+${dataStart - AC} (file offset ${dataStart})`)

  // Try both 4-float and 3-float quaternion interpretations
  for (const quatSize of [4, 3]) {
    let off = dataStart
    console.log(`\n${'='.repeat(60)}`)
    console.log(`--- Attempting with ${quatSize}-float quaternions ---`)

    console.log(`\n  Constant rotations (R=1):`)
    let rotOK = true
    for (let b = 0; b < boneCount; b++) {
      if (rTypes[b] === 1) {
        if (off + quatSize * 4 > data.length) { rotOK = false; break }
        const vals: number[] = []
        for (let i = 0; i < quatSize; i++) vals.push(f32(off + i * 4))
        let mag: number
        if (quatSize === 4) {
          mag = Math.sqrt(vals.reduce((s, v) => s + v * v, 0))
        } else {
          const sumSq = vals.reduce((s, v) => s + v * v, 0)
          mag = sumSq <= 1.0 ? 1.0 : Math.sqrt(sumSq)
        }
        const ok = quatSize === 4 ? Math.abs(mag - 1.0) < 0.05 : vals.every(v => Math.abs(v) <= 1.01)
        if (!ok) rotOK = false
        console.log(`    bone[${b.toString().padStart(2)}] [${vals.map(v => v.toFixed(6)).join(', ')}] mag=${mag.toFixed(4)} ${ok ? '✓' : '✗'}`)
        off += quatSize * 4
      }
    }
    console.log(`  Rotation validity: ${rotOK ? 'ALL OK' : 'FAILED'}`)

    console.log(`\n  Constant positions (T=1):`)
    let posOK = true
    for (let b = 0; b < boneCount; b++) {
      if (tTypes[b] === 1) {
        if (off + 12 > data.length) { posOK = false; break }
        const p = [f32(off), f32(off + 4), f32(off + 8)]
        const ok = p.every(v => isFinite(v) && Math.abs(v) < 10000)
        if (!ok) posOK = false
        console.log(`    bone[${b.toString().padStart(2)}] [${p.map(v => v.toFixed(6)).join(', ')}] ${ok ? '✓' : '✗'}`)
        off += 12
      }
    }
    console.log(`  Position validity: ${posOK ? 'ALL OK' : 'FAILED'}`)

    console.log(`\n  Constant scales (S=1):`)
    let scaleOK = true
    for (let b = 0; b < boneCount; b++) {
      if (sTypes[b] === 1) {
        if (off + 12 > data.length) { scaleOK = false; break }
        const s = [f32(off), f32(off + 4), f32(off + 8)]
        const ok = s.every(v => isFinite(v) && Math.abs(v) < 100)
        if (!ok) scaleOK = false
        console.log(`    bone[${b.toString().padStart(2)}] [${s.map(v => v.toFixed(6)).join(', ')}] ${ok ? '' : '✗'}`)
        off += 12
      }
    }

    console.log(`\n  After constants: AC+${off - AC} (${off - dataStart} bytes consumed)`)
    console.log(`  Remaining: ${AC + dataSize - off} bytes`)
    console.log(`  VERDICT: rot=${rotOK ? 'OK' : 'FAIL'} pos=${posOK ? 'OK' : 'FAIL'} scale=${scaleOK ? 'OK' : 'FAIL'}`)
  }
}

main()
