#!/usr/bin/env npx tsx
/**
 * Investigate animated channel data (bitfield type=2) in V1 AC11 animations.
 * Goal: understand the tail section (after secOff[3]) structure.
 */

import { readFileSync, readdirSync } from 'fs'
import { resolve, join } from 'path'

const ANIM_MAGIC = 0x6AB06AB0

interface AnimFile {
  name: string
  data: Buffer
  view: DataView
}

function loadV1Anims(dir: string): AnimFile[] {
  const files = readdirSync(dir).filter(f => f.endsWith('.anim'))
  const anims: AnimFile[] = []
  for (const f of files) {
    const data = readFileSync(join(dir, f))
    if (data.length < 0xB4) continue
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
    if (view.getUint32(0, true) !== ANIM_MAGIC) continue
    if (view.getUint32(0x48, true) === 0xFFFFFFFF) continue // skip V0
    anims.push({ name: f, data, view })
  }
  return anims
}

function analyze(a: AnimFile) {
  const { view, data, name } = a
  const AC = 0x60
  const u32 = (o: number) => view.getUint32(o, true)
  const u16 = (o: number) => view.getUint16(o, true)
  const f32 = (o: number) => view.getFloat32(o, true)

  const dataSize = u32(AC + 0x00)
  const boneCount = u32(AC + 0x10)
  const lastFrame = u32(AC + 0x14)
  const fps = f32(AC + 0x18)
  const count1 = u32(AC + 0x20)
  const count2 = u32(AC + 0x24)
  const count3 = u32(AC + 0x28)
  const count4 = u32(AC + 0x2C)
  const valA = u32(AC + 0x34)
  const valB = u32(AC + 0x38)
  const valC = u32(AC + 0x3C)
  const frameCount = lastFrame + 1

  const secOff = [u32(AC + 0x44), u32(AC + 0x48), u32(AC + 0x4C), u32(AC + 0x50)]

  // Navigate to bitfield
  let cursor = AC + 0x44 + 16
  if (count1 >= 2) cursor += count1 * 4 + 4

  // Read segment groups
  const segGroups: number[][] = []
  for (let s = 0; s < count1; s++) {
    segGroups.push([u32(cursor), u32(cursor + 4), u32(cursor + 8), u32(cursor + 12)])
    cursor += 16
  }

  // Read bitfield
  const bitfieldSize = secOff[2] - secOff[1]
  const bitfieldStart = cursor
  const channelTypes: number[] = []
  const wordCount = Math.ceil(bitfieldSize / 4)
  for (let w = 0; w < wordCount; w++) {
    const word = u32(bitfieldStart + w * 4)
    for (let i = 0; i < 16; i++) channelTypes.push((word >>> (i * 2)) & 3)
  }

  // Channel types
  const rTypes: number[] = [], tTypes: number[] = [], sTypes: number[] = []
  for (let b = 0; b < boneCount; b++) rTypes.push(channelTypes[b] ?? 0)
  for (let b = 0; b < boneCount; b++) tTypes.push(channelTypes[boneCount + b] ?? 0)
  for (let b = 0; b < boneCount; b++) sTypes.push(channelTypes[2 * boneCount + b] ?? 0)

  const rAnim = rTypes.filter(v => v === 2).length
  const tAnim = tTypes.filter(v => v === 2).length
  const sAnim = sTypes.filter(v => v === 2).length
  const totalAnim = rAnim + tAnim + sAnim

  if (totalAnim === 0) return null // skip files with no animated channels

  const tailSize = dataSize - secOff[3]

  console.log(`\n${'='.repeat(80)}`)
  console.log(`FILE: ${name}`)
  console.log(`  bones=${boneCount}, frames=${frameCount}, fps=${fps}, count1=${count1}`)
  console.log(`  valA=${valA} valB=${valB} valC=${valC}`)
  console.log(`  secOff=[${secOff.join(', ')}]`)
  console.log(`  sec sizes: [${secOff[1]-secOff[0]}, ${secOff[2]-secOff[1]}, ${secOff[3]-secOff[2]}, ${tailSize}]`)
  console.log(`  animated: R=${rAnim} T=${tAnim} S=${sAnim} total=${totalAnim}`)
  console.log(`  count2=${count2} count3=${count3} count4=${count4}`)

  // Segment groups
  console.log(`  Segment groups:`)
  for (let s = 0; s < count1; s++) {
    const g = segGroups[s]
    console.log(`    seg[${s}]: [${g.join(', ')}]`)
  }

  // Check relationships
  console.log(`  Relationships:`)
  console.log(`    tailSize / totalAnim = ${(tailSize / totalAnim).toFixed(1)}`)
  console.log(`    tailSize / (totalAnim * frameCount) = ${(tailSize / (totalAnim * frameCount)).toFixed(4)}`)
  console.log(`    tailSize / (totalAnim * count1) = ${(tailSize / (totalAnim * count1)).toFixed(4)}`)

  // Compute frames per segment
  const frameBounds: number[] = []
  let fbCursor = AC + 0x44 + 16
  if (count1 >= 2) {
    for (let i = 0; i < count1; i++) {
      frameBounds.push(u32(fbCursor))
      fbCursor += 4
    }
  } else {
    frameBounds.push(0)
  }
  const segFrames: number[] = []
  for (let s = 0; s < count1; s++) {
    const start = frameBounds[s]
    const end = s < count1 - 1 ? frameBounds[s + 1] : frameCount
    segFrames.push(end - start)
  }
  console.log(`    frameBounds=[${frameBounds.join(', ')}] segFrames=[${segFrames.join(', ')}]`)

  // Examine segment group values vs animated channel counts
  for (let s = 0; s < count1; s++) {
    const g = segGroups[s]
    console.log(`    seg[${s}]: g[0]=${g[0]} g[1]=${g[1]} g[2]=${g[2]} g[3]=${g[3]}`)
    console.log(`      g[0]+g[1]+g[2]=${g[0]+g[1]+g[2]} vs totalAnim=${totalAnim}`)
    console.log(`      g[0] vs rAnim=${rAnim}, g[1] vs tAnim=${tAnim}, g[2] vs sAnim=${sAnim}`)
  }

  // Tail section: dump first 128 bytes as different interpretations
  const tailStart = AC + secOff[3]
  console.log(`\n  Tail section starts at file offset 0x${tailStart.toString(16)} (AC+${secOff[3]})`)
  const dumpBytes = Math.min(tailSize, 256)

  // Try reading as float32
  console.log(`  First ${dumpBytes} bytes as float32:`)
  for (let off = tailStart; off + 4 <= tailStart + dumpBytes; off += 4) {
    const val = f32(off)
    const uval = u32(off)
    const relOff = off - tailStart
    const isValidFloat = isFinite(val) && Math.abs(val) < 10000
    const marker = isValidFloat ? (Math.abs(val) <= 1.01 ? ' [quat?]' : Math.abs(val) < 100 ? ' [pos?]' : '') : ' [not float]'
    if (relOff < 64) {
      console.log(`    +${relOff.toString().padStart(4)}: ${val.toFixed(6).padStart(14)} (0x${uval.toString(16).padStart(8, '0')})${marker}`)
    }
  }

  // Try reading as uint16 pairs
  console.log(`  First 64 bytes as uint16:`)
  for (let off = tailStart; off + 2 <= tailStart + 64 && off + 2 <= data.length; off += 2) {
    const val = u16(off)
    const relOff = off - tailStart
    if (relOff < 32) {
      console.log(`    +${relOff.toString().padStart(4)}: ${val.toString().padStart(6)} (0x${val.toString(16).padStart(4, '0')})`)
    }
  }

  // Try reading as bytes
  console.log(`  First 32 bytes as uint8:`)
  const bytes: number[] = []
  for (let i = 0; i < 32 && tailStart + i < data.length; i++) {
    bytes.push(data[tailStart + i])
  }
  console.log(`    ${bytes.map(b => b.toString(16).padStart(2, '0')).join(' ')}`)

  // Look for patterns: check if data could be quantized to uint16
  // If animated rot uses uint16 per component (3 components), each frame = 6 bytes per bone
  const bytesPerFrameU16Rot = rAnim * 6
  const bytesPerFrameU16Pos = tAnim * 6
  const bytesPerFrameU16Scale = sAnim * 6
  const bytesPerFrameU16All = bytesPerFrameU16Rot + bytesPerFrameU16Pos + bytesPerFrameU16Scale
  console.log(`\n  If uint16×3 per animated channel per frame:`)
  console.log(`    per frame: ${bytesPerFrameU16All} bytes`)
  console.log(`    total: ${bytesPerFrameU16All * frameCount} vs tailSize=${tailSize}`)

  // If animated uses float32×3 per frame
  const bytesPerFrameF32 = totalAnim * 12
  console.log(`  If float32×3 per animated channel per frame:`)
  console.log(`    per frame: ${bytesPerFrameF32} bytes`)
  console.log(`    total: ${bytesPerFrameF32 * frameCount} vs tailSize=${tailSize}`)

  // Per-segment analysis
  console.log(`  Per-segment data size analysis:`)
  let segDataSum = 0
  for (let s = 0; s < count1; s++) {
    const frames = segFrames[s]
    const u16Size = bytesPerFrameU16All * frames
    const f32Size = bytesPerFrameF32 * frames
    console.log(`    seg[${s}]: ${frames} frames, u16→${u16Size}, f32→${f32Size}`)
    segDataSum += u16Size
  }
  console.log(`    u16 total across segments: ${segDataSum} vs tailSize=${tailSize}`)

  // Check if tailSize matches totalAnim * framesPerChannel * someSize + header
  for (const entrySize of [2, 4, 6, 8, 12]) {
    const totalEntries = tailSize / entrySize
    const perChannel = totalEntries / totalAnim
    const perChannelPerFrame = perChannel / frameCount
    if (Number.isInteger(totalEntries)) {
      console.log(`    entrySize=${entrySize}: ${totalEntries} entries, ${perChannel.toFixed(1)}/channel, ${perChannelPerFrame.toFixed(2)}/channel/frame`)
    }
  }

  return { rAnim, tAnim, sAnim, tailSize, frameCount, count1, segGroups, segFrames, totalAnim }
}

function main() {
  const dir = resolve(process.argv[2] || '')
  const anims = loadV1Anims(dir)
  console.log(`Loaded ${anims.length} V1 anims`)

  // Sort by file size, pick ones with animated channels
  anims.sort((a, b) => a.data.length - b.data.length)

  let analyzed = 0
  for (const a of anims) {
    const result = analyze(a)
    if (result) {
      analyzed++
      if (analyzed >= 5) break // analyze first 5 with animated channels
    }
  }

  // Statistical analysis: segment group patterns
  console.log(`\n\n${'='.repeat(80)}`)
  console.log('STATISTICAL ANALYSIS')
  console.log(`${'='.repeat(80)}`)

  const stats: { name: string, rAnim: number, tAnim: number, sAnim: number, tailSize: number,
    frameCount: number, count1: number, segGroups: number[][], segFrames: number[], totalAnim: number }[] = []

  for (const a of anims) {
    const { view, data } = a
    const AC = 0x60
    const u32 = (o: number) => view.getUint32(o, true)
    const dataSize = u32(AC + 0x00)
    const boneCount = u32(AC + 0x10)
    const lastFrame = u32(AC + 0x14)
    const count1 = u32(AC + 0x20)
    const valA = u32(AC + 0x34)
    const valB = u32(AC + 0x38)
    const valC = u32(AC + 0x3C)
    const secOff = [u32(AC + 0x44), u32(AC + 0x48), u32(AC + 0x4C), u32(AC + 0x50)]
    const frameCount = lastFrame + 1

    let cursor = AC + 0x44 + 16
    const frameBounds: number[] = []
    if (count1 >= 2) {
      for (let i = 0; i < count1; i++) { frameBounds.push(u32(cursor)); cursor += 4 }
      cursor += 4
    } else {
      frameBounds.push(0)
    }

    const segGroups: number[][] = []
    for (let s = 0; s < count1; s++) {
      segGroups.push([u32(cursor), u32(cursor + 4), u32(cursor + 8), u32(cursor + 12)])
      cursor += 16
    }

    const bitfieldSize = secOff[2] - secOff[1]
    const channelTypes: number[] = []
    const wordCount = Math.ceil(bitfieldSize / 4)
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
    const totalAnim = rAnim + tAnim + sAnim
    if (totalAnim === 0) continue

    const tailSize = dataSize - secOff[3]
    const segFrames: number[] = []
    for (let s = 0; s < count1; s++) {
      const start = frameBounds[s]
      const end = s < count1 - 1 ? frameBounds[s + 1] : frameCount
      segFrames.push(end - start)
    }

    stats.push({ name: a.name, rAnim, tAnim, sAnim, tailSize, frameCount, count1, segGroups, segFrames, totalAnim })
  }

  console.log(`\nFiles with animated channels: ${stats.length}`)

  // Check if segGroup[s] values relate to animated counts
  console.log(`\nSegment group[0] analysis (first segment):`)
  let g0MatchR = 0, g1MatchT = 0, g2MatchS = 0, g3Match = 0
  for (const s of stats) {
    const g = s.segGroups[0]
    if (g[0] === s.rAnim) g0MatchR++
    if (g[1] === s.tAnim) g1MatchT++
    if (g[2] === s.sAnim) g2MatchS++
    if (g[3] === 0) g3Match++
  }
  console.log(`  g[0]==rAnim: ${g0MatchR}/${stats.length}`)
  console.log(`  g[1]==tAnim: ${g1MatchT}/${stats.length}`)
  console.log(`  g[2]==sAnim: ${g2MatchS}/${stats.length}`)
  console.log(`  g[3]==0: ${g3Match}/${stats.length}`)

  // Check tail size formulas
  console.log(`\nTail size analysis:`)
  let matchU16 = 0, matchF32 = 0
  for (const s of stats) {
    const u16Expected = s.totalAnim * s.frameCount * 6
    const f32Expected = s.totalAnim * s.frameCount * 12
    if (s.tailSize === u16Expected) matchU16++
    if (s.tailSize === f32Expected) matchF32++
  }
  console.log(`  tailSize == totalAnim*frames*6 (u16×3): ${matchU16}/${stats.length}`)
  console.log(`  tailSize == totalAnim*frames*12 (f32×3): ${matchF32}/${stats.length}`)

  // Per-segment tail size
  console.log(`\nPer-segment formulas:`)
  let matchSegU16 = 0, matchSegF32 = 0
  for (const s of stats) {
    let u16Sum = 0, f32Sum = 0
    for (let seg = 0; seg < s.count1; seg++) {
      u16Sum += s.totalAnim * s.segFrames[seg] * 6
      f32Sum += s.totalAnim * s.segFrames[seg] * 12
    }
    if (s.tailSize === u16Sum) matchSegU16++
    if (s.tailSize === f32Sum) matchSegF32++
  }
  console.log(`  sum(totalAnim*segFrames*6): ${matchSegU16}/${stats.length}`)
  console.log(`  sum(totalAnim*segFrames*12): ${matchSegF32}/${stats.length}`)

  // Try other formulas involving count2, count3, count4
  console.log(`\ncount2/count3/count4 relationships:`)
  for (const s of stats.slice(0, 10)) {
    const { view } = anims.find(a => a.name === s.name)!
    const AC = 0x60
    const count2 = view.getUint32(AC + 0x24, true)
    const count3 = view.getUint32(AC + 0x28, true)
    const count4 = view.getUint32(AC + 0x2C, true)
    console.log(`  ${s.name}: c2=${count2} c3=${count3} c4=${count4} rA=${s.rAnim} tA=${s.tAnim} sA=${s.sAnim} tail=${s.tailSize} frames=${s.frameCount}`)
    console.log(`    c2==rAnim? ${count2===s.rAnim} c3==tAnim? ${count3===s.tAnim} c4==sAnim? ${count4===s.sAnim}`)
    console.log(`    c2==rAnim+tAnim? ${count2===s.rAnim+s.tAnim} c2+c3==${count2+count3} vs totalAnim=${s.totalAnim}`)
    console.log(`    tail/(c2+c3+c4) = ${(s.tailSize/(count2+count3+count4)).toFixed(2)}`)
    console.log(`    tail/frames = ${(s.tailSize/s.frameCount).toFixed(2)}`)
  }
}

main()
