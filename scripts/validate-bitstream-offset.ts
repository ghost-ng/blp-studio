#!/usr/bin/env npx tsx
/**
 * Validate bitstream offset computation for ALL segments (including last).
 * Tests backwards approach: bsStart = bodyEnd - bitstreamBytes
 * for both non-last (bodyEnd = BASE + next.g[3]) and last (bodyEnd = AC + dataSize).
 *
 * Also decodes frames and checks smoothness to validate correctness.
 */

import { readFileSync, readdirSync } from 'fs'
import { resolve, join } from 'path'

const dir = resolve(process.argv[2] || '')
const files = readdirSync(dir).filter(f => f.endsWith('.anim'))

let totalSegs = 0, smoothSegs = 0, sizeMatchSegs = 0

for (const file of files) {
  const filepath = join(dir, file)
  const data = readFileSync(filepath)
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const u32 = (o: number) => view.getUint32(o, true)
  const f32 = (o: number) => view.getFloat32(o, true)

  const magic = u32(0)
  if (magic !== 0x6AB06AB0) continue
  if (u32(0x48) === 0xFFFFFFFF) continue // V0

  const AC = 0x60
  const BASE = AC + 0x20

  const frameCount = u32(0x0C)
  const dataSize = u32(AC + 0x00)
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

  const rAnim = Array.from({length: boneCount}, (_, b) => channelTypes[b] ?? 0).filter(v => v === 2).length
  const tAnim = Array.from({length: boneCount}, (_, b) => channelTypes[boneCount + b] ?? 0).filter(v => v === 2).length
  const sAnim = Array.from({length: boneCount}, (_, b) => channelTypes[2 * boneCount + b] ?? 0).filter(v => v === 2).length
  const totalAnim = rAnim + tAnim + sAnim

  cursor += bfSize
  cursor += valA * 12 + valB * 12 + valC * 12

  // Read animated headers
  const headers: { offset: [number,number,number]; scale: [number,number,number] }[] = []
  for (let i = 0; i < totalAnim; i++) {
    headers.push({
      offset: [f32(cursor), f32(cursor+4), f32(cursor+8)],
      scale:  [f32(cursor+12), f32(cursor+16), f32(cursor+20)],
    })
    cursor += 24
  }

  console.log(`\n=== ${file}: bones=${boneCount} frames=${frameCount} segs=${count1} rAnim=${rAnim} tAnim=${tAnim} sAnim=${sAnim} ===`)
  console.log(`  dataSize=${dataSize} → lastBodyEnd=0x${(AC + dataSize).toString(16)}`)

  for (let seg = 0; seg < count1; seg++) {
    const g = segGroups[seg]
    if (g[0] === 0) continue

    const segStart = frameBounds[seg]
    const segEnd = seg < count1 - 1 ? frameBounds[seg + 1] : frameCount
    const segFrames = segEnd - segStart

    const bodyStart = BASE + g[3]

    // Read bit widths
    const bw: number[] = []
    for (let i = 0; i < totalAnim; i++) bw.push(data[bodyStart + i])
    const sumBW = bw.reduce((a, b) => a + b, 0)
    const bitsPerFrame = sumBW * 3
    const bitstreamBytes = Math.ceil(bitsPerFrame * segFrames / 8)

    // Body end: backwards approach
    const bodyEnd = seg < count1 - 1
      ? BASE + segGroups[seg + 1][3]
      : AC + dataSize

    const bsStart_backwards = bodyEnd - bitstreamBytes
    const initDataSize = bsStart_backwards - bodyStart - totalAnim

    // Formula approach
    const initSize_formula = totalAnim * 6 + Math.ceil(rAnim / 8)
    let bsStart_formula = bodyStart + totalAnim + initSize_formula
    if (bsStart_formula & 1) bsStart_formula++

    const formulaMatch = bsStart_backwards === bsStart_formula

    console.log(`  seg${seg}: ${segFrames}f bodyStart=0x${bodyStart.toString(16)} bodyEnd=0x${bodyEnd.toString(16)} bodySize=${bodyEnd - bodyStart}`)
    console.log(`    backwards: bsStart=0x${bsStart_backwards.toString(16)} initData=${initDataSize}B`)
    console.log(`    formula:   bsStart=0x${bsStart_formula.toString(16)} initSize=${initSize_formula}B`)
    console.log(`    match=${formulaMatch} g[0]=${g[0]} bitsPerFrame=${bitsPerFrame} check=${g[0] === bitsPerFrame}`)

    // Validate: bsStart must be after bit widths
    if (bsStart_backwards <= bodyStart + totalAnim) {
      console.log(`    *** ERROR: bsStart is before/at bit widths end!`)
      continue
    }

    // Decode frames using backwards approach and check smoothness
    let bitPos = 0
    let maxDelta = 0
    let prevValues: number[][] | null = null

    for (let f = 0; f < segFrames; f++) {
      const frameValues: number[][] = []
      for (let ch = 0; ch < totalAnim; ch++) {
        const w = bw[ch]
        if (w === 0) {
          frameValues.push([headers[ch].offset[0], headers[ch].offset[1], headers[ch].offset[2]])
          continue
        }

        let qx = 0, qy = 0, qz = 0
        for (let i = 0; i < w; i++) {
          const p = bitPos + i
          qx |= ((data[bsStart_backwards + (p >> 3)] >> (p & 7)) & 1) << i
        }
        bitPos += w
        for (let i = 0; i < w; i++) {
          const p = bitPos + i
          qy |= ((data[bsStart_backwards + (p >> 3)] >> (p & 7)) & 1) << i
        }
        bitPos += w
        for (let i = 0; i < w; i++) {
          const p = bitPos + i
          qz |= ((data[bsStart_backwards + (p >> 3)] >> (p & 7)) & 1) << i
        }
        bitPos += w

        const maxQ = (1 << w) - 1
        const h = headers[ch]
        frameValues.push([
          h.offset[0] + (qx / maxQ) * h.scale[0],
          h.offset[1] + (qy / maxQ) * h.scale[1],
          h.offset[2] + (qz / maxQ) * h.scale[2],
        ])
      }

      if (prevValues) {
        for (let ch = 0; ch < totalAnim; ch++) {
          for (let c = 0; c < 3; c++) {
            const delta = Math.abs(frameValues[ch][c] - prevValues[ch][c])
            if (delta > maxDelta) maxDelta = delta
          }
        }
      }
      prevValues = frameValues
    }

    const bitsConsumed = bitPos
    const bytesConsumed = Math.ceil(bitsConsumed / 8)
    const sizeCheck = bytesConsumed === bitstreamBytes
    const smooth = maxDelta < 10

    totalSegs++
    if (smooth) smoothSegs++
    if (sizeCheck) sizeMatchSegs++

    console.log(`    decode: maxDelta=${maxDelta.toFixed(4)} ${smooth ? 'SMOOTH' : 'JUMPY'} sizeCheck=${sizeCheck} (consumed=${bytesConsumed} expected=${bitstreamBytes})`)
  }
}

console.log(`\n=== SUMMARY ===`)
console.log(`Total segments: ${totalSegs}`)
console.log(`Smooth: ${smoothSegs}/${totalSegs}`)
console.log(`Size match: ${sizeMatchSegs}/${totalSegs}`)
