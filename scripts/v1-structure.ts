#!/usr/bin/env npx tsx
/**
 * Deep structure analysis of V1 AC11 animations.
 * Compares files with different count1 values to find the actual layout.
 */

import { readFileSync, readdirSync } from 'fs'
import { resolve, join } from 'path'

const ANIM_MAGIC = 0x6AB06AB0
const hex = (v: number, pad = 8) => '0x' + (v >>> 0).toString(16).padStart(pad, '0').toUpperCase()

interface AnimInfo {
  name: string
  data: Buffer
  view: DataView
  bones: number
  frames: number
  fileSize: number
}

function loadAnims(dir: string): AnimInfo[] {
  const files = readdirSync(dir).filter(f => f.endsWith('.anim'))
  const anims: AnimInfo[] = []
  for (const f of files) {
    const data = readFileSync(join(dir, f))
    if (data.length < 0xB4) continue
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
    if (view.getUint32(0, true) !== ANIM_MAGIC) continue
    if (view.getUint32(0x48, true) === 0xFFFFFFFF) continue // skip V0
    const bones = view.getUint32(0x10, true) & 0xFFFF
    const frames = view.getUint32(0x0C, true)
    anims.push({ name: f, data, view, bones, frames, fileSize: data.length })
  }
  return anims
}

function u32(view: DataView, off: number) { return view.getUint32(off, true) }
function f32(view: DataView, off: number) { return view.getFloat32(off, true) }
function u16(view: DataView, off: number) { return view.getUint16(off, true) }
function u8(data: Buffer, off: number) { return data[off] }

function analyzeFile(a: AnimInfo) {
  const { view, data, bones, frames } = a

  // Core header at 0x60 (relative to file start)
  const AC = 0x60
  const dataSize = u32(view, AC + 0x00)
  const hash = u32(view, AC + 0x04)
  const magic = u32(view, AC + 0x08)
  const version = u32(view, AC + 0x0C)
  const acBones = u32(view, AC + 0x10)
  const lastFrame = u32(view, AC + 0x14)
  const fps = f32(view, AC + 0x18)
  const field1C = u32(view, AC + 0x1C)
  const count1 = u32(view, AC + 0x20)
  const count2 = u32(view, AC + 0x24)
  const count3 = u32(view, AC + 0x28)
  const count4 = u32(view, AC + 0x2C)
  const zero30 = u32(view, AC + 0x30)

  const dataEnd = AC + dataSize

  console.log(`\n${'='.repeat(80)}`)
  console.log(`FILE: ${a.name}`)
  console.log(`  bones=${bones}, frames=${frames}, fileSize=${a.fileSize}`)
  console.log(`  AC11: dataSize=${dataSize}, version=${version}, acBones=${acBones}`)
  console.log(`  lastFrame=${lastFrame}, fps=${fps}, field1C=${hex(field1C)}`)
  console.log(`  count1=${count1}, count2=${count2}, count3=${count3}, count4=${count4}`)

  // Scan for all 0xFFFFFFFF sentinels in the AC11 region
  console.log(`\n  Sentinels (0xFFFFFFFF) in AC11 region:`)
  const sentinels: number[] = []
  for (let off = AC; off + 4 <= dataEnd; off += 4) {
    if (u32(view, off) === 0xFFFFFFFF) {
      sentinels.push(off)
      console.log(`    at file offset ${hex(off)} (AC+${off - AC})`)
    }
  }

  // Dump everything from AC+0x34 (end of core 13-field header) to first float data
  console.log(`\n  Post-header data (AC+0x34 = ${hex(AC + 0x34)} onwards):`)
  const dumpEnd = Math.min(dataEnd, AC + 200) // dump first 200 bytes of AC11
  for (let off = AC + 0x34; off + 4 <= dumpEnd; off += 4) {
    const val = u32(view, off)
    const fval = f32(view, off)
    const fStr = isFinite(fval) && Math.abs(fval) > 1e-10 && Math.abs(fval) < 1e10 ? fval.toFixed(6) : ''
    const isSent = val === 0xFFFFFFFF ? ' ← SENTINEL' : ''
    const relAC = off - AC
    console.log(`    ${hex(off)} (AC+${relAC.toString().padStart(3)}): ${val.toString().padStart(12)} ${hex(val)} ${fStr.padStart(14)}${isSent}`)
  }

  // Now identify the first section of float data
  // Look for first sequence of 3+ valid floats in [-1,1] range (quaternion data)
  console.log(`\n  Float scan (looking for quaternion-like data):`)
  let firstQuatOff = -1
  for (let off = AC + 0x34; off + 16 <= dataEnd; off += 4) {
    const v0 = f32(view, off)
    const v1 = f32(view, off + 4)
    const v2 = f32(view, off + 8)
    const v3 = f32(view, off + 12)
    if (Math.abs(v0) <= 1.0 && Math.abs(v1) <= 1.0 && Math.abs(v2) <= 1.0 && Math.abs(v3) <= 1.0 &&
        isFinite(v0) && isFinite(v1) && isFinite(v2) && isFinite(v3) &&
        (Math.abs(v0) > 0.001 || Math.abs(v1) > 0.001 || Math.abs(v2) > 0.001 || Math.abs(v3) > 0.001)) {
      // Check if this could be a unit quaternion (magnitude near 1.0)
      const mag = Math.sqrt(v0*v0 + v1*v1 + v2*v2 + v3*v3)
      if (Math.abs(mag - 1.0) < 0.1) {
        console.log(`    First quaternion at ${hex(off)} (AC+${off-AC}): [${v0.toFixed(4)}, ${v1.toFixed(4)}, ${v2.toFixed(4)}, ${v3.toFixed(4)}] mag=${mag.toFixed(4)}`)
        if (firstQuatOff === -1) firstQuatOff = off
        break
      }
    }
  }

  // Look for 0.1 0.1 0.1 pattern (scale data)
  console.log(`\n  Scale data scan (looking for 0.1, 0.1, 0.1 pattern):`)
  for (let off = AC + 0x34; off + 12 <= dataEnd; off += 4) {
    const v0 = f32(view, off)
    const v1 = f32(view, off + 4)
    const v2 = f32(view, off + 8)
    if (Math.abs(v0 - 0.1) < 0.001 && Math.abs(v1 - 0.1) < 0.001 && Math.abs(v2 - 0.1) < 0.001) {
      // Count how many consecutive 0.1 values
      let count = 0
      for (let o = off; o + 4 <= dataEnd; o += 4) {
        if (Math.abs(f32(view, o) - 0.1) < 0.001) count++
        else break
      }
      console.log(`    0.1 block at ${hex(off)} (AC+${off-AC}): ${count} consecutive 0.1f values (= ${count/3} bone scale triples)`)
      break
    }
  }

  // Bitfield analysis: look for bytes where majority of 2-bit pairs are 0 or 1
  // (not random float data)
  console.log(`\n  Bitfield scan:`)
  for (let off = AC + 0x34; off + 4 <= dataEnd; off += 4) {
    const val = u32(view, off)
    // Check if this looks like a packed 2-bit field (values 0-2, no 3s or few 3s)
    let has3 = 0, total = 0
    let temp = val
    for (let i = 0; i < 16; i++) {
      const bits = temp & 3
      if (bits === 3) has3++
      total++
      temp >>>= 2
    }
    // A good bitfield has few 3s and isn't all zeros or all ones
    if (has3 <= 2 && val !== 0 && val !== 0xFFFFFFFF && val < 0xFFFF0000) {
      // Decode 2-bit values
      const bits2: number[] = []
      temp = val
      for (let i = 0; i < 16; i++) {
        bits2.push(temp & 3)
        temp >>>= 2
      }
      const counts = [0, 0, 0, 0]
      for (const b of bits2) counts[b]++
      if (counts[1] > 2) { // Has substantial number of 1s
        console.log(`    Bitfield at ${hex(off)} (AC+${off-AC}): ${hex(val)} → [${bits2.join(',')}] (0:${counts[0]} 1:${counts[1]} 2:${counts[2]} 3:${counts[3]})`)
      }
    }
  }

  // Try to identify section boundaries by looking for value type transitions
  console.log(`\n  Value type transitions:`)
  let prevType = ''
  for (let off = AC + 0x34; off + 4 <= dataEnd; off += 4) {
    const val = u32(view, off)
    const fval = f32(view, off)
    let curType = 'unknown'
    if (val === 0xFFFFFFFF) curType = 'sentinel'
    else if (val === 0) curType = 'zero'
    else if (val <= 0xFF) curType = 'small_int'
    else if (isFinite(fval) && Math.abs(fval) <= 1.0 && Math.abs(fval) > 0.0001) curType = 'unit_float'
    else if (isFinite(fval) && Math.abs(fval) > 1.0 && Math.abs(fval) < 10000) curType = 'large_float'
    else if (val <= 0xFFFF) curType = 'medium_int'

    if (curType !== prevType) {
      console.log(`    ${hex(off)} (AC+${off-AC}): → ${curType} (val=${val}, f=${isFinite(fval) ? fval.toFixed(4) : 'NaN'})`)
      prevType = curType
    }
  }

  return { count1, count2, count3, count4, sentinels, firstQuatOff, dataEnd, AC }
}

function main() {
  const dir = resolve(process.argv[2] || '')
  const anims = loadAnims(dir)
  console.log(`Loaded ${anims.length} V1 anims`)

  // Pick files with different count1 values, preferring small files with 10+ bones
  const byCount1 = new Map<number, AnimInfo[]>()
  for (const a of anims) {
    const c1 = u32(a.view, 0x80)
    if (!byCount1.has(c1)) byCount1.set(c1, [])
    byCount1.get(c1)!.push(a)
  }

  console.log('\ncount1 distribution:')
  for (const [c1, list] of [...byCount1.entries()].sort((a, b) => a[0] - b[0])) {
    console.log(`  count1=${c1}: ${list.length} files`)
  }

  // Analyze one file per count1 value (pick smallest with 10+ bones)
  for (const [c1, list] of [...byCount1.entries()].sort((a, b) => a[0] - b[0])) {
    const candidates = list
      .filter(a => a.bones >= 10 && a.bones <= 30 && a.frames >= 10)
      .sort((a, b) => a.fileSize - b.fileSize)

    if (candidates.length === 0) continue
    const chosen = candidates[0]
    analyzeFile(chosen)
  }
}

main()
