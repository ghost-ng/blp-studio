#!/usr/bin/env npx tsx
/**
 * V1 animation format - second pass analysis.
 *
 * Based on first pass findings, this script decodes the V1 structure:
 *
 * OUTER HEADER (0x00-0x5F): 96 bytes
 *   0x00: uint32 magic (0x6AB06AB0)
 *   0x04: uint32 flags (always 0)
 *   0x08: float32 fps
 *   0x0C: uint32 frameCount
 *   0x10: uint32 boneField (lo16=boneCount, hi16=1 for V1)
 *   0x14: uint32 (0)
 *   0x18: uint32 (0 in V1, mainDataSize in V0)
 *   0x1C: uint32 (0)
 *   0x20: uint32 (0 in V1, secDataSize in V0)
 *   0x24: uint32 (0)
 *   0x28: uint32 trackDataSize (= nameOff - 0x60, size of AC11 section)
 *   0x2C: uint32 (0)
 *   0x30: uint32 nameLen
 *   0x34: uint32 (0)
 *   0x38: uint32 (0xFFFFFFFF in V1)
 *   0x3C: uint32 (0)
 *   0x40: uint32 (0xFFFFFFFF in V1)
 *   0x44: uint32 (0)
 *   0x48: uint32 ac11Offset (always 0x60 in V1)
 *   0x4C: uint32 (0)
 *   0x50: uint32 nameOffset
 *   0x54: uint32 (0)
 *   0x58: uint32 (0)
 *   0x5C: uint32 (0)
 *
 * AC11 SECTION (0x60+): variable size
 *   +0x00: uint32 sectionSize (= nameOff - 0x60)
 *   +0x04: uint32 hash (animation hash?)
 *   +0x08: uint32 magic (0xAC11AC11)
 *   +0x0C: uint32 version (0x0C00000A)
 *   +0x10: uint32 boneCount
 *   +0x14: uint32 frameCount - 1
 *   +0x18: float32 fps
 *   +0x1C: uint32 flags
 *   +0x20..+0x3C: track counts and organization
 *   +0x40: uint32 sentinel (0xFFFFFFFF)
 *   +0x44: uint32 offset to section A (bone-to-track mapping?)
 *   +0x48: uint32 offset to section B (rotation palette)
 *   +0x4C: uint32 offset to section C (position/scale palette)
 *   +0x50: uint32 offset to section D (compressed frame data)
 *   +0x54+: per-frame cumulative offsets, then per-track descriptors
 *
 * Usage: npx tsx scripts/analyze-v1-pass2.ts <file.blp> [count]
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

function u16(view: DataView, off: number): number { return view.getUint16(off, true) }
function u32(view: DataView, off: number): number { return view.getUint32(off, true) }
function i32(view: DataView, off: number): number { return view.getInt32(off, true) }
function f32(view: DataView, off: number): number { return view.getFloat32(off, true) }

function hexdump(data: Buffer | Uint8Array, maxRows = 16, startOffset = 0): void {
  const rows = Math.min(maxRows, Math.ceil(data.length / 16))
  for (let row = 0; row < rows; row++) {
    const off = row * 16
    const bytes = data.subarray(off, Math.min(off + 16, data.length))
    const hex: string[] = []
    for (let i = 0; i < 16; i++) hex.push(i < bytes.length ? bytes[i].toString(16).padStart(2, '0') : '  ')
    let ascii = ''
    for (let i = 0; i < bytes.length; i++) {
      const b = bytes[i]
      ascii += b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : '.'
    }
    console.log(`  ${(startOffset + off).toString(16).padStart(8, '0')}  ${hex.slice(0, 8).join(' ')}  ${hex.slice(8).join(' ')}  |${ascii}|`)
  }
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------
const [, , blpPath, countStr] = process.argv
if (!blpPath) {
  console.error('Usage: npx tsx scripts/analyze-v1-pass2.ts <file.blp> [count]')
  process.exit(1)
}
const maxCount = parseInt(countStr || '5')
const filepath = resolve(blpPath)

const parser = new BLPParser(filepath)
parser.parse()

const gameRoot = findGameRootFromPath(filepath)
let sdDirs = gameRoot ? findAllSharedData(gameRoot) : []
if (sdDirs.length === 0) {
  const steamDirs = findSharedDataCandidates()
  for (const d of steamDirs) { if (!sdDirs.includes(d)) sdDirs.push(d) }
}
const sdIndex = buildSharedDataIndex(sdDirs)

let oodle: OodleDecompressor | null = null
for (const p of findOodleCandidates()) {
  try { oodle = new OodleDecompressor(p); break } catch { /* */ }
}

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
  } catch { return null }
}

// Collect V1 animations
const ANIM_MAGIC = 0x6ab06ab0
const AC11_MAGIC = 0xac11ac11

interface AnimInfo { name: string; blobSize: number; data: Buffer }
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
  if (u32(view, 0) !== ANIM_MAGIC) continue
  if (u32(view, 0x48) === 0xffffffff) continue // V0
  v1Anims.push({ name, blobSize: sz, data })
}

console.log(`Found ${v1Anims.length} V1 animations\n`)

// ---------------------------------------------------------------------------
// Decode V1 structure
// ---------------------------------------------------------------------------

for (let ai = 0; ai < Math.min(maxCount, v1Anims.length); ai++) {
  const anim = v1Anims[ai]
  const data = anim.data
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)

  const frameCount = u32(view, 0x0c)
  const boneCount = u32(view, 0x10) & 0xffff
  const nameOff = u32(view, 0x50)

  let animName = ''
  if (nameOff > 0 && nameOff < data.length) {
    const end = data.indexOf(0, nameOff)
    if (end > nameOff) animName = String.fromCharCode(...data.subarray(nameOff, Math.min(end, nameOff + 128)))
  }

  console.log(`\n${'='.repeat(80)}`)
  console.log(`V1 #${ai}: "${animName}" (${data.length} bytes, ${boneCount} bones, ${frameCount} frames)`)
  console.log('='.repeat(80))

  // AC11 section starts at 0x60 (relative to file start)
  // All offsets within AC11 are relative to AC11 start (0x60)
  const ac11Base = 0x60

  const sectionSize = u32(view, ac11Base + 0x00)
  const animHash = u32(view, ac11Base + 0x04)
  const ac11Magic = u32(view, ac11Base + 0x08)
  const ac11Version = u32(view, ac11Base + 0x0c)
  const ac11BoneCount = u32(view, ac11Base + 0x10)
  const ac11FrameCount = u32(view, ac11Base + 0x14) // frameCount - 1
  const ac11Fps = f32(view, ac11Base + 0x18)
  const ac11Flags = u32(view, ac11Base + 0x1c)

  console.log(`\n--- AC11 Header ---`)
  console.log(`  sectionSize: ${sectionSize} (nameOff-0x60 = ${nameOff - 0x60})`)
  console.log(`  hash:        0x${animHash.toString(16).padStart(8, '0')}`)
  console.log(`  magic:       0x${ac11Magic.toString(16).padStart(8, '0')} ${ac11Magic === AC11_MAGIC ? '(confirmed)' : '(WRONG!)'}`)
  console.log(`  version:     0x${ac11Version.toString(16).padStart(8, '0')}`)
  console.log(`  boneCount:   ${ac11BoneCount}`)
  console.log(`  frameCount:  ${ac11FrameCount} (outer header: ${frameCount}, diff: ${frameCount - ac11FrameCount})`)
  console.log(`  fps:         ${ac11Fps}`)
  console.log(`  flags:       0x${ac11Flags.toString(16).padStart(8, '0')} (${ac11Flags})`)

  // Fields at +0x20..+0x3C
  const f20 = u32(view, ac11Base + 0x20) // some count
  const f24 = u32(view, ac11Base + 0x24) // some count
  const f28 = u32(view, ac11Base + 0x28) // some count
  const f2c = u32(view, ac11Base + 0x2c) // some count
  const f30 = u32(view, ac11Base + 0x30) // 0
  const f34 = u32(view, ac11Base + 0x34) // some count
  const f38 = u32(view, ac11Base + 0x38) // some count
  const f3c = u32(view, ac11Base + 0x3c) // boneCount

  console.log(`\n--- Track Organization ---`)
  console.log(`  +0x20 (numKeyframes?):  ${f20}`)
  console.log(`  +0x24 (numUniqueRot?):  ${f24}`)
  console.log(`  +0x28 (numUniquePos?):  ${f28}`)
  console.log(`  +0x2C (numUniqueSca?):  ${f2c}`)
  console.log(`  +0x30 (pad):            ${f30}`)
  console.log(`  +0x34 (constRotTrk?):   ${f34}`)
  console.log(`  +0x38 (constPosTrk?):   ${f38}`)
  console.log(`  +0x3C (boneCount2):     ${f3c}`)

  // Check relationships
  console.log(`\n  Relationships:`)
  console.log(`    f24 + f28 + f2c = ${f24 + f28 + f2c}`)
  console.log(`    f34 + f38 = ${f34 + f38}`)
  console.log(`    bones * 3 = ${boneCount * 3}`)
  console.log(`    f24 + f34 = ${f24 + f34} (animated rot + const rot?)`)
  console.log(`    f28 + f38 = ${f28 + f38} (animated pos + const pos?)`)

  // Section offsets at +0x40..+0x50 (relative to AC11 start)
  const sentinel = u32(view, ac11Base + 0x40) // 0xFFFFFFFF
  const offA = u32(view, ac11Base + 0x44) // offset to section A (relative to ac11Base)
  const offB = u32(view, ac11Base + 0x48) // offset to section B
  const offC = u32(view, ac11Base + 0x4c) // offset to section C
  const offD = u32(view, ac11Base + 0x50) // offset to section D

  console.log(`\n--- Section Offsets (relative to AC11 start at 0x60) ---`)
  console.log(`  sentinel:  0x${sentinel.toString(16)} (should be FFFFFFFF)`)
  console.log(`  sectionA:  0x${offA.toString(16)} (abs: 0x${(ac11Base + offA).toString(16)}) size: ${offB - offA} bytes`)
  console.log(`  sectionB:  0x${offB.toString(16)} (abs: 0x${(ac11Base + offB).toString(16)}) size: ${offC - offB} bytes`)
  console.log(`  sectionC:  0x${offC.toString(16)} (abs: 0x${(ac11Base + offC).toString(16)}) size: ${offD - offC} bytes`)
  console.log(`  sectionD:  0x${offD.toString(16)} (abs: 0x${(ac11Base + offD).toString(16)}) size: ${sectionSize - offD} bytes`)

  // Data between +0x54 and sectionA offset
  // This appears to be a cumulative frame-offset table
  const preASize = offA - 0x54
  const preACount = preASize / 4
  console.log(`\n--- Pre-Section-A Data (+0x54 to +0x${offA.toString(16)}): ${preASize} bytes = ${preACount} uint32s ---`)

  if (preACount > 0 && preACount < 1000) {
    const vals: number[] = []
    for (let i = 0; i < preACount; i++) {
      vals.push(u32(view, ac11Base + 0x54 + i * 4))
    }
    console.log(`  Values: [${vals.join(', ')}]`)

    // Check if monotonically increasing
    let isMono = true
    for (let i = 1; i < vals.length; i++) {
      if (vals[i] < vals[i - 1] && vals[i] !== 0xffffffff) { isMono = false; break }
    }
    console.log(`  Monotonic: ${isMono}`)

    // Check deltas
    if (isMono && vals.length > 1) {
      const deltas: number[] = []
      for (let i = 1; i < vals.length; i++) {
        if (vals[i] !== 0xffffffff && vals[i - 1] !== 0xffffffff)
          deltas.push(vals[i] - vals[i - 1])
      }
      if (deltas.length > 0) {
        console.log(`  Deltas: [${deltas.join(', ')}]`)
        console.log(`  Avg delta: ${(deltas.reduce((a, b) => a + b, 0) / deltas.length).toFixed(1)}`)
      }
    }

    // Any 0xFFFFFFFF values?
    const ffCount = vals.filter(v => v === 0xffffffff).length
    if (ffCount > 0) {
      console.log(`  0xFFFFFFFF count: ${ffCount} at indices: [${vals.map((v, i) => v === 0xffffffff ? i : -1).filter(i => i >= 0).join(', ')}]`)
    }
  }

  // ---- Section A: Bone-to-track mapping / Track descriptors ----
  console.log(`\n--- Section A (0x${offA.toString(16)}, abs 0x${(ac11Base + offA).toString(16)}) ---`)
  const sectionASize = offB - offA
  console.log(`  Size: ${sectionASize} bytes`)
  console.log(`  Per bone: ${(sectionASize / boneCount).toFixed(2)} bytes`)

  // Dump section A hex
  hexdump(data.subarray(ac11Base + offA, ac11Base + offB), Math.ceil(sectionASize / 16), ac11Base + offA)

  // Try interpreting as per-track 16-byte descriptors
  // (4 uint32: dataOffset, rotKeyCount, posKeyCount, scaKeyCount?)
  const sectionAEntries = sectionASize / 16
  if (Number.isInteger(sectionAEntries) && sectionAEntries > 0 && sectionAEntries < 200) {
    console.log(`\n  As 16-byte records (${sectionAEntries} entries):`)
    for (let i = 0; i < Math.min(sectionAEntries, 20); i++) {
      const base = ac11Base + offA + i * 16
      const a = u32(view, base)
      const b = u32(view, base + 4)
      const c = u32(view, base + 8)
      const d = u32(view, base + 12)
      console.log(`    [${i}] ${a}, ${b}, ${c}, ${d}  (sum b+c+d=${b + c + d})`)
    }
  }

  // Also try 4-byte per track (boneCount * 3 tracks = entries)
  const perTrack4 = sectionASize / 4
  if (Number.isInteger(perTrack4)) {
    console.log(`\n  As uint32 array (${perTrack4} entries):`)
    const vals: number[] = []
    for (let i = 0; i < perTrack4; i++) vals.push(u32(view, ac11Base + offA + i * 4))
    console.log(`    [${vals.join(', ')}]`)
  }

  // ---- Section B: First palette section ----
  console.log(`\n--- Section B (0x${offB.toString(16)}, abs 0x${(ac11Base + offB).toString(16)}) ---`)
  const sectionBSize = offC - offB
  console.log(`  Size: ${sectionBSize} bytes`)

  // Interpret as float32 array
  const sectionBFloats = sectionBSize / 4
  if (sectionBFloats > 0) {
    console.log(`  As float32: ${sectionBFloats} floats`)
    const vals: string[] = []
    for (let i = 0; i < Math.min(sectionBFloats, 40); i++) {
      vals.push(f32(view, ac11Base + offB + i * 4).toFixed(4))
    }
    console.log(`    First ${Math.min(sectionBFloats, 40)}: [${vals.join(', ')}]`)

    // Check if values are in -1..1 range (could be quantized rotation components)
    let inRange = 0
    for (let i = 0; i < sectionBFloats; i++) {
      const v = f32(view, ac11Base + offB + i * 4)
      if (v >= -1.01 && v <= 1.01) inRange++
    }
    console.log(`    Values in [-1,1]: ${inRange}/${sectionBFloats} (${(inRange / sectionBFloats * 100).toFixed(0)}%)`)

    // Check if they look like groups of 4 (quaternions) or 3 (positions)
    let quats = 0
    for (let i = 0; i + 3 < sectionBFloats; i += 4) {
      const a = f32(view, ac11Base + offB + i * 4)
      const b = f32(view, ac11Base + offB + (i + 1) * 4)
      const c = f32(view, ac11Base + offB + (i + 2) * 4)
      const d = f32(view, ac11Base + offB + (i + 3) * 4)
      const mag = Math.sqrt(a * a + b * b + c * c + d * d)
      if (mag > 0.95 && mag < 1.05) quats++
    }
    console.log(`    Quaternion-like groups of 4: ${quats} out of ${Math.floor(sectionBFloats / 4)}`)
  }

  // Interpret section B bytes as uint8/uint16 for track type encoding
  // Maybe section B is not floats but a track-type array or indices
  console.log(`\n  Section B as bytes:`)
  hexdump(data.subarray(ac11Base + offB, Math.min(ac11Base + offB + 64, ac11Base + offC)), 4, ac11Base + offB)

  // Check if section B contains 2-bit packed values (track types per bone)
  // For boneCount bones with rotation channels, we'd need boneCount * 2 bits = boneCount/4 bytes
  if (sectionBSize > 0) {
    console.log(`\n  Section B as 2-bit packed (one per bone, ${Math.ceil(boneCount * 2 / 8)} bytes needed):`)
    const packed2bit: number[] = []
    for (let i = 0; i < Math.min(sectionBSize * 4, boneCount * 2); i++) {
      const byteIdx = Math.floor(i / 4)
      const bitIdx = (i % 4) * 2
      packed2bit.push((data[ac11Base + offB + byteIdx] >> bitIdx) & 3)
    }
    console.log(`    [${packed2bit.join(', ')}]`)
  }

  // ---- Section C: Second palette section ----
  console.log(`\n--- Section C (0x${offC.toString(16)}, abs 0x${(ac11Base + offC).toString(16)}) ---`)
  const sectionCSize = offD - offC
  console.log(`  Size: ${sectionCSize} bytes`)

  // Interpret as float32
  const sectionCFloats = sectionCSize / 4
  if (sectionCFloats > 0 && sectionCFloats < 10000) {
    console.log(`  As float32: ${sectionCFloats} floats`)
    const vals: string[] = []
    for (let i = 0; i < Math.min(sectionCFloats, 40); i++) {
      vals.push(f32(view, ac11Base + offC + i * 4).toFixed(4))
    }
    console.log(`    First ${Math.min(sectionCFloats, 40)}: [${vals.join(', ')}]`)

    // Check if they're rotation-like (-1..1)
    let inRange = 0
    for (let i = 0; i < sectionCFloats; i++) {
      const v = f32(view, ac11Base + offC + i * 4)
      if (v >= -1.01 && v <= 1.01) inRange++
    }
    console.log(`    Values in [-1,1]: ${inRange}/${sectionCFloats} (${(inRange / sectionCFloats * 100).toFixed(0)}%)`)

    // Check for 0.1 scale values (0xcdcccc3d = 0.1)
    let scaleCount = 0
    for (let i = 0; i < sectionCFloats; i++) {
      const v = f32(view, ac11Base + offC + i * 4)
      if (Math.abs(v - 0.1) < 0.001) scaleCount++
    }
    if (scaleCount > 0) {
      console.log(`    Scale values (0.1): ${scaleCount}`)
    }
  }

  hexdump(data.subarray(ac11Base + offC, Math.min(ac11Base + offC + 128, ac11Base + offD)), 8, ac11Base + offC)

  // ---- Section D: Compressed frame data (bitstream) ----
  console.log(`\n--- Section D (0x${offD.toString(16)}, abs 0x${(ac11Base + offD).toString(16)}) ---`)
  const sectionDSize = sectionSize - offD
  console.log(`  Size: ${sectionDSize} bytes`)
  if (ac11FrameCount > 0) {
    console.log(`  Per frame: ${(sectionDSize / ac11FrameCount).toFixed(2)} bytes`)
    console.log(`  Per bone per frame: ${(sectionDSize / (ac11FrameCount * boneCount)).toFixed(4)} bytes`)
  }

  // First 128 bytes of section D
  hexdump(data.subarray(ac11Base + offD, Math.min(ac11Base + offD + 128, ac11Base + sectionSize)), 8, ac11Base + offD)

  // Byte distribution in section D
  const hist = new Array(256).fill(0)
  for (let i = ac11Base + offD; i < ac11Base + sectionSize && i < data.length; i++) hist[data[i]]++
  const topBytes = hist.map((c: number, b: number) => ({ b, c })).sort((a: {b:number,c:number}, b: {b:number,c:number}) => b.c - a.c).slice(0, 10)
  const totalBytes = sectionDSize
  console.log(`  Byte distribution: ${topBytes.map((x: {b:number,c:number}) => `0x${x.b.toString(16).padStart(2, '0')}:${(x.c / totalBytes * 100).toFixed(1)}%`).join(' ')}`)

  // Entropy
  let entropy = 0
  for (let i = 0; i < 256; i++) {
    if (hist[i] === 0) continue
    const p = hist[i] / totalBytes
    entropy -= p * Math.log2(p)
  }
  console.log(`  Entropy: ${entropy.toFixed(3)} bits/byte`)

  // ---- Now try to understand the actual track structure ----
  // Let me look at the pre-section-A data more carefully

  // Hypothesis: the data between +0x54 and sectionA is organized as:
  // First part: per-frame cumulative byte offsets into section D
  // The monotonically increasing values with consistent deltas suggest this

  // Let's check: is there a structure between the frame offsets and section A?
  // The frame offsets seem to be: one entry per ?

  // Let's look at the counts more carefully
  const totalTracksAnimated = f24 // from +0x24
  const totalTracksConst = f34 + f38 // from +0x34, +0x38

  console.log(`\n--- Track Count Analysis ---`)
  console.log(`  +0x20 (f20): ${f20}`)
  console.log(`  +0x24 (f24): ${f24}`)
  console.log(`  +0x28 (f28): ${f28}`)
  console.log(`  +0x2C (f2c): ${f2c}`)
  console.log(`  +0x34 (f34): ${f34}`)
  console.log(`  +0x38 (f38): ${f38}`)
  console.log(`  sum(f24+f28+f2c): ${f24 + f28 + f2c}`)
  console.log(`  sum(f34+f38): ${f34 + f38}`)

  // Let's look at the pre-section-A values and see if they relate to frames
  console.log(`\n--- Pre-Section-A Analysis ---`)
  const preAStart = ac11Base + 0x54
  const preAEnd = ac11Base + offA

  // Count how many non-0xFFFFFFFF values there are
  let numPreAValues = 0
  let lastNonFF = -1
  for (let off = preAStart; off < preAEnd; off += 4) {
    const v = u32(view, off)
    if (v !== 0xffffffff) {
      numPreAValues++
      lastNonFF = off
    }
  }
  console.log(`  Total values: ${(preAEnd - preAStart) / 4}`)
  console.log(`  Non-0xFFFFFFFF: ${numPreAValues}`)

  // Split by 0xFFFFFFFF boundaries
  let groups: number[][] = [[]]
  for (let off = preAStart; off < preAEnd; off += 4) {
    const v = u32(view, off)
    if (v === 0xffffffff) {
      if (groups[groups.length - 1].length > 0) groups.push([])
    } else {
      groups[groups.length - 1].push(v)
    }
  }
  groups = groups.filter(g => g.length > 0)

  console.log(`  Groups separated by 0xFFFFFFFF: ${groups.length}`)
  for (let gi = 0; gi < groups.length; gi++) {
    const g = groups[gi]
    console.log(`    Group ${gi}: ${g.length} values`)
    if (g.length <= 30) {
      console.log(`      [${g.join(', ')}]`)
    } else {
      console.log(`      [${g.slice(0, 15).join(', ')}, ... ${g.slice(-5).join(', ')}]`)
    }
    // Check deltas
    if (g.length > 1) {
      const deltas: number[] = []
      for (let i = 1; i < g.length; i++) deltas.push(g[i] - g[i - 1])
      const minD = Math.min(...deltas)
      const maxD = Math.max(...deltas)
      const avgD = deltas.reduce((a, b) => a + b, 0) / deltas.length
      console.log(`      Deltas: min=${minD} max=${maxD} avg=${avgD.toFixed(1)}`)
    }
  }

  // ---- Understand how track descriptors relate to sections B, C, D ----
  // Let's look at what the section A values point to
  console.log(`\n--- Section A -> Section Mapping ---`)
  // The 16-byte records in section A have 4 fields each.
  // Hypothesis: field[0] = offset into section D, field[1..3] = counts
  if (sectionASize % 16 === 0) {
    const numRecords = sectionASize / 16
    console.log(`  ${numRecords} records of 16 bytes each:`)
    for (let i = 0; i < numRecords; i++) {
      const base = ac11Base + offA + i * 16
      const f0 = u32(view, base)
      const f1 = u32(view, base + 4)
      const f2 = u32(view, base + 8)
      const f3 = u32(view, base + 12)
      const sum123 = f1 + f2 + f3
      console.log(`    [${i}] offset=0x${f0.toString(16)} counts: ${f1}, ${f2}, ${f3} (sum=${sum123})`)
    }

    // Check if f0 values are monotonically increasing (offsets into section D)
    let mono = true
    for (let i = 1; i < numRecords; i++) {
      const prev = u32(view, ac11Base + offA + (i - 1) * 16)
      const curr = u32(view, ac11Base + offA + i * 16)
      if (curr < prev) { mono = false; break }
    }
    console.log(`    First field monotonic: ${mono}`)

    // Check if the last record's offset + its data = section D size
    if (numRecords > 0) {
      const lastOff = u32(view, ac11Base + offA + (numRecords - 1) * 16)
      console.log(`    Last record offset: 0x${lastOff.toString(16)}, sectionD ends at: 0x${sectionSize.toString(16)}`)
    }

    // Check if counts relate to the number of unique values in sections B and C
    let totalF1 = 0, totalF2 = 0, totalF3 = 0
    for (let i = 0; i < numRecords; i++) {
      const base = ac11Base + offA + i * 16
      totalF1 += u32(view, base + 4)
      totalF2 += u32(view, base + 8)
      totalF3 += u32(view, base + 12)
    }
    console.log(`    Total f1=${totalF1}, f2=${totalF2}, f3=${totalF3}`)
    console.log(`    sectionB floats: ${sectionBFloats} (f1 total * 4? = ${totalF1 * 4})`)
    console.log(`    sectionC floats: ${sectionCFloats}`)
  }

  // ---- Look for the relationship between section B and the track descriptors ----
  // Theory: Section B contains a bone mapping / 2-bit type codes
  // Section C contains float32 rotation/position/scale palettes
  // Section D contains the per-frame bitstream

  // Let's check if section C looks like it could contain the palette values
  console.log(`\n--- Section C detailed analysis ---`)
  if (sectionCFloats > 0) {
    // Count how many are in rotation range (-1..1), position range, scale range
    let rotCount = 0, scaleCount = 0, posCount = 0
    for (let i = 0; i < sectionCFloats; i++) {
      const v = f32(view, ac11Base + offC + i * 4)
      if (Math.abs(v - 0.1) < 0.001) scaleCount++
      else if (v >= -1.01 && v <= 1.01) rotCount++
      else posCount++
    }
    console.log(`  Rotation-range (-1..1): ${rotCount}`)
    console.log(`  Scale-range (0.1): ${scaleCount}`)
    console.log(`  Position-range (other): ${posCount}`)

    // If there are scale values = 0.1, they must be at the end
    // Count consecutive 0.1 values from the end
    let trailing01 = 0
    for (let i = sectionCFloats - 1; i >= 0; i--) {
      const v = f32(view, ac11Base + offC + i * 4)
      if (Math.abs(v - 0.1) < 0.001) trailing01++
      else break
    }
    console.log(`  Trailing 0.1 values: ${trailing01}`)

    // Check if rotation-like values form valid quaternion components
    // If palette, the values should be unique
    const uniqueVals = new Set<number>()
    for (let i = 0; i < sectionCFloats; i++) {
      uniqueVals.add(f32(view, ac11Base + offC + i * 4))
    }
    console.log(`  Unique float values: ${uniqueVals.size} out of ${sectionCFloats}`)
  }

  // ---- Try to understand section B as a track type map ----
  console.log(`\n--- Section B as track type map ---`)
  if (sectionBSize > 0) {
    // Theory: section B tells us which palette entries correspond to which bones
    // Could be 2 bits per bone (type: const rotation, animated rotation, etc)
    // Or could be byte array

    // Check as byte array
    const bytes: number[] = []
    for (let i = 0; i < sectionBSize; i++) bytes.push(data[ac11Base + offB + i])
    const uniqueBytes = new Set(bytes)
    console.log(`  ${sectionBSize} bytes, ${uniqueBytes.size} unique values`)
    console.log(`  Values: [${bytes.slice(0, 60).map(b => b.toString(16).padStart(2, '0')).join(' ')}${sectionBSize > 60 ? ' ...' : ''}]`)

    // If section B is very small (just a few bytes), it might be packed 2-bit track types
    if (sectionBSize < 32) {
      console.log(`\n  As 2-bit packed values:`)
      const twobit: number[] = []
      for (let i = 0; i < sectionBSize; i++) {
        for (let b = 0; b < 4; b++) {
          twobit.push((bytes[i] >> (b * 2)) & 3)
        }
      }
      console.log(`    ${twobit.length} values: [${twobit.slice(0, boneCount * 3).join(', ')}]`)
      // Count by value
      const counts = [0, 0, 0, 0]
      for (const v of twobit.slice(0, boneCount * 3)) counts[v]++
      console.log(`    Distribution: 0=${counts[0]} 1=${counts[1]} 2=${counts[2]} 3=${counts[3]}`)
    }
  }

  console.log()
}

console.log('\nDone.')
