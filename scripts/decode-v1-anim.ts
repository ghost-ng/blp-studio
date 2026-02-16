#!/usr/bin/env npx tsx
/**
 * Targeted V1 (AC11) animation format decoder.
 * Works on extracted .anim files directly.
 *
 * Usage: npx tsx scripts/decode-v1-anim.ts <dir-of-anim-files>
 */

import { readFileSync, readdirSync, statSync } from 'fs'
import { resolve, join } from 'path'

const u32 = (v: DataView, o: number) => v.getUint32(o, true)
const i32 = (v: DataView, o: number) => v.getInt32(o, true)
const u16 = (v: DataView, o: number) => v.getUint16(o, true)
const i16 = (v: DataView, o: number) => v.getInt16(o, true)
const f32 = (v: DataView, o: number) => v.getFloat32(o, true)
const u8 = (d: Uint8Array, o: number) => d[o]

function hex(v: number, pad = 8) { return '0x' + v.toString(16).padStart(pad, '0').toUpperCase() }

function hexdump(data: Uint8Array, startOff: number, len: number) {
  const end = Math.min(startOff + len, data.length)
  for (let off = startOff; off < end; off += 16) {
    const slice = data.subarray(off, Math.min(off + 16, end))
    const hexParts: string[] = []
    for (let i = 0; i < 16; i++) hexParts.push(i < slice.length ? slice[i].toString(16).padStart(2, '0') : '  ')
    let ascii = ''
    for (const b of slice) ascii += b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : '.'
    console.log(`  ${off.toString(16).padStart(6, '0')}  ${hexParts.slice(0, 8).join(' ')}  ${hexParts.slice(8).join(' ')}  |${ascii}|`)
  }
}

const ANIM_MAGIC = 0x6AB06AB0
const AC11_MAGIC = 0xAC11AC11

interface AnimFile {
  name: string
  data: Buffer
  isV0: boolean
  boneCount: number
  frameCount: number
}

function loadAnimFiles(dir: string): AnimFile[] {
  const files: AnimFile[] = []
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.anim')) continue
    const path = join(dir, f)
    try {
      const data = readFileSync(path)
      if (data.length < 96) continue
      const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
      if (u32(view, 0) !== ANIM_MAGIC) continue
      const dataOff48 = u32(view, 0x48)
      const isV0 = dataOff48 === 0xFFFFFFFF
      const boneField = u32(view, 0x10)
      const boneCount = isV0 ? boneField : (boneField & 0xFFFF)
      const frameCount = u32(view, 0x0C)
      files.push({ name: f, data, isV0, boneCount, frameCount })
    } catch {}
  }
  return files
}

function analyzeV1(data: Buffer, name: string) {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const arr = new Uint8Array(data.buffer, data.byteOffset, data.byteLength)

  console.log(`\n${'='.repeat(80)}`)
  console.log(`DEEP ANALYSIS: ${name} (${data.length} bytes)`)
  console.log(`${'='.repeat(80)}`)

  // Outer header
  const fps = f32(view, 0x08)
  const frameCount = u32(view, 0x0C)
  const boneField = u32(view, 0x10)
  const boneCount = boneField & 0xFFFF
  const boneHi = (boneField >> 16) & 0xFFFF
  const dataRegionSize28 = u32(view, 0x28)
  const outerCount30 = u32(view, 0x30)
  const dataStart48 = u32(view, 0x48) // should be 0x60
  const nameOff = u32(view, 0x50)

  let animName = ''
  if (nameOff > 0 && nameOff < data.length) {
    const end = arr.indexOf(0, nameOff)
    if (end > nameOff) animName = String.fromCharCode(...arr.subarray(nameOff, Math.min(end, nameOff + 128)))
  }

  console.log(`\nOUTER HEADER:`)
  console.log(`  fps=${fps}, frames=${frameCount}, bones=${boneCount} (hi=${boneHi})`)
  console.log(`  dataRegionSize(0x28): ${dataRegionSize28}`)
  console.log(`  outerCount(0x30): ${outerCount30}`)
  console.log(`  dataStart(0x48): ${hex(dataStart48)}`)
  console.log(`  nameOff(0x50): ${hex(nameOff)}`)
  console.log(`  name: "${animName}"`)

  // Full header hex
  console.log(`\n  Full header (0x00-0x5F):`)
  hexdump(arr, 0, 96)

  // AC11 sub-header at 0x60
  const AC = 0x60
  const ac11DataSize = u32(view, AC)
  const ac11Hash = u32(view, AC + 4)
  const ac11Magic = u32(view, AC + 8)
  const ac11Version = u32(view, AC + 12)
  const ac11BoneCount = u32(view, AC + 16)
  const ac11LastFrame = u32(view, AC + 20)
  const ac11Fps = f32(view, AC + 24)
  const field_7C = u32(view, AC + 28)
  const count1 = u32(view, AC + 32)   // 0x80
  const count2 = u32(view, AC + 36)   // 0x84
  const count3 = u32(view, AC + 40)   // 0x88
  const count4 = u32(view, AC + 44)   // 0x8C
  const zero_90 = u32(view, AC + 48)  // 0x90
  const count5 = u32(view, AC + 52)   // 0x94
  const count6 = u32(view, AC + 56)   // 0x98
  const boneCount2 = u32(view, AC + 60) // 0x9C

  console.log(`\nAC11 SUB-HEADER (0x60-0x9F):`)
  hexdump(arr, 0x60, 64)
  console.log(`  dataSize: ${ac11DataSize}`)
  console.log(`  hash: ${hex(ac11Hash)}`)
  console.log(`  magic: ${hex(ac11Magic)} ${ac11Magic === AC11_MAGIC ? '✓' : '✗'}`)
  console.log(`  version: ${hex(ac11Version)}`)
  console.log(`  boneCount: ${ac11BoneCount}`)
  console.log(`  lastFrame: ${ac11LastFrame}`)
  console.log(`  fps: ${ac11Fps}`)
  console.log(`  field_7C: ${hex(field_7C)} (${field_7C})`)
  console.log(`  count1: ${count1}  count2: ${count2}  count3: ${count3}  count4: ${count4}`)
  console.log(`  zero_90: ${zero_90}`)
  console.log(`  count5: ${count5}  count6: ${count6}`)
  console.log(`  boneCount2: ${boneCount2}`)
  console.log(`  count1+count5+count6 = ${count1 + count5 + count6} vs bones=${ac11BoneCount}`)

  // Sentinel + section offsets
  const sentinel = u32(view, 0xA0)
  const secOff = [u32(view, 0xA4), u32(view, 0xA8), u32(view, 0xAC), u32(view, 0xB0)]
  console.log(`\nSENTINEL + OFFSETS (0xA0-0xB3):`)
  console.log(`  sentinel: ${hex(sentinel)}`)
  for (let i = 0; i < 4; i++) {
    console.log(`  secOff[${i}]: ${secOff[i]} (abs: ${hex(secOff[i] + AC)})`)
  }
  console.log(`  sec[1]-sec[0] = ${secOff[1] - secOff[0]} = count1*16? ${count1 * 16} ${(secOff[1] - secOff[0]) === count1 * 16 ? '✓' : '✗'}`)
  console.log(`  sec[2]-sec[1] = ${secOff[2] - secOff[1]}`)
  console.log(`  sec[3]-sec[2] = ${secOff[3] - secOff[2]}`)
  const endOff = ac11DataSize
  console.log(`  end-sec[3]   = ${endOff - secOff[3]}`)

  // Track offset table at 0xB4
  console.log(`\nTRACK OFFSET TABLE (0xB4+):`)
  const trackOffsets: number[] = []
  let off = 0xB4
  for (let i = 0; i < 300 && off + 4 <= data.length; i++) {
    const val = u32(view, off)
    if (val === 0xFFFFFFFF) {
      console.log(`  [${i}]: SENTINEL`)
      off += 4
      break
    }
    trackOffsets.push(val)
    if (i < 30) console.log(`  [${i}]: ${val}`)
    off += 4
  }
  if (trackOffsets.length > 30) console.log(`  ... (${trackOffsets.length} total)`)
  const tableEnd = off
  console.log(`  Count: ${trackOffsets.length}, tableEnd: ${hex(tableEnd)}`)

  // Track offset diffs
  if (trackOffsets.length > 1 && trackOffsets.length <= 50) {
    const diffs: number[] = []
    for (let i = 1; i < trackOffsets.length; i++) diffs.push(trackOffsets[i] - trackOffsets[i - 1])
    console.log(`  Track diffs: [${diffs.join(', ')}]`)
    // Check if diffs match some pattern with frameCount
    const uniqueDiffs = [...new Set(diffs)]
    console.log(`  Unique diffs: [${uniqueDiffs.join(', ')}]`)
    for (const d of uniqueDiffs) {
      console.log(`    ${d} / frames(${frameCount}) = ${(d / frameCount).toFixed(4)}`)
      console.log(`    ${d} / (frames-1)(${frameCount - 1}) = ${(d / (frameCount - 1)).toFixed(4)}`)
    }
  }

  // Post-table region: between tableEnd and section[0] abs
  const sec0Abs = secOff[0] + AC
  const postTableSize = sec0Abs - tableEnd
  console.log(`\nPOST-TABLE DATA (${hex(tableEnd)} to ${hex(sec0Abs)}): ${postTableSize} bytes`)
  if (postTableSize > 0 && postTableSize <= 512) {
    // Try as uint32 and float32
    for (let i = tableEnd; i < sec0Abs && i + 4 <= data.length; i += 4) {
      const val = u32(view, i)
      const fval = f32(view, i)
      const isValid = isFinite(fval) && Math.abs(fval) < 1e6
      console.log(`  ${hex(i)}: ${val} (${hex(val)}) ${isValid ? `f32=${fval.toFixed(6)}` : ''}`)
    }
  } else if (postTableSize > 0) {
    hexdump(arr, tableEnd, Math.min(postTableSize, 128))
  }

  // SECTION 0: count1 * 16 bytes
  const sec0Size = secOff[1] - secOff[0]
  const sec1Abs = secOff[1] + AC
  console.log(`\nSECTION 0 (${hex(sec0Abs)} to ${hex(sec1Abs)}): ${sec0Size} bytes = ${count1}*16`)
  for (let i = 0; i < count1 && i < 20; i++) {
    const base = sec0Abs + i * 16
    if (base + 16 > data.length) break
    const f = [f32(view, base), f32(view, base + 4), f32(view, base + 8), f32(view, base + 12)]
    const mag = Math.sqrt(f[0] ** 2 + f[1] ** 2 + f[2] ** 2 + f[3] ** 2)
    const isQuat = Math.abs(mag - 1.0) < 0.05
    console.log(`  [${i}]: ${f.map(v => v.toFixed(6)).join(', ')} mag=${mag.toFixed(6)}${isQuat ? ' ← QUAT' : ''}`)
  }

  // SECTION 1
  const sec2Abs = secOff[2] + AC
  const sec1Size = secOff[2] - secOff[1]
  console.log(`\nSECTION 1 (${hex(sec1Abs)} to ${hex(sec2Abs)}): ${sec1Size} bytes`)

  // Check 2-bit pattern interpretation
  const sec1Data = arr.subarray(sec1Abs, sec2Abs)
  if (sec1Size > 0) {
    // Read as 2-bit fields
    const bits2: number[] = []
    for (let i = 0; i < sec1Data.length; i++) {
      const b = sec1Data[i]
      bits2.push((b >> 6) & 3, (b >> 4) & 3, (b >> 2) & 3, b & 3)
    }
    const counts2 = [0, 0, 0, 0]
    for (const b of bits2) counts2[b]++
    console.log(`  2-bit distribution: 0=${counts2[0]}, 1=${counts2[1]}, 2=${counts2[2]}, 3=${counts2[3]}`)
    console.log(`  Total 2-bit values: ${bits2.length}`)
    console.log(`  First 80 values: ${bits2.slice(0, 80).join('')}`)

    // Try interpreting as per-bone channel flags (10 channels: 4 rot + 3 pos + 3 scale)
    const channelsPerBone = 10
    const bonesFromBits = Math.floor(bits2.length / channelsPerBone)
    console.log(`  If 10 channels/bone: fits ${bonesFromBits} bones (vs ${ac11BoneCount})`)

    // Try 7 channels (3 rot + 3 pos + 1 scale) or other groupings
    for (const cpb of [3, 4, 7, 10, 13]) {
      const nb = Math.floor(bits2.length / cpb)
      if (nb === ac11BoneCount || nb === ac11BoneCount + 1) {
        console.log(`  *** ${cpb} channels/bone → ${nb} bones ← MATCH!`)
        // Decode per-bone flags
        for (let b = 0; b < Math.min(nb, 10); b++) {
          const flags = bits2.slice(b * cpb, (b + 1) * cpb)
          console.log(`    bone[${b}]: [${flags.join(',')}]`)
        }
      }
    }

    // What about per-track? count1 tracks * something
    console.log(`  If per-track: ${bits2.length / count1} values/track`)

    hexdump(arr, sec1Abs, Math.min(sec1Size, 64))
  }

  // SECTION 2
  const sec3Abs = secOff[3] + AC
  const sec2Size = secOff[3] - secOff[2]
  console.log(`\nSECTION 2 (${hex(sec2Abs)} to ${hex(sec3Abs)}): ${sec2Size} bytes`)
  if (sec2Size > 0) {
    // Try as float32
    console.log(`  As float32:`)
    const nfloats = Math.floor(sec2Size / 4)
    for (let i = 0; i < Math.min(nfloats, 20); i++) {
      const val = f32(view, sec2Abs + i * 4)
      console.log(`    [${i}]: ${val.toFixed(6)} (${hex(u32(view, sec2Abs + i * 4))})`)
    }
    if (nfloats > 20) console.log(`    ... (${nfloats} total floats)`)
  }

  // SECTION 3 (to end of AC11 data)
  const dataEnd = AC + ac11DataSize
  const sec3Size = ac11DataSize - secOff[3]
  console.log(`\nSECTION 3 (${hex(sec3Abs)} to ${hex(dataEnd)}): ${sec3Size} bytes`)
  if (sec3Size > 0) {
    console.log(`  As float32 (first 20):`)
    const nfloats = Math.floor(sec3Size / 4)
    for (let i = 0; i < Math.min(nfloats, 20); i++) {
      const val = f32(view, sec3Abs + i * 4)
      console.log(`    [${i}]: ${val.toFixed(6)} (${hex(u32(view, sec3Abs + i * 4))})`)
    }
    if (nfloats > 20) console.log(`    ... (${nfloats} total floats)`)

    // Try as u16 pairs (compressed keyframe data?)
    console.log(`  As u16 (first 40):`)
    const nu16 = Math.floor(sec3Size / 2)
    for (let i = 0; i < Math.min(nu16, 40); i++) {
      const val = u16(view, sec3Abs + i * 2)
      const sval = i16(view, sec3Abs + i * 2)
      console.log(`    [${i}]: ${val} (${hex(val, 4)}) signed=${sval} norm=${(sval / 32767).toFixed(6)}`)
    }
  }

  // TAIL DATA (between AC11 data end and name string)
  if (nameOff > dataEnd) {
    const tailSize = nameOff - dataEnd
    console.log(`\nTAIL DATA (${hex(dataEnd)} to ${hex(nameOff)}): ${tailSize} bytes`)
    hexdump(arr, dataEnd, Math.min(tailSize, 128))
    // Try as float32
    if (tailSize >= 4) {
      console.log(`  As float32:`)
      for (let i = dataEnd; i + 4 <= nameOff; i += 4) {
        const val = f32(view, i)
        console.log(`    ${hex(i)}: ${val.toFixed(6)} (${hex(u32(view, i))})`)
      }
    }
  }

  // LAYOUT SUMMARY
  console.log(`\n--- LAYOUT ---`)
  console.log(`  0x00-0x5F: Outer header`)
  console.log(`  0x60-0x9F: AC11 header`)
  console.log(`  0xA0-0xA3: Sentinel`)
  console.log(`  0xA4-0xB3: Section offsets [4]`)
  console.log(`  0xB4-${hex(tableEnd - 1)}: Track offsets [${trackOffsets.length}]`)
  console.log(`  ${hex(tableEnd)}-${hex(sec0Abs - 1)}: Post-table (${postTableSize} bytes)`)
  console.log(`  ${hex(sec0Abs)}-${hex(sec1Abs - 1)}: Sec0 = ${sec0Size}B (count1*16 rotation refs?)`)
  console.log(`  ${hex(sec1Abs)}-${hex(sec2Abs - 1)}: Sec1 = ${sec1Size}B (bitflags?)`)
  console.log(`  ${hex(sec2Abs)}-${hex(sec3Abs - 1)}: Sec2 = ${sec2Size}B`)
  console.log(`  ${hex(sec3Abs)}-${hex(dataEnd - 1)}: Sec3 = ${sec3Size}B`)
  if (nameOff > dataEnd) console.log(`  ${hex(dataEnd)}-${hex(nameOff - 1)}: Tail = ${nameOff - dataEnd}B`)
  console.log(`  ${hex(nameOff)}: "${animName}"`)

  // KEY RELATIONSHIPS
  console.log(`\n--- RELATIONSHIPS ---`)
  // Track data per track
  if (trackOffsets.length >= 2) {
    for (let t = 0; t < Math.min(trackOffsets.length - 1, 10); t++) {
      const trackSize = trackOffsets[t + 1] - trackOffsets[t]
      const bytesPerFrame = trackSize / frameCount
      const bytesPerFrameM1 = trackSize / (frameCount - 1)
      console.log(`  track[${t}]: ${trackSize} bytes, /frames=${bytesPerFrame.toFixed(2)}, /(frames-1)=${bytesPerFrameM1.toFixed(2)}`)
    }
  }
  // Last track to some boundary
  if (trackOffsets.length > 0) {
    const lastTrackOff = trackOffsets[trackOffsets.length - 1]
    // What section does track data reference?
    console.log(`  Last track offset: ${lastTrackOff}`)
    console.log(`  secOff[0]-lastTrackOff: ${secOff[0] - lastTrackOff}`)
  }

  // What are the track offsets relative to?
  console.log(`\n  Track offsets relative to various bases:`)
  for (let i = 0; i < Math.min(trackOffsets.length, 5); i++) {
    console.log(`    track[${i}]: raw=${trackOffsets[i]}, +tableEnd=${hex(trackOffsets[i] + tableEnd)}, +sec0=${hex(trackOffsets[i] + sec0Abs)}, +AC=${hex(trackOffsets[i] + AC)}`)
  }
}

// MAIN
const dir = process.argv[2]
if (!dir) {
  console.error('Usage: npx tsx scripts/decode-v1-anim.ts <dir-of-anim-files>')
  process.exit(1)
}

const files = loadAnimFiles(resolve(dir))
const v0 = files.filter(f => f.isV0)
const v1 = files.filter(f => !f.isV0)
console.log(`Found ${v0.length} V0, ${v1.length} V1 animations in ${dir}`)

// Show V0 reference
if (v0.length > 0) {
  const ref = v0[0]
  const view = new DataView(ref.data.buffer, ref.data.byteOffset, ref.data.byteLength)
  console.log(`\nV0 Reference: ${ref.name} (${ref.boneCount} bones, ${ref.frameCount} frames)`)
  if (ref.data.length >= 0x60 + 40) {
    const b = 0x60
    console.log(`  Frame 0, Bone 0: q=[${f32(view, b)}, ${f32(view, b + 4)}, ${f32(view, b + 8)}, ${f32(view, b + 12)}]`)
    console.log(`                   p=[${f32(view, b + 16)}, ${f32(view, b + 20)}, ${f32(view, b + 24)}]`)
    console.log(`                   s=[${f32(view, b + 28)}, ${f32(view, b + 32)}, ${f32(view, b + 36)}]`)
  }
}

// Sort V1 by size and analyze small ones
const sorted = v1.sort((a, b) => a.data.length - b.data.length)
console.log(`\nV1 by size:`)
for (const a of sorted.slice(0, 20)) {
  console.log(`  ${a.name}: ${a.boneCount} bones, ${a.frameCount} frames, ${a.data.length} bytes`)
}

// Analyze V1 anims with 10+ bones (clear section separation)
const interesting = sorted.filter(a => a.boneCount >= 10 && a.boneCount <= 30 && a.frameCount >= 5)
console.log(`\nInteresting (10-30 bones, 5+ frames):`)
for (const a of interesting.slice(0, 10)) {
  console.log(`  ${a.name}: ${a.boneCount} bones, ${a.frameCount} frames, ${a.data.length} bytes`)
}
for (const a of interesting.slice(0, 1)) {
  analyzeV1(a.data, a.name)
}
