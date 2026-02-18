#!/usr/bin/env npx tsx
/**
 * Phase 0 Discovery: Mine BLP type registry and probe GPU buffer / mesh blob data.
 *
 * Usage: npx tsx scripts/discover-mesh.ts <file.blp>
 *
 * Outputs:
 *  - All type names in the BLP type registry (filtered for mesh-related)
 *  - All allocation type names (to find types we don't iterate)
 *  - Full deserialized fields for each GPU buffer entry
 *  - Blob type 11 (mesh) header analysis
 *  - GPU buffer stride grouping and vertex format probing
 */

import { readFileSync } from 'fs'
import { resolve, basename } from 'path'
import { BLPParser } from '../src/core/blp-parser'
import { readCivbig } from '../src/core/civbig'
import { OodleDecompressor } from '../src/core/oodle'
import { findOodleCandidates, findAllSharedData, findGameRootFromPath, findSharedDataCandidates, buildSharedDataIndex } from '../src/core/game-detect'

// ---- Hex dump utility ----
function hexdump(data: Buffer | Uint8Array, maxRows = 16, startOffset = 0): void {
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
      ascii += (b >= 0x20 && b <= 0x7e) ? String.fromCharCode(b) : '.'
    }
    console.log(
      `  ${(startOffset + off).toString(16).padStart(8, '0')}  ${hex.slice(0, 8).join(' ')}  ${hex.slice(8).join(' ')}  |${ascii}|`
    )
  }
}

// ---- Float16 decoder ----
function decodeFloat16(u16: number): number {
  const sign = (u16 >> 15) & 1
  const exp = (u16 >> 10) & 0x1f
  const mant = u16 & 0x3ff
  if (exp === 0) return (sign ? -1 : 1) * (mant / 1024) * Math.pow(2, -14)
  if (exp === 31) return mant === 0 ? (sign ? -Infinity : Infinity) : NaN
  return (sign ? -1 : 1) * Math.pow(2, exp - 15) * (1 + mant / 1024)
}

// ---- Setup ----
const [, , blpPath] = process.argv
if (!blpPath) {
  console.error('Usage: npx tsx scripts/discover-mesh.ts <file.blp>')
  process.exit(1)
}

const filepath = resolve(blpPath)
const parser = new BLPParser(filepath)
parser.parse()

const gameRoot = findGameRootFromPath(filepath)
let sdDirs = gameRoot ? findAllSharedData(gameRoot) : []
if (sdDirs.length === 0) {
  const steamDirs = findSharedDataCandidates()
  for (const d of steamDirs) {
    if (!sdDirs.includes(d)) sdDirs.push(d)
  }
}
const sdIndex = buildSharedDataIndex(sdDirs)

let oodle: OodleDecompressor | null = null
const oodleCandidates = findOodleCandidates()
for (const p of oodleCandidates) {
  try { oodle = new OodleDecompressor(p); break } catch { /* */ }
}

console.log(`\n${'='.repeat(70)}`)
console.log(`  MESH DISCOVERY: ${basename(filepath)}`)
console.log(`${'='.repeat(70)}`)
console.log(`Shared data: ${sdIndex.size} files, Oodle: ${oodle ? 'loaded' : 'NOT FOUND'}\n`)

// ============================================================================
// STEP 0a: Type Registry Dump
// ============================================================================
console.log(`\n${'='.repeat(70)}`)
console.log('  STEP 0a: TYPE REGISTRY')
console.log(`${'='.repeat(70)}\n`)

const reg = parser.typeRegistry
if (!reg) {
  console.log('No type registry found!')
} else {
  // All types
  console.log(`Total types: ${reg.types.size}`)
  console.log(`Total enums: ${reg.enums.size}\n`)

  // Mesh-related types
  const meshKeywords = ['Material', 'Geometry', 'Mesh', 'Model', 'Vertex', 'Buffer', 'Render', 'Shader', 'Attribute', 'Skin', 'Bone', 'Skeleton', 'Index', 'Primitive', 'Draw', 'Submesh', 'LOD', 'Morph']
  const meshTypes: string[] = []
  const otherTypes: string[] = []

  for (const [name, t] of reg.types) {
    const isMeshRelated = meshKeywords.some(k => name.toLowerCase().includes(k.toLowerCase()))
    if (isMeshRelated) {
      meshTypes.push(name)
    } else {
      otherTypes.push(name)
    }
  }

  console.log(`--- Mesh-related types (${meshTypes.length}) ---`)
  for (const name of meshTypes.sort()) {
    const t = reg.types.get(name)!
    console.log(`  ${name}  (v${t.version}, size=${t.size}, underlying=${t.underlyingType || 'none'})`)
    for (const f of t.fields) {
      console.log(`    .${f.name.padEnd(35)} type=${f.typeName.padEnd(25)} off=${f.address}`)
    }
  }

  console.log(`\n--- All other types (${otherTypes.length}) ---`)
  for (const name of otherTypes.sort()) {
    const t = reg.types.get(name)!
    console.log(`  ${name}  (v${t.version}, size=${t.size})`)
  }

  // Enumerate ALL allocation type names
  console.log(`\n--- All allocation type names (unique) ---`)
  const allocTypeCounts = new Map<string, number>()
  for (const alloc of parser.allocations) {
    const typeName = parser.resolveTypeName(alloc)
    allocTypeCounts.set(typeName, (allocTypeCounts.get(typeName) || 0) + 1)
  }
  for (const [typeName, count] of [...allocTypeCounts.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const known = ['BLP::TextureEntry', 'BLP::BlobEntry', 'BLP::GpuBufferEntry', 'BLP::SoundBankEntry'].includes(typeName)
    console.log(`  ${known ? '  ' : '* '}${typeName}: ${count} allocations${known ? '' : '  <-- NOT CURRENTLY ITERATED'}`)
  }

  // Enums
  if (reg.enums.size > 0) {
    console.log(`\n--- Enums ---`)
    for (const [name, e] of reg.enums) {
      const vals = e.constants.map(c => `${c.name}=${c.value}`).join(', ')
      console.log(`  ${name}: ${vals}`)
    }
  }
}

// ============================================================================
// STEP 0a (cont): Deserialize ALL fields for non-standard allocation types
// ============================================================================
console.log(`\n${'='.repeat(70)}`)
console.log('  STEP 0a (cont): NON-STANDARD ALLOCATIONS')
console.log(`${'='.repeat(70)}\n`)

const knownTypes = new Set(['BLP::TextureEntry', 'BLP::BlobEntry', 'BLP::GpuBufferEntry', 'BLP::SoundBankEntry'])
for (const alloc of parser.allocations) {
  const typeName = parser.resolveTypeName(alloc)
  if (knownTypes.has(typeName)) continue

  const obj = parser.deserializeAlloc(alloc)
  console.log(`[${typeName}] alloc #${alloc.index}:`)
  for (const [key, value] of Object.entries(obj)) {
    if (key === '_type') continue
    const displayValue = typeof value === 'string' && value.length > 100 ? value.substring(0, 100) + '...' : value
    console.log(`  .${key} = ${JSON.stringify(displayValue)}`)
  }
  console.log()
}

// ============================================================================
// STEP 0b: GPU Buffer Analysis
// ============================================================================
console.log(`\n${'='.repeat(70)}`)
console.log('  STEP 0b: GPU BUFFER ANALYSIS')
console.log(`${'='.repeat(70)}\n`)

interface GpuBufferInfo {
  name: string
  allFields: Record<string, unknown>
  bytesPerElement: number
  elementCount: number
  materialName: string
  size: number
}

const gpuBuffers: GpuBufferInfo[] = []

for (const alloc of parser.iterEntriesByType('BLP::GpuBufferEntry')) {
  const obj = parser.deserializeAlloc(alloc)
  gpuBuffers.push({
    name: obj.m_Name as string || '<unnamed>',
    allFields: obj,
    bytesPerElement: (obj.m_nBytesPerElement as number) || 0,
    elementCount: (obj.m_nElementCount as number) || 0,
    materialName: (obj.m_MaterialName as string) || '',
    size: (obj.m_nSize as number) || 0,
  })
}

console.log(`Total GPU buffers: ${gpuBuffers.length}\n`)

// Print ALL fields for each GPU buffer
console.log('--- Full GPU buffer fields ---')
for (const buf of gpuBuffers) {
  console.log(`\n  [${buf.name}]`)
  for (const [key, value] of Object.entries(buf.allFields)) {
    if (key === '_type') continue
    console.log(`    .${key.padEnd(30)} = ${JSON.stringify(value)}`)
  }
}

// Group by stride
console.log('\n--- GPU buffers grouped by stride ---')
const byStride = new Map<number, GpuBufferInfo[]>()
for (const buf of gpuBuffers) {
  const group = byStride.get(buf.bytesPerElement) || []
  group.push(buf)
  byStride.set(buf.bytesPerElement, group)
}
for (const [stride, bufs] of [...byStride.entries()].sort((a, b) => a[0] - b[0])) {
  const classification = stride <= 4 ? 'INDEX BUFFER' : stride <= 16 ? 'SMALL VERTEX' : 'VERTEX BUFFER'
  console.log(`\n  Stride ${stride}B (${classification}) — ${bufs.length} buffer(s):`)
  for (const b of bufs) {
    const totalMB = (b.size / (1024 * 1024)).toFixed(2)
    console.log(`    ${b.name}  elems=${b.elementCount}  size=${b.size} (${totalMB}MB)  material="${b.materialName}"`)
  }
}

// Group by material name
console.log('\n--- GPU buffers grouped by material ---')
const byMaterial = new Map<string, GpuBufferInfo[]>()
for (const buf of gpuBuffers) {
  const mat = buf.materialName || '<none>'
  const group = byMaterial.get(mat) || []
  group.push(buf)
  byMaterial.set(mat, group)
}
for (const [mat, bufs] of [...byMaterial.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
  console.log(`\n  Material: "${mat}"`)
  for (const b of bufs) {
    console.log(`    ${b.name}  stride=${b.bytesPerElement}  elems=${b.elementCount}  size=${b.size}`)
  }
}

// Name pattern analysis
console.log('\n--- Name pattern analysis ---')
for (const buf of gpuBuffers) {
  const name = buf.name
  const hasVB = /_VB_/.test(name) || /vertex/i.test(name)
  const hasIB = /_IB_/.test(name) || /index/i.test(name)
  const suffix = name.match(/_([A-Z]{2})_(\d+)$/)?.[0] || ''
  console.log(`  ${name}  stride=${buf.bytesPerElement}  ${hasVB ? '[VB]' : hasIB ? '[IB]' : '[??]'}  suffix="${suffix}"`)
}

// ============================================================================
// STEP 0c: Vertex Format Probing
// ============================================================================
console.log(`\n${'='.repeat(70)}`)
console.log('  STEP 0c: VERTEX FORMAT PROBING')
console.log(`${'='.repeat(70)}\n`)

function loadAssetData(name: string, expectedSize: number): Buffer | null {
  const civbigPath = sdIndex.get(name)
  if (!civbigPath) {
    console.log(`  [SKIP] ${name} — not found in SHARED_DATA`)
    return null
  }
  try {
    const { data: rawData } = readCivbig(civbigPath)
    if (OodleDecompressor.isOodleCompressed(rawData) && oodle) {
      const d = oodle.decompress(rawData, expectedSize || rawData.length * 4)
      return d || rawData
    }
    return rawData
  } catch (e) {
    console.log(`  [SKIP] ${name} — read error: ${e}`)
    return null
  }
}

// Probe each unique stride
for (const [stride, bufs] of [...byStride.entries()].sort((a, b) => a[0] - b[0])) {
  const sample = bufs[0]
  console.log(`\n--- Probing stride ${stride}B (sample: ${sample.name}) ---`)

  const data = loadAssetData(sample.name, sample.size)
  if (!data) continue

  console.log(`  Data size: ${data.length} bytes, expected elements: ${sample.elementCount}`)
  console.log(`  Actual elements from data: ${Math.floor(data.length / stride)}`)

  const elemCount = Math.min(5, Math.floor(data.length / stride))
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength)

  if (stride <= 4) {
    // Index buffer probing
    console.log(`\n  Index buffer interpretation:`)
    if (stride === 2) {
      console.log(`    uint16 indices (first ${elemCount}):`)
      for (let i = 0; i < Math.min(20, sample.elementCount); i++) {
        const idx = dv.getUint16(i * 2, true)
        process.stdout.write(`${idx} `)
      }
      console.log()
      // Check max index value
      let maxIdx = 0
      for (let i = 0; i < Math.min(sample.elementCount, data.length / 2); i++) {
        maxIdx = Math.max(maxIdx, dv.getUint16(i * 2, true))
      }
      console.log(`    Max index: ${maxIdx}`)
    } else if (stride === 4) {
      console.log(`    uint32 indices (first ${elemCount}):`)
      for (let i = 0; i < Math.min(20, sample.elementCount); i++) {
        const idx = dv.getUint32(i * 4, true)
        process.stdout.write(`${idx} `)
      }
      console.log()
      let maxIdx = 0
      for (let i = 0; i < Math.min(sample.elementCount, data.length / 4); i++) {
        maxIdx = Math.max(maxIdx, dv.getUint32(i * 4, true))
      }
      console.log(`    Max index: ${maxIdx}`)
    }
  } else {
    // Vertex buffer probing — try various attribute interpretations
    console.log(`\n  First ${elemCount} elements (raw hex):`)
    for (let e = 0; e < elemCount; e++) {
      const start = e * stride
      hexdump(data.subarray(start, start + stride), Math.ceil(stride / 16), start)
    }

    // Try float32×3 at offset 0 (position)
    console.log(`\n  Interpretation: float32×3 at offset 0 (position?):`)
    for (let e = 0; e < elemCount; e++) {
      const off = e * stride
      if (off + 12 <= data.length) {
        const x = dv.getFloat32(off, true)
        const y = dv.getFloat32(off + 4, true)
        const z = dv.getFloat32(off + 8, true)
        console.log(`    [${e}] (${x.toFixed(4)}, ${y.toFixed(4)}, ${z.toFixed(4)})`)
      }
    }

    // Try float32×3 at offset 12 (normal?)
    if (stride >= 24) {
      console.log(`\n  Interpretation: float32×3 at offset 12 (normal?):`)
      for (let e = 0; e < elemCount; e++) {
        const off = e * stride + 12
        if (off + 12 <= data.length) {
          const x = dv.getFloat32(off, true)
          const y = dv.getFloat32(off + 4, true)
          const z = dv.getFloat32(off + 8, true)
          const mag = Math.sqrt(x * x + y * y + z * z)
          console.log(`    [${e}] (${x.toFixed(4)}, ${y.toFixed(4)}, ${z.toFixed(4)}) mag=${mag.toFixed(4)}`)
        }
      }
    }

    // Try various UV interpretations
    // float32×2 at various offsets
    for (const uvOff of [8, 12, 16, 20, 24]) {
      if (uvOff + 8 > stride) continue
      let likelyUV = true
      for (let e = 0; e < elemCount; e++) {
        const off = e * stride + uvOff
        if (off + 8 > data.length) { likelyUV = false; break }
        const u = dv.getFloat32(off, true)
        const v = dv.getFloat32(off + 4, true)
        if (u < -2 || u > 3 || v < -2 || v > 3 || isNaN(u) || isNaN(v)) { likelyUV = false; break }
      }
      if (likelyUV) {
        console.log(`\n  Interpretation: float32×2 at offset ${uvOff} (UV?):`)
        for (let e = 0; e < elemCount; e++) {
          const off = e * stride + uvOff
          const u = dv.getFloat32(off, true)
          const v = dv.getFloat32(off + 4, true)
          console.log(`    [${e}] (${u.toFixed(6)}, ${v.toFixed(6)})`)
        }
      }
    }

    // float16×2 at various offsets
    for (const uvOff of [8, 12, 16, 20, 24, 28, 32]) {
      if (uvOff + 4 > stride) continue
      let likelyUV = true
      for (let e = 0; e < elemCount; e++) {
        const off = e * stride + uvOff
        if (off + 4 > data.length) { likelyUV = false; break }
        const u = decodeFloat16(dv.getUint16(off, true))
        const v = decodeFloat16(dv.getUint16(off + 2, true))
        if (u < -2 || u > 3 || v < -2 || v > 3 || isNaN(u) || isNaN(v)) { likelyUV = false; break }
      }
      if (likelyUV) {
        console.log(`\n  Interpretation: float16×2 at offset ${uvOff} (UV?):`)
        for (let e = 0; e < elemCount; e++) {
          const off = e * stride + uvOff
          const u = decodeFloat16(dv.getUint16(off, true))
          const v = decodeFloat16(dv.getUint16(off + 2, true))
          console.log(`    [${e}] (${u.toFixed(6)}, ${v.toFixed(6)})`)
        }
      }
    }

    // uint8×4 bone indices / bone weights at various offsets
    for (const bOff of [0, 4, 8, 12, 16, 20, 24, 28, 32, 36, 40, 44, 48]) {
      if (bOff + 4 > stride) continue
      let likelyBoneIdx = true
      let likelyBoneWeight = true
      for (let e = 0; e < elemCount; e++) {
        const off = e * stride + bOff
        if (off + 4 > data.length) { likelyBoneIdx = false; likelyBoneWeight = false; break }
        const a = data[off], b = data[off + 1], c = data[off + 2], d = data[off + 3]
        // Bone indices: small integers (0-255 valid, but typically < 200)
        if (a > 200 || b > 200 || c > 200 || d > 200) likelyBoneIdx = false
        // Bone weights: sum of normalized values (0-255 → 0.0-1.0) should be ~255
        const sum = a + b + c + d
        if (sum < 200 || sum > 260) likelyBoneWeight = false
      }
      if (likelyBoneIdx && bOff >= 12) {
        console.log(`\n  Interpretation: uint8×4 at offset ${bOff} (bone indices?):`)
        for (let e = 0; e < elemCount; e++) {
          const off = e * stride + bOff
          console.log(`    [${e}] (${data[off]}, ${data[off + 1]}, ${data[off + 2]}, ${data[off + 3]})`)
        }
      }
      if (likelyBoneWeight) {
        console.log(`\n  Interpretation: uint8×4 at offset ${bOff} (bone weights?):`)
        for (let e = 0; e < elemCount; e++) {
          const off = e * stride + bOff
          const sum = data[off] + data[off + 1] + data[off + 2] + data[off + 3]
          console.log(`    [${e}] (${data[off]}, ${data[off + 1]}, ${data[off + 2]}, ${data[off + 3]}) sum=${sum}`)
        }
      }
    }

    // Try int16 normalized (SNORM16) for normals/tangents
    for (const nOff of [12, 16, 20, 24]) {
      if (nOff + 8 > stride) continue
      let likelyNorm = true
      for (let e = 0; e < elemCount; e++) {
        const off = e * stride + nOff
        if (off + 8 > data.length) { likelyNorm = false; break }
        const x = dv.getInt16(off, true) / 32767
        const y = dv.getInt16(off + 2, true) / 32767
        const z = dv.getInt16(off + 4, true) / 32767
        const mag = Math.sqrt(x * x + y * y + z * z)
        if (mag < 0.8 || mag > 1.2) { likelyNorm = false; break }
      }
      if (likelyNorm) {
        console.log(`\n  Interpretation: snorm16×3 at offset ${nOff} (normal?):`)
        for (let e = 0; e < elemCount; e++) {
          const off = e * stride + nOff
          const x = dv.getInt16(off, true) / 32767
          const y = dv.getInt16(off + 2, true) / 32767
          const z = dv.getInt16(off + 4, true) / 32767
          const mag = Math.sqrt(x * x + y * y + z * z)
          console.log(`    [${e}] (${x.toFixed(4)}, ${y.toFixed(4)}, ${z.toFixed(4)}) mag=${mag.toFixed(4)}`)
        }
      }
    }

    // 10-10-10-2 packed normal (R10G10B10A2_SNORM)
    for (const nOff of [12, 16, 20, 24, 28]) {
      if (nOff + 4 > stride) continue
      let likelyPacked = true
      for (let e = 0; e < elemCount; e++) {
        const off = e * stride + nOff
        if (off + 4 > data.length) { likelyPacked = false; break }
        const packed = dv.getUint32(off, true)
        let x = (packed & 0x3ff); if (x >= 512) x -= 1024; x /= 511
        let y = ((packed >> 10) & 0x3ff); if (y >= 512) y -= 1024; y /= 511
        let z = ((packed >> 20) & 0x3ff); if (z >= 512) z -= 1024; z /= 511
        const mag = Math.sqrt(x * x + y * y + z * z)
        if (mag < 0.8 || mag > 1.2) { likelyPacked = false; break }
      }
      if (likelyPacked) {
        console.log(`\n  Interpretation: R10G10B10A2 at offset ${nOff} (packed normal?):`)
        for (let e = 0; e < elemCount; e++) {
          const off = e * stride + nOff
          const packed = dv.getUint32(off, true)
          let x = (packed & 0x3ff); if (x >= 512) x -= 1024; x /= 511
          let y = ((packed >> 10) & 0x3ff); if (y >= 512) y -= 1024; y /= 511
          let z = ((packed >> 20) & 0x3ff); if (z >= 512) z -= 1024; z /= 511
          const w = (packed >> 30) & 0x3
          const mag = Math.sqrt(x * x + y * y + z * z)
          console.log(`    [${e}] (${x.toFixed(4)}, ${y.toFixed(4)}, ${z.toFixed(4)}, w=${w}) mag=${mag.toFixed(4)}`)
        }
      }
    }
  }
}

// ============================================================================
// BLOB TYPE 11 (Mesh) Analysis
// ============================================================================
console.log(`\n${'='.repeat(70)}`)
console.log('  BLOB TYPE 11 (MESH) ANALYSIS')
console.log(`${'='.repeat(70)}\n`)

const meshBlobs: { name: string; size: number }[] = []
for (const alloc of parser.iterEntriesByType('BLP::BlobEntry')) {
  const obj = parser.deserializeAlloc(alloc)
  const name = obj.m_Name as string
  const bt = (obj.m_nBlobType as number) ?? -1
  const sz = (obj.m_nSize as number) || 0
  if (bt === 11) meshBlobs.push({ name, size: sz })
}

console.log(`Found ${meshBlobs.length} mesh blobs (type 11)\n`)

for (const mesh of meshBlobs.slice(0, 5)) {
  console.log(`--- ${mesh.name} (${mesh.size} bytes) ---`)
  const data = loadAssetData(mesh.name, mesh.size)
  if (!data) continue

  console.log(`  Actual size: ${data.length} bytes`)
  console.log(`\n  First 256 bytes:`)
  hexdump(data, 16, 0)

  // Heuristic header values
  if (data.length >= 16) {
    const dv = new DataView(data.buffer, data.byteOffset, data.byteLength)
    console.log(`\n  Heuristic header:`)
    console.log(`    uint32 @0x00: ${dv.getUint32(0, true)}`)
    console.log(`    uint32 @0x04: ${dv.getUint32(4, true)}`)
    console.log(`    uint32 @0x08: ${dv.getUint32(8, true)}`)
    console.log(`    uint32 @0x0C: ${dv.getUint32(12, true)}`)

    // Try to interpret more header fields
    for (let off = 0; off < Math.min(64, data.length); off += 4) {
      const u32 = dv.getUint32(off, true)
      const f32 = dv.getFloat32(off, true)
      const u16a = dv.getUint16(off, true)
      const u16b = dv.getUint16(off + 2, true)
      console.log(`    @0x${off.toString(16).padStart(2, '0')}: u32=${u32.toString().padEnd(12)} f32=${f32.toFixed(4).padEnd(14)} u16=(${u16a}, ${u16b})`)
    }
  }

  // Cross-reference: find GPU buffers that might be related by name
  const meshBase = mesh.name.replace(/\.[^.]+$/, '')
  const relatedGpuBuffers = gpuBuffers.filter(b => b.name.startsWith(meshBase) || b.materialName.includes(meshBase.split('/').pop() || ''))
  if (relatedGpuBuffers.length > 0) {
    console.log(`\n  Related GPU buffers (name prefix match):`)
    for (const b of relatedGpuBuffers) {
      console.log(`    ${b.name}  stride=${b.bytesPerElement}  elems=${b.elementCount}  material="${b.materialName}"`)
    }
  }
  console.log()
}

// ============================================================================
// Summary
// ============================================================================
console.log(`\n${'='.repeat(70)}`)
console.log('  SUMMARY')
console.log(`${'='.repeat(70)}\n`)

console.log(`BLP: ${basename(filepath)}`)
console.log(`Types in registry: ${reg?.types.size || 0}`)
console.log(`Allocation type names: ${[...new Set(parser.allocations.map(a => parser.resolveTypeName(a)))].join(', ')}`)
console.log(`GPU buffers: ${gpuBuffers.length}`)
console.log(`  Stride values: ${[...byStride.keys()].sort((a, b) => a - b).join(', ')}`)
console.log(`  Material names: ${[...byMaterial.keys()].filter(m => m !== '<none>').join(', ')}`)
console.log(`Mesh blobs (type 11): ${meshBlobs.length}`)

// Also check for other interesting blob types
const blobTypes = new Map<number, number>()
for (const alloc of parser.iterEntriesByType('BLP::BlobEntry')) {
  const obj = parser.deserializeAlloc(alloc)
  const bt = (obj.m_nBlobType as number) ?? -1
  blobTypes.set(bt, (blobTypes.get(bt) || 0) + 1)
}
console.log(`All blob types: ${[...blobTypes.entries()].map(([t, c]) => `${t}(×${c})`).join(', ')}`)

console.log(`\nDone.`)
