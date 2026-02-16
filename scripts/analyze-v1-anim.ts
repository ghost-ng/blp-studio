#!/usr/bin/env npx tsx
/**
 * Analyze V1 compressed animation format from BLP files.
 *
 * V1 animations share the same magic (0x6AB06AB0) as V0 but differ:
 *   - Offset 0x48 is NOT 0xFFFFFFFF (V0 marker)
 *   - Has AC11AC11 subheader at offset 0x60
 *   - Uses "indexed tracks" compression
 *
 * Usage: npx tsx scripts/analyze-v1-anim.ts <file.blp> [count]
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { resolve, join } from 'path'
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

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------

function hexdump(data: Buffer | Uint8Array, maxRows = 32, startOffset = 0): void {
  const rows = Math.min(maxRows, Math.ceil(data.length / 16))
  for (let row = 0; row < rows; row++) {
    const off = row * 16
    const bytes = data.subarray(off, Math.min(off + 16, data.length))
    const hex: string[] = []
    for (let i = 0; i < 16; i++) {
      hex.push(i < bytes.length ? bytes[i].toString(16).padStart(2, '0') : '  ')
    }
    let ascii = ''
    for (let i = 0; i < bytes.length; i++) {
      const b = bytes[i]
      ascii += b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : '.'
    }
    console.log(
      `  ${(startOffset + off).toString(16).padStart(8, '0')}  ${hex.slice(0, 8).join(' ')}  ${hex.slice(8).join(' ')}  |${ascii}|`
    )
  }
}

function u8(data: Uint8Array, off: number): number {
  return data[off]
}
function u16(view: DataView, off: number): number {
  return view.getUint16(off, true)
}
function u32(view: DataView, off: number): number {
  return view.getUint32(off, true)
}
function i32(view: DataView, off: number): number {
  return view.getInt32(off, true)
}
function f32(view: DataView, off: number): number {
  return view.getFloat32(off, true)
}

function isQuatLike(a: number, b: number, c: number, d: number): boolean {
  const mag = Math.sqrt(a * a + b * b + c * c + d * d)
  return mag > 0.95 && mag < 1.05 && Math.abs(a) <= 1.01 && Math.abs(b) <= 1.01 && Math.abs(c) <= 1.01 && Math.abs(d) <= 1.01
}

function fmtHex(v: number, pad = 8): string {
  return '0x' + v.toString(16).padStart(pad, '0').toUpperCase()
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const [, , blpPath, countStr] = process.argv
if (!blpPath) {
  console.error('Usage: npx tsx scripts/analyze-v1-anim.ts <file.blp> [count]')
  process.exit(1)
}
const maxCount = parseInt(countStr || '5')
const filepath = resolve(blpPath)

console.log(`Opening BLP: ${filepath}\n`)
const parser = new BLPParser(filepath)
parser.parse()

// Build shared data index
const gameRoot = findGameRootFromPath(filepath)
let sdDirs = gameRoot ? findAllSharedData(gameRoot) : []
if (sdDirs.length === 0) {
  const steamDirs = findSharedDataCandidates()
  for (const d of steamDirs) {
    if (!sdDirs.includes(d)) sdDirs.push(d)
  }
}
console.log(`Game root: ${gameRoot || 'not found'}`)
console.log(`SHARED_DATA dirs: ${sdDirs.length}`)
const sdIndex = buildSharedDataIndex(sdDirs)

// Find Oodle
let oodle: OodleDecompressor | null = null
for (const p of findOodleCandidates()) {
  try {
    oodle = new OodleDecompressor(p)
    break
  } catch {
    /* */
  }
}
console.log(`Shared data: ${sdIndex.size} files, Oodle: ${oodle ? 'loaded' : 'NOT FOUND'}\n`)

// ---------------------------------------------------------------------------
// Helper: load + decompress a blob by name
// ---------------------------------------------------------------------------

function loadBlob(name: string, expectedSize: number): Buffer | null {
  const civbigPath = sdIndex.get(name)
  if (!civbigPath) return null
  try {
    const { data: rawData } = readCivbig(civbigPath)
    if (OodleDecompressor.isOodleCompressed(rawData) && oodle) {
      const d = oodle.decompress(rawData, expectedSize || rawData.length * 4)
      return d || rawData
    }
    return rawData
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Collect all animation blobs (blobType 5), classify V0 vs V1
// ---------------------------------------------------------------------------

const ANIM_MAGIC = 0x6ab06ab0
const AC11_MAGIC = 0xac11ac11

interface AnimInfo {
  name: string
  blobSize: number
  data: Buffer
}

const v0Anims: AnimInfo[] = []
const v1Anims: AnimInfo[] = []

for (const alloc of parser.iterEntriesByType('BLP::BlobEntry')) {
  const obj = parser.deserializeAlloc(alloc)
  const bt = (obj.m_nBlobType as number) ?? -1
  if (bt !== 5) continue
  const name = obj.m_Name as string
  const sz = (obj.m_nSize as number) || 0

  const data = loadBlob(name, sz)
  if (!data || data.length < 96) continue

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const magic = u32(view, 0)
  if (magic !== ANIM_MAGIC) continue

  const off48 = u32(view, 0x48)
  if (off48 === 0xffffffff) {
    v0Anims.push({ name, blobSize: sz, data })
  } else {
    v1Anims.push({ name, blobSize: sz, data })
  }
}

console.log(`Found ${v0Anims.length} V0 animations, ${v1Anims.length} V1 animations\n`)

// ---------------------------------------------------------------------------
// Reference: dump one V0 for comparison
// ---------------------------------------------------------------------------

if (v0Anims.length > 0) {
  const a = v0Anims[0]
  const d = a.data
  const v = new DataView(d.buffer, d.byteOffset, d.byteLength)
  console.log('='.repeat(80))
  console.log(`V0 REFERENCE: ${a.name} (${d.length} bytes)`)
  console.log('='.repeat(80))
  console.log('  Header hex:')
  hexdump(d.subarray(0, 0x60), 6, 0)
  console.log()
  for (let off = 0; off < 0x60; off += 4) {
    const val = u32(v, off)
    const fval = f32(v, off)
    const isFloat = isFinite(fval) && Math.abs(fval) > 0.0001 && Math.abs(fval) < 1e6
    console.log(
      `  0x${off.toString(16).padStart(2, '0')}: ${fmtHex(val)} (${val.toString().padStart(10)})${isFloat ? ` [f32=${fval.toFixed(4)}]` : ''}`
    )
  }
  const fc = u32(v, 0x0c)
  const bc = u32(v, 0x10)
  console.log(`\n  V0: fps=${f32(v, 0x08)} frames=${fc} bones=${bc}`)
  console.log(`  V0: expected data = 0x60 + ${fc}*${bc}*40 = ${0x60 + fc * bc * 40}, actual = ${d.length}`)

  // Show first frame, first bone data
  if (d.length >= 0x60 + 40) {
    console.log(`\n  V0 first keyframe (frame 0, bone 0):`)
    const base = 0x60
    console.log(`    qw=${f32(v, base).toFixed(6)} qx=${f32(v, base + 4).toFixed(6)} qy=${f32(v, base + 8).toFixed(6)} qz=${f32(v, base + 12).toFixed(6)}`)
    console.log(`    px=${f32(v, base + 16).toFixed(6)} py=${f32(v, base + 20).toFixed(6)} pz=${f32(v, base + 24).toFixed(6)}`)
    console.log(`    sx=${f32(v, base + 28).toFixed(6)} sy=${f32(v, base + 32).toFixed(6)} sz=${f32(v, base + 36).toFixed(6)}`)
  }
  console.log()
}

// ---------------------------------------------------------------------------
// Deep V1 analysis
// ---------------------------------------------------------------------------

const analyzeCount = Math.min(maxCount, v1Anims.length)

for (let ai = 0; ai < analyzeCount; ai++) {
  const anim = v1Anims[ai]
  const data = anim.data
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)

  console.log(`\n${'='.repeat(80)}`)
  console.log(`V1 ANIMATION #${ai}: ${anim.name}`)
  console.log(`Total size: ${data.length} bytes (${fmtHex(data.length)})`)
  console.log('='.repeat(80))

  // ---- Full header dump ----
  console.log('\n--- HEADER (0x00 - 0x5F) ---')
  hexdump(data.subarray(0, 0x60), 6, 0)

  console.log('\n  Parsed header fields:')
  for (let off = 0; off < 0x60; off += 4) {
    const val = u32(view, off)
    const fval = f32(view, off)
    const isFloat = isFinite(fval) && Math.abs(fval) > 0.0001 && Math.abs(fval) < 1e6
    console.log(
      `  0x${off.toString(16).padStart(2, '0')}: ${fmtHex(val)} (${val.toString().padStart(10)})${isFloat ? ` [f32=${fval.toFixed(6)}]` : ''}`
    )
  }

  const fps = f32(view, 0x08)
  const frameCount = u32(view, 0x0c)
  const boneField = u32(view, 0x10)
  const boneCount = boneField & 0xffff
  const boneHi = (boneField >> 16) & 0xffff
  const nameOff = u32(view, 0x50)
  const off48 = u32(view, 0x48)

  // Read name
  let animName = ''
  if (nameOff > 0 && nameOff < data.length) {
    const end = data.indexOf(0, nameOff)
    if (end > nameOff) animName = String.fromCharCode(...data.subarray(nameOff, Math.min(end, nameOff + 128)))
  }

  console.log(`\n  Summary: name="${animName}" fps=${fps} frames=${frameCount} bones=${boneCount} boneHi=${boneHi}`)
  console.log(`  Name at offset ${fmtHex(nameOff)}, data marker 0x48=${fmtHex(off48)}`)

  // ---- AC11 subheader ----
  console.log('\n--- AC11 SUBHEADER (0x60+) ---')
  const subEnd = Math.min(data.length, 0x160)
  hexdump(data.subarray(0x60, subEnd), Math.ceil((subEnd - 0x60) / 16), 0x60)

  const ac11 = u32(view, 0x60)
  console.log(`\n  0x60 subMagic: ${fmtHex(ac11)} ${ac11 === AC11_MAGIC ? '<-- AC11AC11 confirmed' : ''}`)

  // Dump AC11 subheader fields as u32
  console.log('\n  AC11 subheader as uint32:')
  for (let off = 0x60; off < Math.min(0xe0, data.length - 3); off += 4) {
    const val = u32(view, off)
    const fval = f32(view, off)
    const isFloat = isFinite(fval) && Math.abs(fval) > 0.0001 && Math.abs(fval) < 1e6
    console.log(
      `    0x${off.toString(16).padStart(2, '0')}: ${fmtHex(val)} (${val.toString().padStart(10)})${isFloat ? ` [f32=${fval.toFixed(6)}]` : ''}`
    )
  }

  // Also dump as uint16
  console.log('\n  AC11 subheader as uint16:')
  for (let off = 0x60; off < Math.min(0xe0, data.length - 1); off += 16) {
    const vals: string[] = []
    for (let i = 0; i < 8 && off + i * 2 + 1 < data.length; i++) {
      vals.push(u16(view, off + i * 2).toString().padStart(5))
    }
    console.log(`    0x${off.toString(16).padStart(2, '0')}: ${vals.join(' ')}`)
  }

  // ---- Data size analysis ----
  console.log('\n--- DATA SIZE ANALYSIS ---')
  const v0Equiv = frameCount * boneCount * 40
  console.log(`  V0 equivalent size: ${v0Equiv} bytes`)
  console.log(`  Actual data (after 0x60): ${data.length - 0x60} bytes`)
  console.log(`  Total file: ${data.length} bytes`)
  console.log(`  Compression ratio: ${((data.length - 0x60) / v0Equiv * 100).toFixed(1)}% of V0`)

  // Try to understand what the fields at 0x18, 0x20, 0x28 etc represent
  const f18 = u32(view, 0x18)
  const f20 = u32(view, 0x20)
  const f28 = u32(view, 0x28)
  console.log(`  field_18 = ${f18} (could be main data size?)`)
  console.log(`  field_20 = ${f20} (could be secondary data size?)`)
  console.log(`  field_28 = ${f28}`)
  console.log(`  Data after name: ${data.length - nameOff} bytes`)

  // ---- Per-bone bytes analysis ----
  if (boneCount > 0 && frameCount > 0) {
    const dataRegionSize = nameOff - 0x60
    console.log(`\n  Data region (0x60..nameOff): ${dataRegionSize} bytes`)
    console.log(`  Bytes per bone: ${(dataRegionSize / boneCount).toFixed(2)}`)
    console.log(`  Bytes per frame: ${(dataRegionSize / frameCount).toFixed(2)}`)
    console.log(`  Bytes per bone per frame: ${(dataRegionSize / (boneCount * frameCount)).toFixed(4)}`)
  }

  // ---- Scan for structure patterns ----
  console.log('\n--- STRUCTURE SCAN ---')

  // Look for the AC11 subheader structure size by checking when the data pattern changes
  // Hypothesis: AC11 has a fixed-size header, followed by per-track descriptors, then packed data

  // Check each uint32 in the AC11 region for values that match boneCount, frameCount, or other dimensions
  console.log('\n  Fields matching known dimensions:')
  for (let off = 0x60; off < Math.min(0x100, data.length - 3); off += 4) {
    const val = u32(view, off)
    const matches: string[] = []
    if (val === boneCount) matches.push('boneCount')
    if (val === frameCount) matches.push('frameCount')
    if (val === boneCount * 3) matches.push('boneCount*3')
    if (val === boneCount * 4) matches.push('boneCount*4')
    if (val === boneCount * 10) matches.push('boneCount*10')
    if (val === frameCount * boneCount) matches.push('frames*bones')
    if (val === data.length) matches.push('fileSize')
    if (val === data.length - 0x60) matches.push('dataSize')
    if (val === nameOff) matches.push('nameOff')
    if (val === nameOff - 0x60) matches.push('nameOff-0x60')
    if (matches.length > 0) {
      console.log(`    0x${off.toString(16)}: ${val} => ${matches.join(', ')}`)
    }
  }

  // ---- Try to identify track descriptor table ----
  // Idea: after the AC11 header, there's likely a table of per-track descriptors
  // Each track encodes one bone's rotation, position, or scale channel
  // A track descriptor might contain: track type, bone index, key count, data offset

  console.log('\n--- TRACK DESCRIPTOR SEARCH ---')

  // Strategy 1: Look for boneCount consecutive small structs
  for (const tableStart of [0x64, 0x68, 0x6c, 0x70, 0x74, 0x78, 0x7c, 0x80]) {
    if (tableStart >= data.length) continue

    for (const stride of [2, 4, 6, 8, 10, 12, 16, 20, 24]) {
      const tableEnd = tableStart + boneCount * stride
      if (tableEnd > data.length || tableEnd > nameOff) continue

      // Check if all values in the table are small/reasonable
      let allSmall = true
      let minVal = Infinity
      let maxVal = -Infinity
      for (let i = 0; i < boneCount; i++) {
        for (let b = 0; b < stride; b++) {
          const byte = data[tableStart + i * stride + b]
          minVal = Math.min(minVal, byte)
          maxVal = Math.max(maxVal, byte)
        }
      }
      // Skip if it's just zeros or spans the whole byte range
      if (maxVal === 0) continue

      // Check if the values after the table have a different character
      if (tableEnd + stride < data.length) {
        let postMin = Infinity
        let postMax = -Infinity
        for (let b = 0; b < Math.min(stride * 4, data.length - tableEnd); b++) {
          const byte = data[tableEnd + b]
          postMin = Math.min(postMin, byte)
          postMax = Math.max(postMax, byte)
        }

        // If there's a clear boundary
        if (maxVal < 128 && postMax > 200 && maxVal < postMax / 2) {
          console.log(
            `  Candidate table: start=0x${tableStart.toString(16)} stride=${stride} ` +
              `end=0x${tableEnd.toString(16)} byte range=[${minVal}..${maxVal}] post=[${postMin}..${postMax}]`
          )
          // Dump first few records
          for (let r = 0; r < Math.min(8, boneCount); r++) {
            const rOff = tableStart + r * stride
            const bytes: string[] = []
            for (let b = 0; b < stride; b++) bytes.push(data[rOff + b].toString(16).padStart(2, '0'))
            // Also show as uint16 pairs
            const u16s: string[] = []
            for (let b = 0; b + 1 < stride; b += 2) u16s.push(u16(view, rOff + b).toString())
            console.log(`    [${r}] bytes: ${bytes.join(' ')}  u16: [${u16s.join(', ')}]`)
          }
        }
      }
    }
  }

  // Strategy 2: look for sequential integers (bone indices 0,1,2,3...)
  console.log('\n  Looking for sequential bone indices...')
  for (let off = 0x60; off < Math.min(0x200, data.length - boneCount * 2); off++) {
    // Check uint8 sequential
    let seqU8 = true
    for (let i = 0; i < Math.min(boneCount, 30); i++) {
      if (data[off + i] !== i) { seqU8 = false; break }
    }
    if (seqU8 && boneCount > 3) {
      console.log(`    Sequential uint8 0..N at offset 0x${off.toString(16)}`)
    }

    // Check uint16 sequential
    if (off % 2 === 0 && off + boneCount * 2 < data.length) {
      let seqU16 = true
      for (let i = 0; i < Math.min(boneCount, 30); i++) {
        if (u16(view, off + i * 2) !== i) { seqU16 = false; break }
      }
      if (seqU16 && boneCount > 3) {
        console.log(`    Sequential uint16 0..N at offset 0x${off.toString(16)}`)
      }
    }
  }

  // Strategy 3: Look for monotonically increasing values (could be offsets)
  console.log('\n  Looking for monotonically increasing offset arrays...')
  for (let off = 0x64; off < Math.min(0x100, data.length - 20); off += 4) {
    let mono = true
    let count = 0
    let prev = u32(view, off)
    if (prev > data.length) continue
    for (let j = off + 4; j < Math.min(data.length - 3, off + boneCount * 4 + 4); j += 4) {
      const curr = u32(view, j)
      if (curr <= prev || curr > data.length) { mono = false; break }
      prev = curr
      count++
    }
    if (mono && count >= Math.min(5, boneCount - 1)) {
      const vals: number[] = []
      for (let j = 0; j <= count; j++) vals.push(u32(view, off + j * 4))
      console.log(`    Monotonic u32 at 0x${off.toString(16)}: ${count + 1} values [${vals.slice(0, 10).join(', ')}${vals.length > 10 ? '...' : ''}]`)
      // Show deltas
      const deltas: number[] = []
      for (let j = 1; j < vals.length; j++) deltas.push(vals[j] - vals[j - 1])
      console.log(`      Deltas: [${deltas.slice(0, 10).join(', ')}${deltas.length > 10 ? '...' : ''}]`)
    }
  }

  // ---- Analyze the data region beyond the AC11 subheader ----
  // Try to determine where the AC11 header ends and the actual track data begins

  console.log('\n--- DATA REGION ANALYSIS ---')

  // Look for float32 runs (rotation/position/scale data)
  let bestF32Start = 0
  let bestF32Run = 0
  for (let off = 0x60; off < data.length - 40; off += 4) {
    let run = 0
    for (let j = off; j < data.length - 4; j += 4) {
      const fv = f32(view, j)
      if (isFinite(fv) && Math.abs(fv) < 1000) run++
      else break
    }
    if (run > bestF32Run) {
      bestF32Run = run
      bestF32Start = off
    }
  }
  console.log(`  Longest f32 run: ${bestF32Run} floats starting at ${fmtHex(bestF32Start)}`)
  if (bestF32Run > 4) {
    const showN = Math.min(bestF32Run, 20)
    const vals: string[] = []
    for (let i = 0; i < showN; i++) vals.push(f32(view, bestF32Start + i * 4).toFixed(4))
    console.log(`    First ${showN}: [${vals.join(', ')}]`)

    // Check if the floats form quaternions
    let quatCount = 0
    for (let i = 0; i + 3 < bestF32Run; i += 4) {
      const a = f32(view, bestF32Start + i * 4)
      const b = f32(view, bestF32Start + (i + 1) * 4)
      const c = f32(view, bestF32Start + (i + 2) * 4)
      const d = f32(view, bestF32Start + (i + 3) * 4)
      if (isQuatLike(a, b, c, d)) quatCount++
    }
    console.log(`    Quaternion-like groups of 4: ${quatCount}`)

    // Check if they form groups of 10 (V0-style: qw,qx,qy,qz,px,py,pz,sx,sy,sz)
    if (bestF32Run >= 10) {
      console.log(`    As groups of 10 (V0-style keyframe):`)
      for (let g = 0; g < Math.min(3, Math.floor(bestF32Run / 10)); g++) {
        const base = bestF32Start + g * 40
        const qw = f32(view, base), qx = f32(view, base + 4), qy = f32(view, base + 8), qz = f32(view, base + 12)
        const px = f32(view, base + 16), py = f32(view, base + 20), pz = f32(view, base + 24)
        const sx = f32(view, base + 28), sy = f32(view, base + 32), sz = f32(view, base + 36)
        const qmag = Math.sqrt(qw * qw + qx * qx + qy * qy + qz * qz)
        console.log(`      [${g}] rot=(${qw.toFixed(4)},${qx.toFixed(4)},${qy.toFixed(4)},${qz.toFixed(4)}) mag=${qmag.toFixed(4)}  pos=(${px.toFixed(4)},${py.toFixed(4)},${pz.toFixed(4)})  scl=(${sx.toFixed(4)},${sy.toFixed(4)},${sz.toFixed(4)})`)
      }
    }
  }

  // ---- Look for uint16 quantized data ----
  console.log('\n  Looking for uint16 quantized values...')
  // Check if there's a region where values interpreted as uint16 are mostly in a specific range
  for (const testOff of [0x70, 0x80, 0x90, 0xa0, 0xb0, 0xc0]) {
    if (testOff + 100 > data.length) continue
    const u16vals: number[] = []
    for (let i = 0; i < 50; i++) {
      if (testOff + i * 2 + 1 < data.length) u16vals.push(u16(view, testOff + i * 2))
    }
    // Check distribution
    const maxU16 = Math.max(...u16vals)
    const minU16 = Math.min(...u16vals)
    const mean = u16vals.reduce((a, b) => a + b, 0) / u16vals.length
    // Interesting if values are clustered
    if (maxU16 < 1024 || (minU16 > 10000 && maxU16 < 60000)) {
      console.log(`    0x${testOff.toString(16)}: u16 range [${minU16}..${maxU16}] mean=${mean.toFixed(0)}`)
    }
  }

  // ---- Extended hex dump of data ----
  console.log('\n--- FULL DATA DUMP (0x60..0x300) ---')
  const dumpEnd = Math.min(data.length, 0x300)
  hexdump(data.subarray(0x60, dumpEnd), Math.ceil((dumpEnd - 0x60) / 16), 0x60)

  // ---- Dump the region right before the name string ----
  if (nameOff > 0x100) {
    console.log(`\n--- DATA BEFORE NAME (0x${Math.max(0x60, nameOff - 128).toString(16)}..0x${nameOff.toString(16)}) ---`)
    const preNameStart = Math.max(0x60, nameOff - 128)
    hexdump(data.subarray(preNameStart, nameOff), Math.ceil((nameOff - preNameStart) / 16), preNameStart)
  }

  // ---- Post-name data ----
  if (nameOff + animName.length + 1 < data.length) {
    const postNameStart = nameOff + animName.length + 1
    // Align to 4
    const alignedPost = (postNameStart + 3) & ~3
    if (alignedPost < data.length) {
      console.log(`\n--- DATA AFTER NAME (0x${alignedPost.toString(16)}..end) ---`)
      hexdump(data.subarray(alignedPost, Math.min(data.length, alignedPost + 128)), 8, alignedPost)
    }
  }

  // ---- Write raw file for external analysis ----
  const outDir = join(resolve(blpPath, '..'), 'extracted-v1')
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true })
  const safeFileName = anim.name.replace(/[^a-zA-Z0-9._-]/g, '_')
  const outPath = join(outDir, `${safeFileName}.anim`)
  writeFileSync(outPath, data)
  console.log(`\n  Wrote: ${outPath}`)
}

// ---------------------------------------------------------------------------
// Cross-animation comparison
// ---------------------------------------------------------------------------

if (v1Anims.length >= 2) {
  console.log(`\n${'='.repeat(80)}`)
  console.log('CROSS-ANIMATION COMPARISON')
  console.log('='.repeat(80))

  // Compare key structural fields across all V1 anims
  console.log('\n--- Dimension table ---')
  console.log(
    '  ' +
      'Name'.padEnd(40) +
      'Size'.padStart(8) +
      'Fps'.padStart(6) +
      'Frms'.padStart(6) +
      'Bones'.padStart(6) +
      'Hi16'.padStart(6) +
      'off48'.padStart(10) +
      'nameOff'.padStart(10) +
      'V0eq'.padStart(10) +
      'Ratio'.padStart(8)
  )

  for (let i = 0; i < Math.min(20, v1Anims.length); i++) {
    const a = v1Anims[i]
    const v = new DataView(a.data.buffer, a.data.byteOffset, a.data.byteLength)
    const fps = f32(v, 0x08)
    const fc = u32(v, 0x0c)
    const bf = u32(v, 0x10)
    const bc = bf & 0xffff
    const hi = (bf >> 16) & 0xffff
    const o48 = u32(v, 0x48)
    const nOff = u32(v, 0x50)
    const v0eq = fc * bc * 40
    const ratio = ((a.data.length - 0x60) / v0eq * 100).toFixed(1)

    // Read name
    let nm = ''
    if (nOff > 0 && nOff < a.data.length) {
      const end = a.data.indexOf(0, nOff)
      if (end > nOff) nm = String.fromCharCode(...a.data.subarray(nOff, Math.min(end, nOff + 35)))
    }

    console.log(
      '  ' +
        nm.padEnd(40) +
        a.data.length.toString().padStart(8) +
        fps.toFixed(0).padStart(6) +
        fc.toString().padStart(6) +
        bc.toString().padStart(6) +
        hi.toString().padStart(6) +
        fmtHex(o48).padStart(10) +
        fmtHex(nOff).padStart(10) +
        v0eq.toString().padStart(10) +
        (ratio + '%').padStart(8)
    )
  }

  // Compare AC11 subheader fields
  console.log('\n--- AC11 subheader field comparison (first 5 anims) ---')
  const compCount = Math.min(5, v1Anims.length)
  console.log(
    '  ' +
      'Offset'.padEnd(8) +
      v1Anims
        .slice(0, compCount)
        .map((_, i) => `Anim${i}`.padStart(12))
        .join('')
  )

  for (let off = 0x60; off < 0xc0; off += 4) {
    const row =
      '  ' +
      `0x${off.toString(16)}`.padEnd(8) +
      v1Anims
        .slice(0, compCount)
        .map((a) => {
          const v = new DataView(a.data.buffer, a.data.byteOffset, a.data.byteLength)
          return off + 4 <= a.data.length ? u32(v, off).toString().padStart(12) : '---'.padStart(12)
        })
        .join('')
    console.log(row)
  }

  // Compare field relationships
  console.log('\n--- Field relationships ---')
  for (let i = 0; i < compCount; i++) {
    const a = v1Anims[i]
    const v = new DataView(a.data.buffer, a.data.byteOffset, a.data.byteLength)
    const fc = u32(v, 0x0c)
    const bc = u32(v, 0x10) & 0xffff
    const hi = (u32(v, 0x10) >> 16) & 0xffff
    const o48 = u32(v, 0x48)
    const nOff = u32(v, 0x50)
    const dataRegion = nOff - 0x60

    console.log(`\n  Anim${i}: frames=${fc} bones=${bc} hi16=${hi}`)
    console.log(`    Data region: ${dataRegion} bytes`)

    // Check which fields relate to data size
    for (let off = 0x14; off < 0x5c; off += 4) {
      const val = u32(v, off)
      if (val === 0) continue
      const ratioToData = dataRegion / val
      const ratioToSize = a.data.length / val
      if (Math.abs(ratioToData - 1) < 0.01) console.log(`    0x${off.toString(16)} = ${val} ~= data region size`)
      if (Math.abs(ratioToSize - 1) < 0.01) console.log(`    0x${off.toString(16)} = ${val} ~= total file size`)
      if (val === fc * bc) console.log(`    0x${off.toString(16)} = ${val} = frames*bones`)
      if (val === fc * bc * 10) console.log(`    0x${off.toString(16)} = ${val} = frames*bones*10`)
      if (val === fc * bc * 4) console.log(`    0x${off.toString(16)} = ${val} = frames*bones*4`)
      if (bc > 0 && val % bc === 0 && val / bc < 1000) console.log(`    0x${off.toString(16)} = ${val} = bones * ${val / bc}`)
      if (fc > 0 && val % fc === 0 && val / fc < 1000) console.log(`    0x${off.toString(16)} = ${val} = frames * ${val / fc}`)
    }
  }
}

// ---------------------------------------------------------------------------
// Try to decode data assuming various encoding schemes
// ---------------------------------------------------------------------------

if (v1Anims.length > 0) {
  const anim = v1Anims[0]
  const data = anim.data
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const frameCount = u32(view, 0x0c)
  const boneCount = u32(view, 0x10) & 0xffff
  const nameOff = u32(view, 0x50)

  console.log(`\n${'='.repeat(80)}`)
  console.log('ENCODING HYPOTHESIS TESTING (on first V1 anim)')
  console.log('='.repeat(80))

  // Hypothesis A: After AC11 header, there's a palette of unique rotation values,
  // then per-frame indices into that palette
  console.log('\n--- Hypothesis A: Palette + indices ---')

  // The AC11 subheader might contain:
  //   +0: AC11AC11 magic
  //   +4: palette count
  //   +8: palette offset (relative to 0x60 or absolute)
  //   +C: index data offset
  // Then palette[N] of float32x4 or float32x10 values
  // Then indices[frames*bones] of uint16 or uint8

  const palCount64 = u32(view, 0x64)
  const palCount68 = u32(view, 0x68)
  const palCount6c = u32(view, 0x6c)

  console.log(`  Candidate palette counts: +4=${palCount64}, +8=${palCount68}, +C=${palCount6c}`)

  // If palCount64 is the number of unique keyframes, the palette starts after the AC11 header
  // Check if palCount64 * 40 (10 floats) + header fits before nameOff
  for (const pc of [palCount64, palCount68, palCount6c]) {
    if (pc > 0 && pc < 100000) {
      const pal40 = pc * 40 // 10 floats per entry
      const pal16 = pc * 16 // 4 floats per entry (quaternion only)
      const pal12 = pc * 12 // 3 floats per entry (position only)
      const dataRegion = nameOff - 0x60

      if (pal40 < dataRegion) {
        const remaining = dataRegion - pal40
        const perBoneFrame = remaining / (frameCount * boneCount)
        console.log(`    palette count ${pc}: 40B entries = ${pal40}B, remaining ${remaining}B, ${perBoneFrame.toFixed(2)} bytes/bone/frame`)
      }
      if (pal16 < dataRegion) {
        const remaining = dataRegion - pal16
        const perBoneFrame = remaining / (frameCount * boneCount)
        console.log(`    palette count ${pc}: 16B entries = ${pal16}B, remaining ${remaining}B, ${perBoneFrame.toFixed(2)} bytes/bone/frame`)
      }
    }
  }

  // Hypothesis B: The data uses quantized quaternions
  // Common approaches:
  //   - Smallest-3: 2 bits for dropped component + 3x N-bit values
  //   - 48-bit (3x uint16)
  //   - 32-bit (2+10+10+10)

  console.log('\n--- Hypothesis B: Quantized quaternion scan ---')

  // Try 32-bit smallest-3 (2+10+10+10) at various offsets
  for (const testBase of [0x64, 0x68, 0x6c, 0x70, 0x78, 0x80, 0x90, 0xa0]) {
    if (testBase + boneCount * 4 > data.length) continue
    let valid = 0
    for (let i = 0; i < Math.min(boneCount * 2, 100); i++) {
      const off = testBase + i * 4
      if (off + 4 > data.length) break
      const packed = u32(view, off)
      const dropped = (packed >> 30) & 3
      const v0 = ((packed >> 20) & 0x3ff) / 1023.0 * 2 - 1
      const v1 = ((packed >> 10) & 0x3ff) / 1023.0 * 2 - 1
      const v2 = (packed & 0x3ff) / 1023.0 * 2 - 1
      const sumSq = v0 * v0 + v1 * v1 + v2 * v2
      if (sumSq < 1.05 && sumSq > 0.001) valid++
    }
    if (valid > 10) {
      console.log(`  32-bit quaternions at 0x${testBase.toString(16)}: ${valid} valid out of ${Math.min(boneCount * 2, 100)}`)
    }
  }

  // Try 48-bit smallest-3 (2+14+16+16) at various offsets
  for (const testBase of [0x64, 0x68, 0x6c, 0x70, 0x78, 0x80, 0x90, 0xa0]) {
    if (testBase + boneCount * 6 > data.length) continue
    let valid = 0
    for (let i = 0; i < Math.min(boneCount * 2, 60); i++) {
      const off = testBase + i * 6
      if (off + 6 > data.length) break
      const a = u16(view, off)
      const b = u16(view, off + 2)
      const c = u16(view, off + 4)
      const dropped = (a >> 14) & 3
      const v0 = ((a & 0x3fff) / 0x3fff) * 2 - 1
      const v1 = (b / 0xffff) * 2 - 1
      const v2 = (c / 0xffff) * 2 - 1
      const sumSq = v0 * v0 + v1 * v1 + v2 * v2
      if (sumSq < 1.0) valid++
    }
    if (valid > 10) {
      console.log(`  48-bit quaternions at 0x${testBase.toString(16)}: ${valid} valid out of ${Math.min(boneCount * 2, 60)}`)
    }
  }

  // Hypothesis C: Track-based encoding
  // Each bone has separate rotation, position, scale tracks
  // Each track can be: constant (1 value) or keyframed (frameCount values)
  // The header tells which tracks are constant vs animated

  console.log('\n--- Hypothesis C: Per-track constant/animated flags ---')
  // Look for a bitfield or byte array that could indicate const vs animated
  // For boneCount bones with 3 tracks each (rot, pos, scale) = 3*boneCount flags
  const numTracks = boneCount * 3

  // Check for bitmask
  const bitmaskBytes = Math.ceil(numTracks / 8)
  console.log(`  Expected: ${numTracks} track flags (${bitmaskBytes} bytes as bitmask)`)

  for (const testOff of [0x64, 0x68, 0x6c, 0x70, 0x74, 0x78, 0x7c, 0x80]) {
    if (testOff + bitmaskBytes > data.length) continue
    let ones = 0
    for (let i = 0; i < bitmaskBytes; i++) {
      for (let b = 0; b < 8; b++) {
        if ((data[testOff + i] >> b) & 1) ones++
      }
    }
    const ratio = ones / numTracks
    if (ratio > 0.1 && ratio < 0.9) {
      console.log(`    Bitmask at 0x${testOff.toString(16)}: ${ones}/${numTracks} bits set (${(ratio * 100).toFixed(0)}%)`)
    }
  }

  // Check for byte array of flags (0/1 or type codes)
  for (const testOff of [0x64, 0x68, 0x6c, 0x70, 0x78, 0x80]) {
    if (testOff + numTracks > data.length) continue
    let zeros = 0
    let ones = 0
    let twos = 0
    let other = 0
    for (let i = 0; i < numTracks; i++) {
      const b = data[testOff + i]
      if (b === 0) zeros++
      else if (b === 1) ones++
      else if (b === 2) twos++
      else other++
    }
    if (other < numTracks * 0.1 && ones + twos > 0) {
      console.log(`    Byte flags at 0x${testOff.toString(16)}: ${zeros} zeros, ${ones} ones, ${twos} twos, ${other} other`)
    }
  }

  // Hypothesis D: Look for the actual encoded data layout
  // Idea: dump byte entropy in windows to find structure boundaries
  console.log('\n--- Entropy analysis (32-byte windows) ---')
  const windowSize = 32
  for (let off = 0x60; off < Math.min(data.length - windowSize, 0x400); off += windowSize) {
    const window = data.subarray(off, off + windowSize)
    const hist = new Array(256).fill(0)
    for (let i = 0; i < windowSize; i++) hist[window[i]]++
    let entropy = 0
    for (let i = 0; i < 256; i++) {
      if (hist[i] === 0) continue
      const p = hist[i] / windowSize
      entropy -= p * Math.log2(p)
    }
    const unique = hist.filter((c) => c > 0).length
    // Only show interesting transitions
    if (off === 0x60 || entropy < 2 || unique < 10) {
      console.log(`  0x${off.toString(16)}: entropy=${entropy.toFixed(2)} unique_bytes=${unique}`)
    }
  }
}

console.log('\n\nAnalysis complete.')
