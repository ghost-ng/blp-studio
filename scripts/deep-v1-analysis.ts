#!/usr/bin/env npx tsx
/**
 * Deep binary analysis of V1 (AC11) animation format.
 * Compares V0 reference with multiple V1 anims to decode the compression scheme.
 *
 * Usage: npx tsx scripts/deep-v1-analysis.ts <file.blp>
 */

import { readFileSync } from 'fs'
import { resolve } from 'path'
import { BLPParser } from '../src/core/blp-parser'
import { readCivbig } from '../src/core/civbig'
import { OodleDecompressor } from '../src/core/oodle'
import {
  findOodleCandidates,
  findAllSharedData,
  findGameRootFromPath,
  findSharedDataCandidates,
  buildSharedDataIndex,
} from '../src/core/game-detect'

const u32 = (v: DataView, o: number) => v.getUint32(o, true)
const i32 = (v: DataView, o: number) => v.getInt32(o, true)
const u16 = (v: DataView, o: number) => v.getUint16(o, true)
const i16 = (v: DataView, o: number) => v.getInt16(o, true)
const f32 = (v: DataView, o: number) => v.getFloat32(o, true)
const f16 = (v: DataView, o: number) => {
  const bits = v.getUint16(o, true)
  const sign = (bits >> 15) & 1
  const exp = (bits >> 10) & 0x1f
  const frac = bits & 0x3ff
  if (exp === 0) return (sign ? -1 : 1) * Math.pow(2, -14) * (frac / 1024)
  if (exp === 31) return frac ? NaN : (sign ? -Infinity : Infinity)
  return (sign ? -1 : 1) * Math.pow(2, exp - 15) * (1 + frac / 1024)
}

function hex(v: number, pad = 8) { return '0x' + v.toString(16).padStart(pad, '0') }
function hexdump(data: Uint8Array, startOff: number, rows: number) {
  for (let r = 0; r < rows; r++) {
    const off = r * 16
    if (off >= data.length) break
    const bytes = data.subarray(off, Math.min(off + 16, data.length))
    const hexParts: string[] = []
    for (let i = 0; i < 16; i++) hexParts.push(i < bytes.length ? bytes[i].toString(16).padStart(2, '0') : '  ')
    let ascii = ''
    for (const b of bytes) ascii += b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : '.'
    console.log(`  ${(startOff + off).toString(16).padStart(6, '0')}  ${hexParts.slice(0, 8).join(' ')}  ${hexParts.slice(8).join(' ')}  |${ascii}|`)
  }
}

// Setup
const blpPath = resolve(process.argv[2] || '')
if (!blpPath) { console.error('Usage: npx tsx scripts/deep-v1-analysis.ts <file.blp>'); process.exit(1) }

const parser = new BLPParser(blpPath)
parser.parse()

const gameRoot = findGameRootFromPath(blpPath)
let sdDirs = gameRoot ? findAllSharedData(gameRoot) : []
if (sdDirs.length === 0) { for (const d of findSharedDataCandidates()) if (!sdDirs.includes(d)) sdDirs.push(d) }
const sdIndex = buildSharedDataIndex(sdDirs)

let oodle: OodleDecompressor | null = null
for (const p of findOodleCandidates()) { try { oodle = new OodleDecompressor(p); break } catch {} }
console.log(`Loaded BLP, ${sdIndex.size} SHARED_DATA files, oodle=${!!oodle}\n`)

function loadBlob(name: string, sz: number): Buffer | null {
  const path = sdIndex.get(name)
  if (!path) return null
  try {
    const { data } = readCivbig(path)
    if (OodleDecompressor.isOodleCompressed(data) && oodle) return oodle.decompress(data, sz || data.length * 4) || data
    return data
  } catch { return null }
}

// Collect anims
const ANIM_MAGIC = 0x6ab06ab0
interface AnimEntry { name: string; data: Buffer; isV0: boolean }
const anims: AnimEntry[] = []

for (const alloc of parser.iterEntriesByType('BLP::BlobEntry')) {
  const obj = parser.deserializeAlloc(alloc)
  if ((obj.m_nBlobType as number) !== 5) continue
  const name = obj.m_Name as string
  const sz = (obj.m_nSize as number) || 0
  const data = loadBlob(name, sz)
  if (!data || data.length < 96) continue
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength)
  if (u32(v, 0) !== ANIM_MAGIC) continue
  anims.push({ name, data, isV0: u32(v, 0x48) === 0xffffffff })
}

const v0s = anims.filter(a => a.isV0)
const v1s = anims.filter(a => !a.isV0)
console.log(`V0: ${v0s.length}, V1: ${v1s.length}\n`)

// ============================================================
// PHASE 1: Analyze header structure by comparing many V1 anims
// ============================================================

console.log('=== PHASE 1: V1 Header field analysis across many anims ===\n')

// Build a table of all header+AC11 fields for all V1 anims
const fieldTable: { off: number; values: number[] }[] = []
const maxOff = 0xC0 // scan through main header + AC11 subheader
for (let off = 0; off < maxOff; off += 4) {
  const values: number[] = []
  for (const a of v1s.slice(0, 50)) {
    const v = new DataView(a.data.buffer, a.data.byteOffset, a.data.byteLength)
    values.push(off + 4 <= a.data.length ? u32(v, off) : -1)
  }
  fieldTable.push({ off, values })
}

// Show which fields are constant vs variable
console.log('Field constancy:')
for (const f of fieldTable) {
  const unique = new Set(f.values.filter(v => v !== -1))
  const sample = f.values.slice(0, 5)
  const constant = unique.size === 1
  if (constant) {
    console.log(`  ${hex(f.off, 2)}: CONSTANT = ${hex([...unique][0])} (${[...unique][0]})`)
  } else {
    console.log(`  ${hex(f.off, 2)}: VARIABLE (${unique.size} unique) samples: [${sample.map(v => v.toString()).join(', ')}]`)
  }
}

// ============================================================
// PHASE 2: Deep dive into one V1 anim
// ============================================================

if (v1s.length > 0) {
  // Pick a medium-size V1 anim
  const sorted = [...v1s].sort((a, b) => a.data.length - b.data.length)
  const small = sorted[0]
  const medium = sorted[Math.floor(sorted.length / 2)]
  const large = sorted[sorted.length - 1]

  for (const { label, anim } of [
    { label: 'SMALLEST', anim: small },
    { label: 'MEDIUM', anim: medium },
    { label: 'LARGEST', anim: large },
  ]) {
    const d = anim.data
    const v = new DataView(d.buffer, d.byteOffset, d.byteLength)

    const fps = f32(v, 0x08)
    const frameCount = u32(v, 0x0c)
    const boneCount = u32(v, 0x10) & 0xffff
    const nameOff = u32(v, 0x50)
    let animName = ''
    if (nameOff > 0 && nameOff < d.length) {
      const end = d.indexOf(0, nameOff)
      if (end > nameOff) animName = String.fromCharCode(...d.subarray(nameOff, Math.min(end, nameOff + 100)))
    }

    console.log(`\n${'='.repeat(80)}`)
    console.log(`PHASE 2: ${label} V1 ANIM: ${animName}`)
    console.log(`Size: ${d.length}B, fps=${fps}, frames=${frameCount}, bones=${boneCount}`)
    console.log('='.repeat(80))

    // ---- AC11 subheader detailed breakdown ----
    console.log('\n--- AC11 Subheader (from 0x60) ---')

    // First, check if AC11 magic is at +0x08 from 0x60 or at 0x60 itself
    for (let probe = 0x60; probe < 0x70; probe += 4) {
      if (probe + 4 <= d.length && u32(v, probe) === 0xac11ac11) {
        console.log(`  AC11AC11 magic found at ${hex(probe)}`)
      }
    }

    // Full dump from 0x60 onward
    console.log('\n  Full data from 0x60:')
    hexdump(d.subarray(0x60, Math.min(d.length, 0x160)), 0x60, 16)

    // Parse AC11 subheader fields
    const ac11Off = 0x60 // start of AC11 region
    console.log('\n  Field-by-field from 0x60:')
    for (let off = 0x60; off < Math.min(0xC0, d.length - 3); off += 4) {
      const val = u32(v, off)
      const fval = f32(v, off)
      const annotations: string[] = []
      if (val === 0xac11ac11) annotations.push('AC11 MAGIC')
      if (val === boneCount) annotations.push('= boneCount')
      if (val === frameCount) annotations.push('= frameCount')
      if (val === frameCount - 1) annotations.push('= frameCount-1')
      if (val === 0xffffffff) annotations.push('SENTINEL')
      if (val === nameOff - 0x60) annotations.push('= nameOff-0x60')
      if (val === d.length - 0x60) annotations.push('= dataLen-0x60')
      if (Math.abs(fval - fps) < 0.01 && fps > 0) annotations.push(`= fps (${fval})`)
      if (isFinite(fval) && Math.abs(fval) > 0.001 && Math.abs(fval) < 1e5 && !annotations.length) annotations.push(`f32=${fval.toFixed(4)}`)
      console.log(`  ${hex(off, 2)}: ${hex(val)}  (${val.toString().padStart(10)})  ${annotations.join(', ')}`)
    }

    // ---- Find the offset table ----
    // After the AC11 fixed header, there should be an offset table
    // The offset table entries are monotonically increasing u32s
    console.log('\n--- Searching for offset table ---')
    for (let start = 0x70; start < 0xC0; start += 4) {
      if (start + 8 > d.length) break
      let count = 0
      let prev = u32(v, start)
      if (prev > d.length * 2) continue // too large
      for (let j = start + 4; j < Math.min(d.length - 3, start + 400); j += 4) {
        const cur = u32(v, j)
        if (cur < prev) break // not monotonic
        if (cur > d.length * 2) break // too large
        prev = cur
        count++
      }
      if (count >= 3) {
        const entries: number[] = []
        for (let j = 0; j <= count; j++) entries.push(u32(v, start + j * 4))
        // Check deltas
        const deltas: number[] = []
        for (let j = 1; j < entries.length; j++) deltas.push(entries[j] - entries[j - 1])
        const minDelta = Math.min(...deltas)
        const maxDelta = Math.max(...deltas)
        console.log(`  Offset table at ${hex(start, 2)}: ${entries.length} entries, range [${entries[0]}..${entries[entries.length - 1]}], delta range [${minDelta}..${maxDelta}]`)
        if (entries.length <= 60) {
          console.log(`    Values: [${entries.join(', ')}]`)
          console.log(`    Deltas: [${deltas.join(', ')}]`)
        } else {
          console.log(`    First 20: [${entries.slice(0, 20).join(', ')}]`)
          console.log(`    First deltas: [${deltas.slice(0, 20).join(', ')}]`)
        }
      }
    }

    // ---- Try to identify sections ----
    // Look for 0xFFFFFFFF sentinel which may delimit sections
    console.log('\n--- Sentinel (0xFFFFFFFF) locations ---')
    for (let off = 0x60; off < d.length - 3; off += 4) {
      if (u32(v, off) === 0xffffffff) {
        console.log(`  Sentinel at ${hex(off)}`)
      }
    }

    // ---- Examine what comes after the header/offset table ----
    // Try to find where "data" starts by looking at byte patterns
    console.log('\n--- Byte value histogram by 64-byte window ---')
    for (let off = 0x60; off < Math.min(d.length, nameOff); off += 64) {
      const end = Math.min(off + 64, d.length)
      const win = d.subarray(off, end)
      const zeros = [...win].filter(b => b === 0).length
      const highBits = [...win].filter(b => b >= 0x80).length
      const unique = new Set(win).size
      console.log(`  ${hex(off, 4)}: zeros=${zeros.toString().padStart(2)} high=${highBits.toString().padStart(2)} unique=${unique.toString().padStart(2)}`)
    }

    // ---- Try interpreting data after AC11 header in various ways ----
    // Check how the data region looks as float16
    console.log('\n--- Data as float16 (first 40 values after 0xB0) ---')
    const f16Start = 0xB0
    if (f16Start + 80 <= d.length) {
      const vals: string[] = []
      for (let i = 0; i < 40; i++) {
        const val = f16(v, f16Start + i * 2)
        vals.push(isFinite(val) ? val.toFixed(4) : 'NaN')
      }
      console.log(`  ${vals.join(', ')}`)
    }

    // Check how data looks as float32 (groups of 4 = quaternion, groups of 3 = position)
    console.log('\n--- Data as float32 (from various offsets) ---')
    for (const testOff of [0x80, 0x90, 0xA0, 0xB0, 0xC0, 0xD0]) {
      if (testOff + 40 > d.length) continue
      const vals: string[] = []
      for (let i = 0; i < 10; i++) {
        const val = f32(v, testOff + i * 4)
        vals.push(isFinite(val) && Math.abs(val) < 1e6 ? val.toFixed(6) : `[${hex(u32(v, testOff + i * 4))}]`)
      }
      console.log(`  ${hex(testOff, 2)}: ${vals.join(', ')}`)
    }

    // ---- Region before name: likely constant bone values ----
    console.log('\n--- Region before name (const bone values?) ---')
    const preNameRegion = Math.max(0x60, nameOff - 256)
    console.log(`  Dumping ${hex(preNameRegion)}-${hex(nameOff)}:`)
    hexdump(d.subarray(preNameRegion, nameOff), preNameRegion, Math.ceil((nameOff - preNameRegion) / 16))

    // Try as float32 groups
    console.log('\n  As float32:')
    for (let off = preNameRegion; off + 4 <= nameOff; off += 4) {
      const val = f32(v, off)
      if (off % 16 === preNameRegion % 16) process.stdout.write(`  ${hex(off, 4)}: `)
      process.stdout.write(`${isFinite(val) && Math.abs(val) < 1e6 ? val.toFixed(4).padStart(10) : hex(u32(v, off)).padStart(10)} `)
      if ((off + 4) % 16 === preNameRegion % 16 || off + 4 >= nameOff) process.stdout.write('\n')
    }

    // ---- Check for quantized rotation data ----
    // Try smallest-3 quaternion at 48 bits (most common game format)
    // Format: 2-bit index + 3x 15-bit mantissa packed into 6 bytes
    console.log('\n--- Smallest-3 quaternion probe (48-bit) ---')
    for (const testOff of [0x80, 0x90, 0xA0, 0xB0, 0xC0]) {
      if (testOff + boneCount * 6 > d.length) continue
      let validCount = 0
      const quats: [number, number, number, number][] = []
      for (let i = 0; i < Math.min(boneCount, 30); i++) {
        const off = testOff + i * 6
        // Read 6 bytes as 48-bit value
        const lo = u32(v, off)
        const hi = u16(v, off + 4)
        const bits48 = lo + hi * 0x100000000

        // Try: 2-bit index | 15-bit a | 15-bit b | 15-bit c  (= 47 bits + 1 spare)
        const idx = (hi >> 14) & 3
        const a = (((hi >> 0) & 0x3fff) | ((lo >> 30) << 14)) // nah this doesn't work cleanly

        // Simpler: just read 3 x int16, interpret as [-1, 1]
        const s0 = i16(v, off) / 32767.0
        const s1 = i16(v, off + 2) / 32767.0
        const s2 = i16(v, off + 4) / 32767.0
        const sumSq = s0 * s0 + s1 * s1 + s2 * s2
        if (sumSq <= 1.01) {
          validCount++
          const w = Math.sqrt(Math.max(0, 1.0 - sumSq))
          quats.push([s0, s1, s2, w])
        }
      }
      if (validCount > 2) {
        console.log(`  3x int16 quats at ${hex(testOff)}: ${validCount}/${Math.min(boneCount, 30)} valid`)
        for (let i = 0; i < Math.min(5, quats.length); i++) {
          const q = quats[i]
          const mag = Math.sqrt(q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3])
          console.log(`    [${i}] (${q[0].toFixed(4)}, ${q[1].toFixed(4)}, ${q[2].toFixed(4)}, ${q[3].toFixed(4)}) mag=${mag.toFixed(4)}`)
        }
      }
    }

    // Try 3x uint16 mapped to [-1, 1] via (val / 65535) * 2 - 1
    console.log('\n--- Unsigned uint16 quaternion probe ---')
    for (const testOff of [0x80, 0x90, 0xA0, 0xB0, 0xC0]) {
      if (testOff + boneCount * 6 > d.length) continue
      let validCount = 0
      for (let i = 0; i < Math.min(boneCount, 30); i++) {
        const off = testOff + i * 6
        const s0 = u16(v, off) / 65535.0 * 2 - 1
        const s1 = u16(v, off + 2) / 65535.0 * 2 - 1
        const s2 = u16(v, off + 4) / 65535.0 * 2 - 1
        const sumSq = s0 * s0 + s1 * s1 + s2 * s2
        if (sumSq <= 1.01) validCount++
      }
      if (validCount > 2) console.log(`  3x uint16 quats at ${hex(testOff)}: ${validCount}/${Math.min(boneCount, 30)} valid`)
    }

    // ---- Compare V0 and V1 for same bone count ----
    if (v0s.length > 0) {
      const v0 = v0s.find(a => {
        const vv = new DataView(a.data.buffer, a.data.byteOffset, a.data.byteLength)
        return u32(vv, 0x10) === boneCount
      })
      if (v0) {
        const vv = new DataView(v0.data.buffer, v0.data.byteOffset, v0.data.byteLength)
        const v0Frames = u32(vv, 0x0c)
        const v0Bones = u32(vv, 0x10)

        console.log(`\n--- V0 reference: ${v0.name} (${v0Frames} frames, ${v0Bones} bones) ---`)

        // Show V0 first-frame data for comparison
        const v0DataStart = 0x60
        console.log('  V0 Frame 0 (all bones):')
        for (let b = 0; b < Math.min(v0Bones, 5); b++) {
          const off = v0DataStart + b * 40
          const qw = f32(vv, off), qx = f32(vv, off + 4), qy = f32(vv, off + 8), qz = f32(vv, off + 12)
          const px = f32(vv, off + 16), py = f32(vv, off + 20), pz = f32(vv, off + 24)
          const sx = f32(vv, off + 28), sy = f32(vv, off + 32), sz = f32(vv, off + 36)
          console.log(`    bone[${b}] rot=(${qw.toFixed(4)},${qx.toFixed(4)},${qy.toFixed(4)},${qz.toFixed(4)}) pos=(${px.toFixed(4)},${py.toFixed(4)},${pz.toFixed(4)}) scl=(${sx.toFixed(4)},${sy.toFixed(4)},${sz.toFixed(4)})`)
        }

        // Check what typical V0 value ranges are
        const v0Rots: number[] = []
        const v0Pos: number[] = []
        const v0Scl: number[] = []
        for (let f = 0; f < Math.min(v0Frames, 10); f++) {
          for (let b = 0; b < v0Bones; b++) {
            const off = v0DataStart + (f * v0Bones + b) * 40
            for (let i = 0; i < 4; i++) v0Rots.push(f32(vv, off + i * 4))
            for (let i = 0; i < 3; i++) v0Pos.push(f32(vv, off + 16 + i * 4))
            for (let i = 0; i < 3; i++) v0Scl.push(f32(vv, off + 28 + i * 4))
          }
        }
        const stats = (arr: number[]) => {
          const s = arr.filter(v => isFinite(v)).sort((a, b) => a - b)
          return { min: s[0], max: s[s.length - 1], median: s[Math.floor(s.length / 2)], unique: new Set(s.map(v => v.toFixed(4))).size }
        }
        const rs = stats(v0Rots), ps = stats(v0Pos), ss = stats(v0Scl)
        console.log(`  V0 rotation range: [${rs.min?.toFixed(4)}, ${rs.max?.toFixed(4)}] unique=${rs.unique}`)
        console.log(`  V0 position range: [${ps.min?.toFixed(4)}, ${ps.max?.toFixed(4)}] unique=${ps.unique}`)
        console.log(`  V0 scale range: [${ss.min?.toFixed(4)}, ${ss.max?.toFixed(4)}] unique=${ss.unique}`)

        // Check how many bones have constant values across all V0 frames
        let constRotBones = 0, constPosBones = 0, constSclBones = 0
        for (let b = 0; b < v0Bones; b++) {
          let rotConst = true, posConst = true, sclConst = true
          const firstOff = v0DataStart + b * 40
          const fq = [f32(vv, firstOff), f32(vv, firstOff + 4), f32(vv, firstOff + 8), f32(vv, firstOff + 12)]
          const fp = [f32(vv, firstOff + 16), f32(vv, firstOff + 20), f32(vv, firstOff + 24)]
          const fs = [f32(vv, firstOff + 28), f32(vv, firstOff + 32), f32(vv, firstOff + 36)]
          for (let f = 1; f < v0Frames; f++) {
            const off = v0DataStart + (f * v0Bones + b) * 40
            for (let i = 0; i < 4; i++) if (f32(vv, off + i * 4) !== fq[i]) rotConst = false
            for (let i = 0; i < 3; i++) if (f32(vv, off + 16 + i * 4) !== fp[i]) posConst = false
            for (let i = 0; i < 3; i++) if (f32(vv, off + 28 + i * 4) !== fs[i]) sclConst = false
          }
          if (rotConst) constRotBones++
          if (posConst) constPosBones++
          if (sclConst) constSclBones++
        }
        console.log(`  V0 constant bones: rot=${constRotBones}/${v0Bones} pos=${constPosBones}/${v0Bones} scl=${constSclBones}/${v0Bones}`)
        console.log(`  Animated tracks: rot=${v0Bones - constRotBones} pos=${v0Bones - constPosBones} scl=${v0Bones - constSclBones}`)
        console.log(`  Total animated tracks: ${(v0Bones - constRotBones) + (v0Bones - constPosBones) + (v0Bones - constSclBones)}`)
      }
    }

    // ---- Final: try to understand track layout ----
    // Hypothesis: After the AC11 fixed header, we have:
    // 1. A track descriptor section (bone indices or flags)
    // 2. Constant value section (for non-animated tracks)
    // 3. Animated keyframe data (quantized)

    // Look for patterns that match boneCount * something
    console.log('\n--- Pattern matching for bone-aligned data ---')
    for (let stride = 1; stride <= 16; stride++) {
      for (let start = 0x70; start < 0xE0; start += 4) {
        if (start + boneCount * stride > d.length) continue
        // Check if this region has the right "shape"
        const region = d.subarray(start, start + boneCount * stride)
        const zeros = [...region].filter(b => b === 0).length
        const unique = new Set(region).size
        // Only report if it's interesting
        if (zeros > boneCount * stride * 0.3 && zeros < boneCount * stride * 0.9 && unique > 2 && unique < boneCount * stride * 0.5) {
          console.log(`  start=${hex(start, 2)} stride=${stride} zeros=${zeros}/${boneCount * stride} unique=${unique}`)
        }
      }
    }
  }
}

// ============================================================
// PHASE 3: Compare simplest possible V1 anim to understand structure
// ============================================================

if (v1s.length > 0) {
  console.log(`\n${'='.repeat(80)}`)
  console.log('PHASE 3: Simplest V1 anim - byte-level breakdown')
  console.log('='.repeat(80))

  // Find the smallest V1 anim
  const smallest = [...v1s].sort((a, b) => a.data.length - b.data.length)[0]
  const d = smallest.data
  const v = new DataView(d.buffer, d.byteOffset, d.byteLength)

  const fps = f32(v, 0x08)
  const frameCount = u32(v, 0x0c)
  const boneCount = u32(v, 0x10) & 0xffff
  const nameOff = u32(v, 0x50)
  let animName = ''
  if (nameOff > 0 && nameOff < d.length) {
    const end = d.indexOf(0, nameOff)
    if (end > nameOff) animName = String.fromCharCode(...d.subarray(nameOff, Math.min(end, nameOff + 100)))
  }

  console.log(`\nName: ${animName}, ${d.length} bytes, ${frameCount} frames, ${boneCount} bones, ${fps} fps`)
  console.log(`Data region: 0x60 to ${hex(nameOff)} = ${nameOff - 0x60} bytes`)

  // Complete hexdump of data region
  console.log('\n--- Complete data region hexdump ---')
  hexdump(d.subarray(0x60, nameOff), 0x60, Math.ceil((nameOff - 0x60) / 16))

  // Try every possible interpretation of the data
  console.log('\n--- Every u32 field annotated ---')
  for (let off = 0x60; off + 4 <= nameOff; off += 4) {
    const val = u32(v, off)
    const ival = i32(v, off)
    const fval = f32(v, off)
    const h0 = u16(v, off), h1 = u16(v, off + 2)
    const sh0 = i16(v, off), sh1 = i16(v, off + 2)
    const fh0 = f16(v, off), fh1 = f16(v, off + 2)

    const annot: string[] = []
    if (val === 0xac11ac11) annot.push('AC11 MAGIC')
    if (val === 0xffffffff) annot.push('SENTINEL')
    if (val === boneCount) annot.push('=boneCount')
    if (val === frameCount) annot.push('=frameCount')
    if (val === frameCount - 1) annot.push('=frameCount-1')
    if (val === nameOff - 0x60) annot.push('=dataSz')
    if (isFinite(fval) && Math.abs(fval) > 0.0001 && Math.abs(fval) < 1e5) annot.push(`f32=${fval.toFixed(6)}`)

    console.log(`  ${hex(off, 3)}: ${hex(val)}  u16=[${h0},${h1}]  i16=[${sh0},${sh1}]  f16=[${fh0.toFixed(4)},${fh1.toFixed(4)}]  ${annot.join(' ')}`)
  }
}

console.log('\n\nDone.')
