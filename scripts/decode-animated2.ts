#!/usr/bin/env npx tsx
/**
 * Deep analysis of animated tail section encoding.
 * Focus on understanding g[3] offset and data layout.
 */

import { readFileSync, readdirSync } from 'fs'
import { resolve, join } from 'path'

const ANIM_MAGIC = 0x6AB06AB0

function main() {
  const dir = resolve(process.argv[2] || '')
  const files = readdirSync(dir).filter(f => f.endsWith('.anim'))

  interface Info {
    name: string
    data: Buffer
    view: DataView
    boneCount: number
    frameCount: number
    count1: number
    count2: number
    count3: number
    count4: number
    valA: number
    valB: number
    valC: number
    secOff: number[]
    segGroups: number[][]
    segFrames: number[]
    rTypes: number[]
    tTypes: number[]
    sTypes: number[]
    rAnim: number
    tAnim: number
    sAnim: number
    totalAnim: number
    dataSize: number
    tailSize: number
  }

  const infos: Info[] = []

  for (const f of files) {
    const data = readFileSync(join(dir, f))
    if (data.length < 0xB4) continue
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
    if (view.getUint32(0, true) !== ANIM_MAGIC) continue
    if (view.getUint32(0x48, true) === 0xFFFFFFFF) continue

    const AC = 0x60
    const u32 = (o: number) => view.getUint32(o, true)

    const dataSize = u32(AC + 0x00)
    const boneCount = u32(AC + 0x10)
    const lastFrame = u32(AC + 0x14)
    const count1 = u32(AC + 0x20)
    const count2 = u32(AC + 0x24)
    const count3 = u32(AC + 0x28)
    const count4 = u32(AC + 0x2C)
    const valA = u32(AC + 0x34)
    const valB = u32(AC + 0x38)
    const valC = u32(AC + 0x3C)
    const frameCount = lastFrame + 1
    const secOff = [u32(AC + 0x44), u32(AC + 0x48), u32(AC + 0x4C), u32(AC + 0x50)]

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

    infos.push({
      name: f, data, view, boneCount, frameCount, count1, count2, count3, count4,
      valA, valB, valC, secOff, segGroups, segFrames,
      rTypes, tTypes, sTypes, rAnim, tAnim, sAnim, totalAnim, dataSize, tailSize
    })
  }

  console.log(`Files with animated channels: ${infos.length}`)

  // ANALYSIS 1: g[3] offset analysis
  console.log('\n=== g[3] OFFSET ANALYSIS ===')
  console.log('Testing if g[3] - secOff[3] = per-channel header size')

  const headerSizes = new Map<string, number>()
  for (const info of infos) {
    const g3 = info.segGroups[0][3]
    const headerSize = g3 - info.secOff[3]
    const key = `rA=${info.rAnim},tA=${info.tAnim},sA=${info.sAnim}`
    if (!headerSizes.has(key)) headerSizes.set(key, headerSize)
  }

  for (const [key, size] of [...headerSizes.entries()].sort()) {
    const parts = key.match(/rA=(\d+),tA=(\d+),sA=(\d+)/)!
    const rA = parseInt(parts[1]), tA = parseInt(parts[2]), sA = parseInt(parts[3])
    const totalAnim = rA + tA + sA
    console.log(`  ${key}: headerSize=${size}, per_channel=${(size/totalAnim).toFixed(1)}, /${3}comp=${(size/(totalAnim*3)).toFixed(1)}`)
  }

  // ANALYSIS 2: Do ALL files with same (rA,tA,sA) have same header size?
  console.log('\n=== HEADER SIZE CONSISTENCY ===')
  const headerByKey = new Map<string, Set<number>>()
  for (const info of infos) {
    const g3 = info.segGroups[0][3]
    const headerSize = g3 - info.secOff[3]
    const key = `rA=${info.rAnim},tA=${info.tAnim},sA=${info.sAnim}`
    if (!headerByKey.has(key)) headerByKey.set(key, new Set())
    headerByKey.get(key)!.add(headerSize)
  }
  let consistent = 0, inconsistent = 0
  for (const [key, sizes] of headerByKey) {
    if (sizes.size === 1) consistent++
    else {
      inconsistent++
      console.log(`  INCONSISTENT: ${key} → header sizes: [${[...sizes].sort((a,b)=>a-b).join(', ')}]`)
    }
  }
  console.log(`  Consistent: ${consistent}, Inconsistent: ${inconsistent}`)

  // ANALYSIS 3: header size = f(animated components)
  console.log('\n=== HEADER SIZE FORMULA ===')
  // Try: header = rotAnim*rotHeaderSize + posAnim*posHeaderSize + scaleAnim*scaleHeaderSize
  // Collect data points: header, rA, tA, sA
  const dataPoints: {header: number, rA: number, tA: number, sA: number}[] = []
  for (const info of infos) {
    const g3 = info.segGroups[0][3]
    const header = g3 - info.secOff[3]
    dataPoints.push({ header, rA: info.rAnim, tA: info.tAnim, sA: info.sAnim })
  }

  // Find unique combos
  const combos = new Map<string, number>()
  for (const dp of dataPoints) {
    const key = `${dp.rA},${dp.tA},${dp.sA}`
    combos.set(key, dp.header)
  }

  // Try: header = rA * a + tA * b + sA * c
  // Solve system of equations
  console.log('  Unique (rA, tA, sA) → header:')
  for (const [key, header] of [...combos.entries()].sort()) {
    const [r, t, s] = key.split(',').map(Number)
    console.log(`    (${r}, ${t}, ${s}) → ${header}`)
  }

  // Try specific values for rot=48, pos=36, scale=36 (vec3+min+max = 9 floats * 4 bytes)
  for (const [rSize, pSize, sSize] of [[48, 36, 36], [36, 36, 36], [48, 36, 12], [36, 24, 24], [48, 24, 24], [24, 24, 24], [12, 12, 12]]) {
    let match = 0
    for (const [key, header] of combos) {
      const [r, t, s] = key.split(',').map(Number)
      if (r * rSize + t * pSize + s * sSize === header) match++
    }
    if (match > combos.size * 0.5) {
      console.log(`  ✓ Formula: R*${rSize} + T*${pSize} + S*${sSize} matches ${match}/${combos.size}`)
    }
  }

  // ANALYSIS 4: Body size (after header) encoding
  console.log('\n=== BODY SIZE ANALYSIS ===')
  console.log('Testing: body = sum(seg_g[0]) * entrySize')

  for (const entrySize of [1, 2, 3, 4, 6, 8]) {
    let match = 0
    for (const info of infos) {
      const g3 = info.segGroups[0][3]
      const headerSize = g3 - info.secOff[3]
      const body = info.tailSize - headerSize
      const totalG0 = info.segGroups.reduce((sum, g) => sum + g[0], 0)
      if (totalG0 * entrySize === body) match++
    }
    if (match > 0) console.log(`  body = sum(g[0]) * ${entrySize}: ${match}/${infos.length}`)
  }

  // Also try: body = sum over segments of g[i][0] * entrySize
  // But with per-segment different sizes

  // ANALYSIS 5: g[0] vs frames relationship
  console.log('\n=== g[0] vs FRAMES ===')
  // For single-segment files
  const singleSeg = infos.filter(i => i.count1 === 1)
  console.log(`Single-segment files: ${singleSeg.length}`)

  const g0FrameRatios = new Map<string, Set<number>>()
  for (const info of singleSeg) {
    const g0 = info.segGroups[0][0]
    const ratio = g0 / info.frameCount
    const key = `rA=${info.rAnim},tA=${info.tAnim},sA=${info.sAnim}`
    if (!g0FrameRatios.has(key)) g0FrameRatios.set(key, new Set())
    g0FrameRatios.get(key)!.add(Math.round(ratio * 1000) / 1000) // round to 3dp
  }
  console.log('  g[0]/frameCount ratios:')
  for (const [key, ratios] of [...g0FrameRatios.entries()].sort()) {
    console.log(`    ${key}: [${[...ratios].sort((a,b)=>a-b).slice(0, 10).join(', ')}${ratios.size > 10 ? '...' : ''}] (${ratios.size} unique)`)
  }

  // ANALYSIS 6: Multi-segment file deep analysis
  console.log('\n=== MULTI-SEGMENT g[3] VALUES ===')
  const multiSeg = infos.filter(i => i.count1 >= 2).slice(0, 10)
  for (const info of multiSeg) {
    console.log(`  ${info.name}: count1=${info.count1}, frames=${info.frameCount}`)
    const g3values: number[] = []
    for (let s = 0; s < info.count1; s++) {
      const g = info.segGroups[s]
      g3values.push(g[3])
      console.log(`    seg[${s}]: g=[${g.join(', ')}], segFrames=${info.segFrames[s]}`)
    }
    // Check if g[3] values are cumulative
    for (let s = 1; s < info.count1; s++) {
      const diff = info.segGroups[s][3] - info.segGroups[s-1][3]
      const prevG0 = info.segGroups[s-1][0]
      console.log(`    g[3] diff ${s-1}→${s}: ${diff}, prev g[0]=${prevG0}, diff/prevG0=${(diff/prevG0).toFixed(2)}`)
    }
    // Total g[0] across segments
    const totalG0 = info.segGroups.reduce((s, g) => s + g[0], 0)
    console.log(`    total g[0]=${totalG0}, tailSize=${info.tailSize}`)
  }

  // ANALYSIS 7: Detailed byte dump of smallest file
  console.log('\n=== DETAILED BYTE DUMP ===')
  const smallest = infos.sort((a, b) => a.tailSize - b.tailSize)[0]
  if (smallest) {
    const AC = 0x60
    const tailStart = AC + smallest.secOff[3]
    const g3offset = AC + smallest.segGroups[0][3]

    console.log(`File: ${smallest.name}`)
    console.log(`  bones=${smallest.boneCount}, frames=${smallest.frameCount}, tail=${smallest.tailSize}`)
    console.log(`  rA=${smallest.rAnim}, tA=${smallest.tAnim}, sA=${smallest.sAnim}`)
    console.log(`  g=[${smallest.segGroups[0].join(', ')}]`)
    console.log(`  tailStart=AC+${smallest.secOff[3]}, g3offset=AC+${smallest.segGroups[0][3]}`)
    console.log(`  headerSize=${smallest.segGroups[0][3] - smallest.secOff[3]}`)

    // Animated bone indices
    console.log(`  Animated bones:`)
    for (let b = 0; b < smallest.boneCount; b++) {
      if (smallest.rTypes[b] === 2) console.log(`    bone[${b}]: R=animated`)
      if (smallest.tTypes[b] === 2) console.log(`    bone[${b}]: T=animated`)
      if (smallest.sTypes[b] === 2) console.log(`    bone[${b}]: S=animated`)
    }

    // Full hex dump with annotations
    console.log(`\n  Header region (tailStart to g[3]):`)
    const headerSize = smallest.segGroups[0][3] - smallest.secOff[3]
    for (let off = 0; off < headerSize; off += 4) {
      const absOff = tailStart + off
      if (absOff + 4 > smallest.data.length) break
      const v = smallest.view
      const u = v.getUint32(absOff, true)
      const f = v.getFloat32(absOff, true)
      const u16a = v.getUint16(absOff, true)
      const u16b = v.getUint16(absOff + 2, true)
      const fStr = isFinite(f) && Math.abs(f) < 1e6 ? f.toFixed(6) : 'N/A'
      console.log(`    +${off.toString().padStart(3)}: 0x${u.toString(16).padStart(8, '0')} | u32=${u.toString().padStart(10)} | f32=${fStr.padStart(14)} | u16=[${u16a}, ${u16b}]`)
    }

    console.log(`\n  Body region (g[3] to end):`)
    const bodyStart = g3offset
    const bodySize = smallest.tailSize - headerSize
    for (let off = 0; off < Math.min(bodySize, 128); off += 4) {
      const absOff = bodyStart + off
      if (absOff + 4 > smallest.data.length) break
      const v = smallest.view
      const u = v.getUint32(absOff, true)
      const f = v.getFloat32(absOff, true)
      const u16a = v.getUint16(absOff, true)
      const u16b = v.getUint16(absOff + 2, true)
      const u8s = [smallest.data[absOff], smallest.data[absOff+1], smallest.data[absOff+2], smallest.data[absOff+3]]
      const fStr = isFinite(f) && Math.abs(f) < 1e6 ? f.toFixed(6) : 'N/A'
      console.log(`    +${off.toString().padStart(3)}: 0x${u.toString(16).padStart(8, '0')} | f32=${fStr.padStart(14)} | u16=[${u16a.toString().padStart(5)}, ${u16b.toString().padStart(5)}] | u8=[${u8s.join(',')}]`)
    }
  }

  // ANALYSIS 8: g[1], g[2] meaning - are they per-channel-type counts?
  console.log('\n=== g[1], g[2] vs CHANNEL TYPES ===')
  // For files with rAnim=0, g[1] and g[2] might be T and S (or S and T) entries
  const noRotFiles = infos.filter(i => i.rAnim === 0).slice(0, 20)
  console.log('Files with rAnim=0:')
  for (const info of noRotFiles.slice(0, 15)) {
    const g = info.segGroups[0]
    console.log(`  tA=${info.tAnim} sA=${info.sAnim}: g=[${g.join(',')}] | g1/tA=${info.tAnim > 0 ? (g[1]/info.tAnim).toFixed(1) : 'n/a'} g2/sA=${info.sAnim > 0 ? (g[2]/info.sAnim).toFixed(1) : 'n/a'} | g1/frames=${(g[1]/info.frameCount).toFixed(2)} g2/frames=${(g[2]/info.frameCount).toFixed(2)}`)
  }

  // For files WITH rAnim>0
  console.log('\nFiles with rAnim>0:')
  const withRotFiles = infos.filter(i => i.rAnim > 0).slice(0, 15)
  for (const info of withRotFiles) {
    const g = info.segGroups[0]
    console.log(`  rA=${info.rAnim} tA=${info.tAnim} sA=${info.sAnim}: g=[${g.join(',')}] frames=${info.frameCount}`)
  }
}

main()
