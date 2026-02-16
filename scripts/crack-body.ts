#!/usr/bin/env npx tsx
/**
 * Targeted analysis of V1 animation keyframe body encoding.
 *
 * What we know:
 *   - Animated headers at secOff[3]: 24B per channel = [base_xyz, range_xyz]
 *   - Segment groups: [g0, g1, g2, g3] where g0=g1+g2, g3=offset to body
 *   - Body contains compressed per-frame keyframe data
 *   - ~1.8-3 bytes per "entry" (variable-length)
 *
 * Hypothesis: body uses quantized values within [base, range] bounds from headers.
 * This script tries to determine the quantization bit width and packing.
 */

import { readFileSync, readdirSync } from 'fs'
import { resolve, join } from 'path'

const ANIM_MAGIC = 0x6AB06AB0

interface ParsedV1 {
  name: string
  data: Buffer
  boneCount: number
  frameCount: number
  fps: number
  count1: number
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
  // Animated headers: [base_xyz, range_xyz] per channel
  animHeaders: { base: [number, number, number]; range: [number, number, number] }[]
  // Offsets
  bodyStart: number  // absolute offset to keyframe body
  bodySize: number   // bytes from bodyStart to end of data region
  dataSize: number   // AC+0x00 data size field
}

function parseV1File(filepath: string): ParsedV1 | null {
  const data = readFileSync(filepath)
  if (data.length < 0xB4) return null
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  if (view.getUint32(0, true) !== ANIM_MAGIC) return null
  if (view.getUint32(0x48, true) === 0xFFFFFFFF) return null

  const AC = 0x60
  const u32 = (o: number) => view.getUint32(o, true)
  const f32 = (o: number) => view.getFloat32(o, true)

  const dataSize = u32(AC + 0x00)
  const fps = view.getFloat32(0x08, true)
  const frameCount = u32(0x0C)
  const boneCount = u32(AC + 0x10)
  const count1 = u32(AC + 0x20)
  const valA = u32(AC + 0x34)
  const valB = u32(AC + 0x38)
  const valC = u32(AC + 0x3C)
  const secOff = [u32(AC + 0x44), u32(AC + 0x48), u32(AC + 0x4C), u32(AC + 0x50)]

  let cursor = AC + 0x44 + 16
  const segFrames: number[] = []
  const frameBounds: number[] = []
  if (count1 >= 2) {
    for (let i = 0; i < count1; i++) { frameBounds.push(u32(cursor)); cursor += 4 }
    cursor += 4 // sentinel
  } else {
    frameBounds.push(0)
  }
  for (let s = 0; s < count1; s++) {
    const start = frameBounds[s]
    const end = s < count1 - 1 ? frameBounds[s + 1] : frameCount
    segFrames.push(end - start)
  }

  const segGroups: number[][] = []
  for (let s = 0; s < count1; s++) {
    segGroups.push([u32(cursor), u32(cursor + 4), u32(cursor + 8), u32(cursor + 12)])
    cursor += 16
  }

  const bfSize = secOff[2] - secOff[1]
  if (bfSize < 0 || bfSize > 10000) return null
  const bitfieldStart = cursor

  const channelTypes: number[] = []
  const wordCount = Math.ceil(bfSize / 4)
  for (let w = 0; w < wordCount; w++) {
    const word = u32(bitfieldStart + w * 4)
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
  if (totalAnim === 0) return null

  cursor = bitfieldStart + bfSize

  // Skip constant data
  cursor += valA * 12 + valB * 12 + valC * 12

  // Read animated headers (24B each = [base_xyz, range_xyz])
  const animHeaders: ParsedV1['animHeaders'] = []
  for (let i = 0; i < totalAnim; i++) {
    if (cursor + 24 > data.length) break
    animHeaders.push({
      base: [f32(cursor), f32(cursor + 4), f32(cursor + 8)],
      range: [f32(cursor + 12), f32(cursor + 16), f32(cursor + 20)],
    })
    cursor += 24
  }

  // Body starts at AC + segGroups[0][3]
  const bodyStart = AC + segGroups[0][3]
  const bodyEnd = AC + dataSize
  const bodySize = bodyEnd - bodyStart

  return {
    name: filepath.split(/[\\/]/).pop()!,
    data, boneCount, frameCount, fps, count1,
    valA, valB, valC, secOff, segGroups, segFrames,
    rTypes, tTypes, sTypes, rAnim, tAnim, sAnim, totalAnim,
    animHeaders, bodyStart, bodySize, dataSize,
  }
}

function main() {
  const dir = resolve(process.argv[2] || '')
  const files = readdirSync(dir).filter(f => f.endsWith('.anim'))

  const parsed: ParsedV1[] = []
  for (const f of files) {
    const p = parseV1File(join(dir, f))
    if (p) parsed.push(p)
  }

  console.log(`Parsed ${parsed.length} V1 animations\n`)

  for (const p of parsed) {
    const view = new DataView(p.data.buffer, p.data.byteOffset, p.data.byteLength)
    const u32 = (o: number) => view.getUint32(o, true)
    const u16 = (o: number) => view.getUint16(o, true)
    const u8 = (o: number) => p.data[o]

    console.log(`\n${'='.repeat(70)}`)
    console.log(`${p.name}`)
    console.log(`bones=${p.boneCount} frames=${p.frameCount} fps=${p.fps}`)
    console.log(`count1=${p.count1} segments: ${p.segFrames.join(', ')} frames`)
    console.log(`rAnim=${p.rAnim} tAnim=${p.tAnim} sAnim=${p.sAnim} total=${p.totalAnim}`)
    console.log(`bodyStart=0x${p.bodyStart.toString(16)} bodySize=${p.bodySize}`)

    for (let s = 0; s < p.count1; s++) {
      const g = p.segGroups[s]
      console.log(`  seg[${s}]: g=[${g.join(', ')}] frames=${p.segFrames[s]}`)
    }

    // Show animated headers
    console.log(`\nAnimated headers (${p.animHeaders.length}):`)
    let hIdx = 0
    for (let i = 0; i < p.rAnim; i++, hIdx++) {
      const h = p.animHeaders[hIdx]
      if (!h) continue
      console.log(`  rot[${i}]: base=[${h.base.map(v => v.toFixed(4)).join(', ')}] range=[${h.range.map(v => v.toFixed(4)).join(', ')}]`)
    }
    for (let i = 0; i < p.tAnim; i++, hIdx++) {
      const h = p.animHeaders[hIdx]
      if (!h) continue
      console.log(`  pos[${i}]: base=[${h.base.map(v => v.toFixed(4)).join(', ')}] range=[${h.range.map(v => v.toFixed(4)).join(', ')}]`)
    }
    for (let i = 0; i < p.sAnim; i++, hIdx++) {
      const h = p.animHeaders[hIdx]
      if (!h) continue
      console.log(`  scl[${i}]: base=[${h.base.map(v => v.toFixed(4)).join(', ')}] range=[${h.range.map(v => v.toFixed(4)).join(', ')}]`)
    }

    // ANALYSIS 1: Body size relationships
    console.log(`\n--- Body size analysis ---`)
    const g0Total = p.segGroups.reduce((s, g) => s + g[0], 0)
    const g1Total = p.segGroups.reduce((s, g) => s + g[1], 0)
    const g2Total = p.segGroups.reduce((s, g) => s + g[2], 0)
    console.log(`  sum g0=${g0Total} g1=${g1Total} g2=${g2Total}`)
    console.log(`  g0 = g1+g2: ${g0Total === g1Total + g2Total}`)
    console.log(`  bodySize=${p.bodySize}`)
    console.log(`  bodySize/g0 = ${(p.bodySize / g0Total).toFixed(4)}`)
    console.log(`  bodySize / (totalAnim * frames) = ${(p.bodySize / (p.totalAnim * p.frameCount)).toFixed(4)}`)

    // Try different quantization bytes per component per frame
    for (const bpc of [1, 2, 3, 4]) {
      const expected = p.totalAnim * p.frameCount * 3 * bpc  // 3 components per channel
      console.log(`  ${bpc}B/component: expected=${expected} actual=${p.bodySize} match=${expected === p.bodySize}`)
    }

    // g0 might be total quantized COMPONENT entries (not channel entries)
    console.log(`  g0 / (totalAnim * frames) = ${(g0Total / (p.totalAnim * p.frameCount)).toFixed(4)}`)
    console.log(`  g0 / (totalAnim * frames * 3) = ${(g0Total / (p.totalAnim * p.frameCount * 3)).toFixed(4)}`)
    console.log(`  g1 / (rAnim * frames) = ${p.rAnim > 0 ? (g1Total / (p.rAnim * p.frameCount)).toFixed(4) : 'N/A'}`)
    console.log(`  g1 / (rAnim * frames * 3) = ${p.rAnim > 0 ? (g1Total / (p.rAnim * p.frameCount * 3)).toFixed(4) : 'N/A'}`)
    console.log(`  g2 / (tAnim+sAnim) * frames = ${(p.tAnim + p.sAnim) > 0 ? (g2Total / ((p.tAnim + p.sAnim) * p.frameCount)).toFixed(4) : 'N/A'}`)

    // ANALYSIS 2: Body byte patterns
    console.log(`\n--- Body byte patterns ---`)
    if (p.bodySize > 0 && p.bodyStart + p.bodySize <= p.data.length) {
      const body = p.data.subarray(p.bodyStart, p.bodyStart + p.bodySize)

      // Byte histogram
      const hist = new Array(256).fill(0)
      for (let i = 0; i < body.length; i++) hist[body[i]]++

      // Top 10 most frequent bytes
      const sorted = hist.map((c, v) => ({ v, c })).filter(x => x.c > 0).sort((a, b) => b.c - a.c)
      console.log(`  Top bytes: ${sorted.slice(0, 10).map(x => `0x${x.v.toString(16)}(${x.c})`).join(' ')}`)

      // Zero count
      const zeroCount = hist[0]
      console.log(`  Zero bytes: ${zeroCount}/${body.length} (${(zeroCount/body.length*100).toFixed(1)}%)`)

      // Entropy
      let entropy = 0
      for (let i = 0; i < 256; i++) {
        if (hist[i] === 0) continue
        const p = hist[i] / body.length
        entropy -= p * Math.log2(p)
      }
      console.log(`  Entropy: ${entropy.toFixed(2)} bits/byte (max 8.0)`)

      // Check if body starts with recognizable patterns
      const first64 = Math.min(64, body.length)
      const hexLine = Array.from(body.subarray(0, first64)).map(b => b.toString(16).padStart(2, '0')).join(' ')
      console.log(`  First ${first64} bytes: ${hexLine}`)

      // Interpret as uint16 LE
      console.log(`  As uint16 LE (first 16):`)
      for (let i = 0; i < Math.min(16, body.length / 2); i++) {
        const v = body[i * 2] | (body[i * 2 + 1] << 8)
        console.log(`    [${i}] = ${v} (0x${v.toString(16).padStart(4, '0')})`)
      }

      // ANALYSIS 3: Try to find a repeating unit size
      console.log(`\n--- Repeating pattern analysis ---`)
      // For each candidate unit size, check if body divides evenly
      for (const unitSize of [2, 3, 4, 6, 8, 12]) {
        if (body.length % unitSize === 0) {
          const units = body.length / unitSize
          console.log(`  ${unitSize}B units: ${units} units`)
          // Check if units relates to known quantities
          if (units === p.totalAnim * p.frameCount) console.log(`    = totalAnim * frames!`)
          if (units === p.totalAnim * p.frameCount * 3) console.log(`    = totalAnim * frames * 3!`)
          if (units === g0Total) console.log(`    = g0!`)
        }
      }

      // ANALYSIS 4: Try uint16 quantized decoding
      console.log(`\n--- Quantized decode test (uint16) ---`)
      // If body = uint16[totalAnim * frameCount * 3], decode first channel
      if (body.length >= p.totalAnim * p.frameCount * 3 * 2) {
        console.log(`  Body has room for uint16 quantized (${p.totalAnim * p.frameCount * 3} values = ${p.totalAnim * p.frameCount * 3 * 2} bytes)`)
        // Try decoding first rotation channel
        const h = p.animHeaders[0]
        if (h) {
          console.log(`  Decoding first rot channel with header base=[${h.base.map(v => v.toFixed(4))}] range=[${h.range.map(v => v.toFixed(4))}]`)
          for (let f = 0; f < Math.min(5, p.frameCount); f++) {
            const off = f * p.totalAnim * 3 * 2
            const qx = (body[off] | (body[off+1] << 8)) / 65535
            const qy = (body[off+2] | (body[off+3] << 8)) / 65535
            const qz = (body[off+4] | (body[off+5] << 8)) / 65535
            const vx = h.base[0] + qx * (h.range[0] - h.base[0])
            const vy = h.base[1] + qy * (h.range[1] - h.base[1])
            const vz = h.base[2] + qz * (h.range[2] - h.base[2])
            console.log(`    frame[${f}]: raw=[${qx.toFixed(4)}, ${qy.toFixed(4)}, ${qz.toFixed(4)}] → [${vx.toFixed(4)}, ${vy.toFixed(4)}, ${vz.toFixed(4)}]`)
          }
          // Also try channel-major layout (all frames for channel 0, then channel 1, etc.)
          console.log(`  Channel-major layout:`)
          for (let f = 0; f < Math.min(5, p.frameCount); f++) {
            const off0 = f * 2
            const off1 = p.frameCount * 2 + f * 2
            const off2 = p.frameCount * 4 + f * 2
            if (off2 + 2 > body.length) break
            const qx = (body[off0] | (body[off0+1] << 8)) / 65535
            const qy = (body[off1] | (body[off1+1] << 8)) / 65535
            const qz = (body[off2] | (body[off2+1] << 8)) / 65535
            const vx = h.base[0] + qx * (h.range[0] - h.base[0])
            const vy = h.base[1] + qy * (h.range[1] - h.base[1])
            const vz = h.base[2] + qz * (h.range[2] - h.base[2])
            console.log(`    frame[${f}]: raw=[${qx.toFixed(4)}, ${qy.toFixed(4)}, ${qz.toFixed(4)}] → [${vx.toFixed(4)}, ${vy.toFixed(4)}, ${vz.toFixed(4)}]`)
          }
        }
      }

      // ANALYSIS 5: Try uint8 quantized decoding
      console.log(`\n--- Quantized decode test (uint8) ---`)
      if (body.length >= p.totalAnim * p.frameCount * 3) {
        console.log(`  Body has room for uint8 quantized (${p.totalAnim * p.frameCount * 3} values = ${p.totalAnim * p.frameCount * 3} bytes)`)
        const h = p.animHeaders[0]
        if (h) {
          for (let f = 0; f < Math.min(5, p.frameCount); f++) {
            const off = f * p.totalAnim * 3
            const qx = body[off] / 255
            const qy = body[off + 1] / 255
            const qz = body[off + 2] / 255
            const vx = h.base[0] + qx * (h.range[0] - h.base[0])
            const vy = h.base[1] + qy * (h.range[1] - h.base[1])
            const vz = h.base[2] + qz * (h.range[2] - h.base[2])
            console.log(`    frame[${f}]: raw=[${qx.toFixed(4)}, ${qy.toFixed(4)}, ${qz.toFixed(4)}] → [${vx.toFixed(4)}, ${vy.toFixed(4)}, ${vz.toFixed(4)}]`)
          }
        }
      }

      // ANALYSIS 6: g0 as uint16 count
      console.log(`\n--- g0 as entry count ---`)
      console.log(`  g0=${g0Total}, bodySize=${p.bodySize}`)
      console.log(`  bodySize/g0 = ${(p.bodySize / g0Total).toFixed(6)} bytes per g0-entry`)
      console.log(`  g0 * 2 = ${g0Total * 2} vs bodySize=${p.bodySize}`)
      console.log(`  g0 * 1 = ${g0Total} vs bodySize=${p.bodySize}`)

      // What if g0 = number of uint16 values in the body?
      if (g0Total * 2 === p.bodySize) {
        console.log(`  *** MATCH: body = g0 * 2 bytes (uint16 per entry) ***`)
      }
      // What if g0 = number of bytes?
      if (g0Total === p.bodySize) {
        console.log(`  *** MATCH: body = g0 bytes ***`)
      }

      // ANALYSIS 7: Try bit-packed decoding
      console.log(`\n--- Bit-packed analysis ---`)
      const totalValues = p.totalAnim * p.frameCount * 3 // 3 components per channel
      const bitsPerValue = (p.bodySize * 8) / totalValues
      console.log(`  Total values to encode: ${totalValues}`)
      console.log(`  Bits per value: ${bitsPerValue.toFixed(2)}`)

      // Try g0 as the total component count
      const bitsPerG0Entry = (p.bodySize * 8) / g0Total
      console.log(`  Bits per g0-entry: ${bitsPerG0Entry.toFixed(2)}`)

      // Try g1 as rotation bits, g2 as position+scale bits
      if (p.rAnim > 0 && g1Total > 0) {
        // If rotation body and pos/scale body are separate
        // g1 entries for rotation, g2 entries for pos+scale
        // What are the bit widths?
        console.log(`  g1=${g1Total} g2=${g2Total}`)
        console.log(`  g1 per rot per frame = ${(g1Total / (p.rAnim * p.frameCount)).toFixed(4)}`)
        console.log(`  g2 per (pos+scl) per frame = ${(g2Total / ((p.tAnim + p.sAnim) * p.frameCount)).toFixed(4)}`)
      }
    }
  }
}

main()
