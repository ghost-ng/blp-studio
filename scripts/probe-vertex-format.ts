#!/usr/bin/env npx tsx
/**
 * Probe exact vertex format for compressed mesh buffers.
 * Tests float16×3 positions and various normal encodings.
 *
 * Usage: npx tsx scripts/probe-vertex-format.ts <file.blp>
 */

import { resolve, basename } from 'path'
import { BLPParser } from '../src/core/blp-parser'
import { readCivbig } from '../src/core/civbig'
import { OodleDecompressor } from '../src/core/oodle'
import { findOodleCandidates, findAllSharedData, findGameRootFromPath, findSharedDataCandidates, buildSharedDataIndex } from '../src/core/game-detect'

function f16(u16: number): number {
  const sign = (u16 >> 15) & 1
  const exp = (u16 >> 10) & 0x1f
  const mant = u16 & 0x3ff
  if (exp === 0) return (sign ? -1 : 1) * (mant / 1024) * Math.pow(2, -14)
  if (exp === 31) return mant === 0 ? (sign ? -Infinity : Infinity) : NaN
  return (sign ? -1 : 1) * Math.pow(2, exp - 15) * (1 + mant / 1024)
}

const [, , blpPath] = process.argv
if (!blpPath) { console.error('Usage: npx tsx scripts/probe-vertex-format.ts <file.blp>'); process.exit(1) }

const filepath = resolve(blpPath)
const parser = new BLPParser(filepath)
parser.parse()

const gameRoot = findGameRootFromPath(filepath)
let sdDirs = gameRoot ? findAllSharedData(gameRoot) : []
if (sdDirs.length === 0) {
  for (const d of findSharedDataCandidates()) if (!sdDirs.includes(d)) sdDirs.push(d)
}
const sdIndex = buildSharedDataIndex(sdDirs)

let oodle: OodleDecompressor | null = null
for (const p of findOodleCandidates()) { try { oodle = new OodleDecompressor(p); break } catch { /* */ } }

console.log(`Shared data: ${sdIndex.size} files, Oodle: ${oodle ? 'loaded' : 'NOT FOUND'}\n`)

// Find a geometry component with deformers (skinned mesh — more interesting)
let targetGeom: Record<string, unknown> | null = null
let targetIdx = -1
for (const alloc of parser.iterEntriesByType('AssetPackage_GeometryComponent6')) {
  targetIdx++
  const obj = parser.deserializeAlloc(alloc)
  const deformers = obj.m_Deformers as any[]
  if (deformers && deformers.length > 0) {
    targetGeom = obj
    break
  }
}

if (!targetGeom) {
  // Fallback to first geometry
  targetIdx = 0
  for (const alloc of parser.iterEntriesByType('AssetPackage_GeometryComponent6')) {
    targetGeom = parser.deserializeAlloc(alloc)
    break
  }
}

if (!targetGeom) { console.log('No geometry found'); process.exit(0) }

const lods = targetGeom.m_MeshLods as any[]
if (!lods || lods.length === 0) { console.log('No mesh LODs'); process.exit(0) }

// Take the first LOD
const lod = lods[0]
const vb = lod.pVB as Record<string, unknown>
const ib = lod.pIB as Record<string, unknown>
const vbName = vb?.m_Name as string
const vbSize = (vb?.m_nSize as number) || 0
const stride = lod.nVertexStride as number
const vertOff = (lod.nVertexOffset as number) || 0
const minIdx = (lod.nMinIndex as number) || 0
const maxIdx = (lod.nMaxIndex as number) || 0
const vertCount = maxIdx - minIdx + 1
const primCount = (lod.nPrimitiveCount as number) || 0
const idxStart = (lod.nIndexStart as number) || 0
const idxStride = (lod.nIndexStride as number) || 4
const comp = (lod.eVertexComponents as number) || 0
const compression = (lod.eCompression as number) || 0

console.log(`Geometry Component #${targetIdx}`)
console.log(`LOD 0: VB="${vbName}" stride=${stride} compression=${compression} components=0x${comp.toString(16)}`)
console.log(`  vertOff=${vertOff} minIdx=${minIdx} maxIdx=${maxIdx} vertCount=${vertCount}`)
console.log(`  primCount=${primCount} idxStart=${idxStart} idxStride=${idxStride}`)

// Load VB data
const vbPath = sdIndex.get(vbName)
if (!vbPath) { console.log('VB not found in SHARED_DATA'); process.exit(0) }

const { data: rawData } = readCivbig(vbPath)
let data: Buffer
if (OodleDecompressor.isOodleCompressed(rawData) && oodle) {
  const d = oodle.decompress(rawData, vbSize || rawData.length * 4)
  data = d || rawData
} else {
  data = rawData
}

console.log(`Buffer size: ${data.length} bytes\n`)
const dv = new DataView(data.buffer, data.byteOffset, data.byteLength)

// ---- Test float16×3 positions at offset 0 ----
console.log('=== float16×3 positions at +0 ===')
for (let v = 0; v < Math.min(10, vertCount); v++) {
  const off = vertOff + v * stride
  const x = f16(dv.getUint16(off, true))
  const y = f16(dv.getUint16(off + 2, true))
  const z = f16(dv.getUint16(off + 4, true))
  const w = dv.getUint16(off + 6, true)
  console.log(`  [${v}] pos=(${x.toFixed(4)}, ${y.toFixed(4)}, ${z.toFixed(4)}) w=0x${w.toString(16)}`)
}

// ---- Test packed normal at +8 ----
console.log('\n=== Normal at +8 (4 bytes) ===')
console.log('  Testing uint8×4 with (val - 128)/127 mapping:')
for (let v = 0; v < Math.min(10, vertCount); v++) {
  const off = vertOff + v * stride + 8
  const a = data[off], b = data[off + 1], c = data[off + 2], d2 = data[off + 3]
  const nx = (a - 128) / 127
  const ny = (b - 128) / 127
  const nz = (c - 128) / 127
  const nw = (d2 - 128) / 127
  const mag = Math.sqrt(nx * nx + ny * ny + nz * nz)
  console.log(`  [${v}] raw=(${a}, ${b}, ${c}, ${d2}) → (${nx.toFixed(4)}, ${ny.toFixed(4)}, ${nz.toFixed(4)}, w=${nw.toFixed(4)}) mag=${mag.toFixed(4)}`)
}

console.log('\n  Testing uint8×4 with val/255*2-1 mapping:')
for (let v = 0; v < Math.min(10, vertCount); v++) {
  const off = vertOff + v * stride + 8
  const a = data[off], b = data[off + 1], c = data[off + 2], d2 = data[off + 3]
  const nx = a / 255 * 2 - 1
  const ny = b / 255 * 2 - 1
  const nz = c / 255 * 2 - 1
  const nw = d2 / 255 * 2 - 1
  const mag = Math.sqrt(nx * nx + ny * ny + nz * nz)
  console.log(`  [${v}] raw=(${a}, ${b}, ${c}, ${d2}) → (${nx.toFixed(4)}, ${ny.toFixed(4)}, ${nz.toFixed(4)}, w=${nw.toFixed(4)}) mag=${mag.toFixed(4)}`)
}

console.log('\n  Testing as SNORM16×2 (xy, derive z) at +8:')
for (let v = 0; v < Math.min(10, vertCount); v++) {
  const off = vertOff + v * stride + 8
  const rawX = dv.getInt16(off, true)
  const rawY = dv.getInt16(off + 2, true)
  const nx = rawX / 32767
  const ny = rawY / 32767
  const nzSq = 1 - nx * nx - ny * ny
  const nz = nzSq > 0 ? Math.sqrt(nzSq) : 0
  console.log(`  [${v}] snorm16=(${rawX}, ${rawY}) → (${nx.toFixed(4)}, ${ny.toFixed(4)}, ±${nz.toFixed(4)})`)
}

// ---- Test UVs at +12 ----
console.log('\n=== float16×2 UV at +12 ===')
for (let v = 0; v < Math.min(10, vertCount); v++) {
  const off = vertOff + v * stride + 12
  const u = f16(dv.getUint16(off, true))
  const vv = f16(dv.getUint16(off + 2, true))
  console.log(`  [${v}] uv=(${u.toFixed(6)}, ${vv.toFixed(6)})`)
}

// ---- If stride >= 28 (has bone data), test bone indices/weights at +16/+20 ----
if (stride >= 28) {
  console.log('\n=== uint8×4 bone indices at +16 ===')
  for (let v = 0; v < Math.min(10, vertCount); v++) {
    const off = vertOff + v * stride + 16
    console.log(`  [${v}] (${data[off]}, ${data[off + 1]}, ${data[off + 2]}, ${data[off + 3]})`)
  }

  console.log('\n=== uint8×4 bone weights at +20 ===')
  for (let v = 0; v < Math.min(10, vertCount); v++) {
    const off = vertOff + v * stride + 20
    const sum = data[off] + data[off + 1] + data[off + 2] + data[off + 3]
    console.log(`  [${v}] (${data[off]}, ${data[off + 1]}, ${data[off + 2]}, ${data[off + 3]}) sum=${sum}`)
  }

  console.log('\n=== float16×2 at +24 (UV2?) ===')
  for (let v = 0; v < Math.min(10, vertCount); v++) {
    const off = vertOff + v * stride + 24
    const u = f16(dv.getUint16(off, true))
    const vv = f16(dv.getUint16(off + 2, true))
    console.log(`  [${v}] (${u.toFixed(6)}, ${vv.toFixed(6)})`)
  }
}

// ---- Verify index buffer ----
console.log('\n=== Index buffer ===')
const ibStart = idxStart * idxStride
console.log(`Index section at byte ${ibStart} (idxStart=${idxStart} × idxStride=${idxStride})`)
console.log(`First 30 indices:`)
const indices: number[] = []
for (let i = 0; i < Math.min(30, primCount * 3); i++) {
  const off = ibStart + i * idxStride
  if (off + idxStride <= data.length) {
    indices.push(idxStride === 2 ? dv.getUint16(off, true) : dv.getUint32(off, true))
  }
}
console.log(`  ${indices.join(', ')}`)

// Verify: all indices should be in [minIdx, maxIdx]
let outOfRange = 0
for (let i = 0; i < primCount * 3; i++) {
  const off = ibStart + i * idxStride
  if (off + idxStride > data.length) break
  const idx = idxStride === 2 ? dv.getUint16(off, true) : dv.getUint32(off, true)
  if (idx < minIdx || idx > maxIdx) outOfRange++
}
console.log(`Out-of-range indices: ${outOfRange}/${primCount * 3}`)

// ---- Buffer layout verification ----
console.log('\n=== Buffer layout ===')
// Check if all LOD vertex data ends exactly where index section begins
const allLods = lods as any[]
let maxVertEnd = 0
let minIdxByte = Infinity
for (const l of allLods) {
  const vo = (l.nVertexOffset as number) || 0
  const vs = (l.nVertexStride as number) || 0
  const mi = (l.nMaxIndex as number) || 0
  const vertEnd = vo + (mi + 1) * vs
  if (vertEnd > maxVertEnd) maxVertEnd = vertEnd

  const is = (l.nIndexStart as number) || 0
  const iStride = (l.nIndexStride as number) || 4
  const idxByte = is * iStride
  if (idxByte < minIdxByte) minIdxByte = idxByte
}
console.log(`Max vertex data end: ${maxVertEnd}`)
console.log(`Min index data start: ${minIdxByte}`)
console.log(`Gap: ${minIdxByte - maxVertEnd} bytes`)
console.log(`Buffer total: ${data.length}`)

// Check if last index lines up with buffer end
let maxIdxEnd = 0
for (const l of allLods) {
  const is = (l.nIndexStart as number) || 0
  const iStride = (l.nIndexStride as number) || 4
  const pc = (l.nPrimitiveCount as number) || 0
  const idxEnd = (is + pc * 3) * iStride
  if (idxEnd > maxIdxEnd) maxIdxEnd = idxEnd
}
console.log(`Max index data end: ${maxIdxEnd}`)
console.log(`Match buffer size: ${maxIdxEnd === data.length ? 'YES' : 'NO (diff=' + (data.length - maxIdxEnd) + ')'}`)
