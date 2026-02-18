#!/usr/bin/env npx tsx
/**
 * Phase 0b: Deserialize AssetPackage_GeometryComponent6 allocations
 * to understand mesh structure, vertex formats, and asset linking.
 *
 * Usage: npx tsx scripts/discover-geometry.ts <file.blp> [--all] [--probe]
 *   --all    Show all geometry components (default: first 3)
 *   --probe  Probe actual vertex data from SHARED_DATA
 */

import { resolve, basename } from 'path'
import { BLPParser } from '../src/core/blp-parser'
import { readCivbig } from '../src/core/civbig'
import { OodleDecompressor } from '../src/core/oodle'
import { findOodleCandidates, findAllSharedData, findGameRootFromPath, findSharedDataCandidates, buildSharedDataIndex } from '../src/core/game-detect'

function decodeFloat16(u16: number): number {
  const sign = (u16 >> 15) & 1
  const exp = (u16 >> 10) & 0x1f
  const mant = u16 & 0x3ff
  if (exp === 0) return (sign ? -1 : 1) * (mant / 1024) * Math.pow(2, -14)
  if (exp === 31) return mant === 0 ? (sign ? -Infinity : Infinity) : NaN
  return (sign ? -1 : 1) * Math.pow(2, exp - 15) * (1 + mant / 1024)
}

function hexdump(data: Buffer | Uint8Array, maxRows = 4, startOffset = 0): void {
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
      `    ${(startOffset + off).toString(16).padStart(8, '0')}  ${hex.slice(0, 8).join(' ')}  ${hex.slice(8).join(' ')}  |${ascii}|`
    )
  }
}

const args = process.argv.slice(2)
const blpPath = args.find(a => !a.startsWith('--'))
const showAll = args.includes('--all')
const doProbe = args.includes('--probe')

if (!blpPath) {
  console.error('Usage: npx tsx scripts/discover-geometry.ts <file.blp> [--all] [--probe]')
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
console.log(`  GEOMETRY DISCOVERY: ${basename(filepath)}`)
console.log(`${'='.repeat(70)}`)
console.log(`Shared data: ${sdIndex.size} files, Oodle: ${oodle ? 'loaded' : 'NOT FOUND'}\n`)

// ---- Collect all GeometryComponent6 allocations ----
const geomComponents: Record<string, unknown>[] = []
for (const alloc of parser.iterEntriesByType('AssetPackage_GeometryComponent6')) {
  geomComponents.push(parser.deserializeAlloc(alloc))
}

console.log(`Total GeometryComponent6 allocations: ${geomComponents.length}\n`)

// ---- Also collect PackageAssetEntry_Standard0 to find names for geometry components ----
const standardAssets: { name: string; obj: Record<string, unknown> }[] = []
for (const alloc of parser.iterEntriesByType('PackageAssetEntry_Standard0')) {
  const obj = parser.deserializeAlloc(alloc)
  standardAssets.push({ name: (obj.m_Name as string) || '', obj })
}
console.log(`PackageAssetEntry_Standard0 count: ${standardAssets.length}`)

// Show a sample standard asset to understand its structure
if (standardAssets.length > 0) {
  console.log(`\nSample PackageAssetEntry_Standard0 fields:`)
  for (const [key, value] of Object.entries(standardAssets[0].obj)) {
    if (key === '_type') continue
    const display = typeof value === 'object' && value !== null
      ? JSON.stringify(value).substring(0, 120)
      : JSON.stringify(value)
    console.log(`  .${key} = ${display}`)
  }
}

// ---- Analyze Deformer2 allocations (bone remapping?) ----
const deformers: Record<string, unknown>[] = []
for (const alloc of parser.iterEntriesByType('AssetPackage_Deformer2')) {
  deformers.push(parser.deserializeAlloc(alloc))
}
console.log(`\nDeformer2 allocations: ${deformers.length}`)
if (deformers.length > 0) {
  console.log(`Sample Deformer2 fields:`)
  for (const [key, value] of Object.entries(deformers[0])) {
    if (key === '_type') continue
    const display = typeof value === 'object' && value !== null
      ? JSON.stringify(value).substring(0, 200)
      : JSON.stringify(value)
    console.log(`  .${key} = ${display}`)
  }
}

// ---- Collect unique vertex strides and component flags ----
const strideSet = new Set<number>()
const compSet = new Set<number>()
const indexStrideSet = new Set<number>()

// ---- Print geometry component details ----
const limit = showAll ? geomComponents.length : Math.min(3, geomComponents.length)

for (let gi = 0; gi < limit; gi++) {
  const gc = geomComponents[gi]
  console.log(`\n${'='.repeat(70)}`)
  console.log(`  GEOMETRY COMPONENT #${gi}`)
  console.log(`${'='.repeat(70)}`)

  // Top-level fields
  const range = gc.m_Range as any
  const nGeom = gc.m_nGeometry as number
  const eFlags = gc.m_eFlags as number
  console.log(`  m_nGeometry: ${nGeom}`)
  console.log(`  m_eFlags: ${eFlags} (0x${eFlags?.toString(16)})`)
  if (range) {
    console.log(`  m_Range: min=(${range.m_vMin?.x?.toFixed(2)}, ${range.m_vMin?.y?.toFixed(2)}, ${range.m_vMin?.z?.toFixed(2)}) max=(${range.m_vMax?.x?.toFixed(2)}, ${range.m_vMax?.y?.toFixed(2)}, ${range.m_vMax?.z?.toFixed(2)})`)
  }

  // Geometry entries (LOD groups)
  const geoms = gc.m_Geometry as any[]
  console.log(`\n  --- Geometry entries (${geoms?.length || 0}) ---`)
  if (geoms) {
    for (const g of geoms.slice(0, 10)) {
      console.log(`    hash=0x${(g.nNameHash as number)?.toString(16)} hashLodSrc=0x${(g.nNameHashLodSrc as number)?.toString(16)} meshStart=${g.nMeshStart} meshCount=${g.nMeshCount} lod=${g.nLod} diamPx=${(g.fDiameterPixels as number)?.toFixed(1)}`)
    }
  }

  // Mesh entries
  const meshes = gc.m_Meshes as any[]
  console.log(`\n  --- Meshes (${meshes?.length || 0}) ---`)
  if (meshes) {
    for (const m of meshes.slice(0, 10)) {
      console.log(`    hash=0x${(m.nHash as number)?.toString(16)} matHash=0x${(m.nMaterialHash as number)?.toString(16)} geom=${m.nGeometry} mesh=${m.nMesh} group=${m.nGroup}`)
      console.log(`      lodStart=${m.nLodStart} lodCount=${m.nLodCount} skeleton=${m.nSkeleton} idMap=${m.iIDMap} flags=0x${(m.eFlags as number)?.toString(16)}`)
      if (m.kRange) {
        const r = m.kRange
        console.log(`      range: min=(${r.m_vMin?.x?.toFixed(2)}, ${r.m_vMin?.y?.toFixed(2)}, ${r.m_vMin?.z?.toFixed(2)}) max=(${r.m_vMax?.x?.toFixed(2)}, ${r.m_vMax?.y?.toFixed(2)}, ${r.m_vMax?.z?.toFixed(2)})`)
      }
    }
  }

  // Mesh LODs — THIS IS THE KEY DATA
  const lods = gc.m_MeshLods as any[]
  console.log(`\n  --- Mesh LODs (${lods?.length || 0}) ---`)
  if (lods) {
    for (const l of lods.slice(0, 10)) {
      const vb = l.pVB as Record<string, unknown> | null
      const ib = l.pIB as Record<string, unknown> | null
      const vbName = vb?.m_Name || '<null>'
      const ibName = ib?.m_Name || '<null>'
      const vbSize = (vb?.m_nSize as number) || 0
      const ibSize = (ib?.m_nSize as number) || 0

      strideSet.add(l.nVertexStride as number)
      compSet.add(l.eVertexComponents as number)
      indexStrideSet.add(l.nIndexStride as number)

      console.log(`    VB="${vbName}" (${vbSize}B) IB="${ibName}" (${ibSize}B)`)
      console.log(`      matHash=0x${(l.nMaterialHash as number)?.toString(16)} vertOff=${l.nVertexOffset} vertStride=${l.nVertexStride} flags=0x${(l.mFlags as number)?.toString(16)} compression=${l.eCompression}`)
      console.log(`      primCount=${l.nPrimitiveCount} minIdx=${l.nMinIndex} maxIdx=${l.nMaxIndex} idxStart=${l.nIndexStart} idxStride=${l.nIndexStride}`)
      console.log(`      vertComponents=0x${(l.eVertexComponents as number)?.toString(16)} diamPx=${(l.fDiameterPixels as number)?.toFixed(1)} uvDensity=${(l.fUVDensity as number)?.toFixed(4)}`)

      // If probing, read actual VB data and interpret
      if (doProbe && vb?.m_Name) {
        const vbPath = sdIndex.get(vb.m_Name as string)
        if (vbPath) {
          try {
            const { data: rawData } = readCivbig(vbPath)
            let vbData: Buffer
            if (OodleDecompressor.isOodleCompressed(rawData) && oodle) {
              const d = oodle.decompress(rawData, vbSize || rawData.length * 4)
              vbData = d || rawData
            } else {
              vbData = rawData
            }

            const stride = l.nVertexStride as number
            const vertOff = (l.nVertexOffset as number) || 0
            const maxIdx = (l.nMaxIndex as number) || 0
            const vertCount = maxIdx - ((l.nMinIndex as number) || 0) + 1
            const dataStart = vertOff * stride

            console.log(`\n      --- VB Probe: ${vbData.length}B total, stride=${stride}, vertOff=${vertOff}, vertCount~${vertCount} ---`)
            console.log(`      First 3 vertices (raw hex):`)
            for (let v = 0; v < Math.min(3, vertCount); v++) {
              const off = dataStart + v * stride
              if (off + stride <= vbData.length) {
                hexdump(vbData.subarray(off, off + stride), Math.ceil(stride / 16), off)
              }
            }

            // Interpret based on stride
            const dv = new DataView(vbData.buffer, vbData.byteOffset, vbData.byteLength)
            if (stride >= 12) {
              console.log(`\n      float32×3 at offset 0 (position?):`)
              for (let v = 0; v < Math.min(5, vertCount); v++) {
                const off = dataStart + v * stride
                if (off + 12 <= vbData.length) {
                  const x = dv.getFloat32(off, true)
                  const y = dv.getFloat32(off + 4, true)
                  const z = dv.getFloat32(off + 8, true)
                  console.log(`        [${v}] (${x.toFixed(4)}, ${y.toFixed(4)}, ${z.toFixed(4)})`)
                }
              }
            }

            // Try float16×2 at various offsets for UVs
            for (const uvOff of [12, 16, 20, 24, 28, 32]) {
              if (uvOff + 4 > stride) continue
              let likelyUV = true
              for (let v = 0; v < Math.min(5, vertCount); v++) {
                const off = dataStart + v * stride + uvOff
                if (off + 4 > vbData.length) { likelyUV = false; break }
                const u = decodeFloat16(dv.getUint16(off, true))
                const vv = decodeFloat16(dv.getUint16(off + 2, true))
                if (u < -2 || u > 3 || vv < -2 || vv > 3 || isNaN(u) || isNaN(vv)) { likelyUV = false; break }
              }
              if (likelyUV) {
                console.log(`\n      float16×2 at +${uvOff} (UV?):`)
                for (let v = 0; v < Math.min(5, vertCount); v++) {
                  const off = dataStart + v * stride + uvOff
                  const u = decodeFloat16(dv.getUint16(off, true))
                  const vv = decodeFloat16(dv.getUint16(off + 2, true))
                  console.log(`        [${v}] (${u.toFixed(6)}, ${vv.toFixed(6)})`)
                }
              }
            }

            // Try R10G10B10A2 packed normals
            for (const nOff of [12, 16, 20]) {
              if (nOff + 4 > stride) continue
              let likelyPacked = true
              for (let v = 0; v < Math.min(5, vertCount); v++) {
                const off = dataStart + v * stride + nOff
                if (off + 4 > vbData.length) { likelyPacked = false; break }
                const packed = dv.getUint32(off, true)
                let x = (packed & 0x3ff); if (x >= 512) x -= 1024; x /= 511
                let y = ((packed >> 10) & 0x3ff); if (y >= 512) y -= 1024; y /= 511
                let z = ((packed >> 20) & 0x3ff); if (z >= 512) z -= 1024; z /= 511
                const mag = Math.sqrt(x * x + y * y + z * z)
                if (mag < 0.7 || mag > 1.3) { likelyPacked = false; break }
              }
              if (likelyPacked) {
                console.log(`\n      R10G10B10A2 at +${nOff} (normal?):`)
                for (let v = 0; v < Math.min(5, vertCount); v++) {
                  const off = dataStart + v * stride + nOff
                  const packed = dv.getUint32(off, true)
                  let x = (packed & 0x3ff); if (x >= 512) x -= 1024; x /= 511
                  let y = ((packed >> 10) & 0x3ff); if (y >= 512) y -= 1024; y /= 511
                  let z = ((packed >> 20) & 0x3ff); if (z >= 512) z -= 1024; z /= 511
                  const w = (packed >> 30) & 0x3
                  const mag = Math.sqrt(x * x + y * y + z * z)
                  console.log(`        [${v}] (${x.toFixed(4)}, ${y.toFixed(4)}, ${z.toFixed(4)}, w=${w}) mag=${mag.toFixed(4)}`)
                }
              }
            }

            // Try uint8×4 bone weights (sum ~255)
            for (const bOff of [16, 20, 24, 28, 32, 36]) {
              if (bOff + 4 > stride) continue
              let likelyWeight = true
              for (let v = 0; v < Math.min(5, vertCount); v++) {
                const off = dataStart + v * stride + bOff
                if (off + 4 > vbData.length) { likelyWeight = false; break }
                const sum = vbData[off] + vbData[off + 1] + vbData[off + 2] + vbData[off + 3]
                if (sum < 200 || sum > 260) { likelyWeight = false; break }
              }
              if (likelyWeight) {
                console.log(`\n      uint8×4 at +${bOff} (bone weights? sum~255):`)
                for (let v = 0; v < Math.min(5, vertCount); v++) {
                  const off = dataStart + v * stride + bOff
                  const sum = vbData[off] + vbData[off + 1] + vbData[off + 2] + vbData[off + 3]
                  console.log(`        [${v}] (${vbData[off]}, ${vbData[off + 1]}, ${vbData[off + 2]}, ${vbData[off + 3]}) sum=${sum}`)
                }
              }
            }

            // Try uint8×4 or uint16×4 bone indices (small values)
            for (const bOff of [12, 16, 20, 24, 28, 32, 36]) {
              if (bOff + 4 > stride) continue
              let likelyIdx = true
              for (let v = 0; v < Math.min(5, vertCount); v++) {
                const off = dataStart + v * stride + bOff
                if (off + 4 > vbData.length) { likelyIdx = false; break }
                // Check if all 4 bytes are reasonable bone indices (< 255 for most models)
                if (vbData[off] > 200 && vbData[off + 1] > 200) { likelyIdx = false; break }
              }
              if (likelyIdx) {
                console.log(`\n      uint8×4 at +${bOff} (bone indices?):`)
                for (let v = 0; v < Math.min(5, vertCount); v++) {
                  const off = dataStart + v * stride + bOff
                  console.log(`        [${v}] (${vbData[off]}, ${vbData[off + 1]}, ${vbData[off + 2]}, ${vbData[off + 3]})`)
                }
              }
            }
          } catch (e) {
            console.log(`      [VB PROBE ERROR] ${e}`)
          }
        } else {
          console.log(`      [VB NOT FOUND IN SHARED_DATA]`)
        }

        // Also probe IB
        if (ib?.m_Name) {
          const ibPath = sdIndex.get(ib.m_Name as string)
          if (ibPath) {
            try {
              const { data: rawData } = readCivbig(ibPath)
              let ibData: Buffer
              if (OodleDecompressor.isOodleCompressed(rawData) && oodle) {
                const d = oodle.decompress(rawData, ibSize || rawData.length * 4)
                ibData = d || rawData
              } else {
                ibData = rawData
              }

              const idxStride = l.nIndexStride as number
              const idxStart = (l.nIndexStart as number) || 0
              const primCount = (l.nPrimitiveCount as number) || 0
              const idxCount = primCount * 3

              console.log(`\n      --- IB Probe: ${ibData.length}B total, idxStride=${idxStride}, idxStart=${idxStart}, primCount=${primCount} ---`)
              const dvIb = new DataView(ibData.buffer, ibData.byteOffset, ibData.byteLength)

              if (idxStride === 2) {
                console.log(`      First 20 uint16 indices:`)
                const indices: number[] = []
                for (let i = 0; i < Math.min(20, idxCount); i++) {
                  const off = idxStart * 2 + i * 2
                  if (off + 2 <= ibData.length) indices.push(dvIb.getUint16(off, true))
                }
                console.log(`        ${indices.join(', ')}`)
                let maxIdx = 0
                for (let i = 0; i < Math.min(idxCount, ibData.length / 2); i++) {
                  const off = idxStart * 2 + i * 2
                  if (off + 2 <= ibData.length) maxIdx = Math.max(maxIdx, dvIb.getUint16(off, true))
                }
                console.log(`      Max index: ${maxIdx}`)
              } else if (idxStride === 4) {
                console.log(`      First 20 uint32 indices:`)
                const indices: number[] = []
                for (let i = 0; i < Math.min(20, idxCount); i++) {
                  const off = idxStart * 4 + i * 4
                  if (off + 4 <= ibData.length) indices.push(dvIb.getUint32(off, true))
                }
                console.log(`        ${indices.join(', ')}`)
              }
            } catch (e) {
              console.log(`      [IB PROBE ERROR] ${e}`)
            }
          }
        }
      }
    }
  }

  // Mesh Skeletons
  const skels = gc.m_MeshSkeletons as any[]
  console.log(`\n  --- Mesh Skeletons (${skels?.length || 0}) ---`)
  if (skels) {
    for (const s of skels.slice(0, 5)) {
      console.log(`    hash=0x${(s.nHash as number)?.toString(16)} deformerStart=${s.nDeformerStart} deformerCount=${s.nDeformerCount}`)
    }
  }

  // Deformers
  const defList = gc.m_Deformers as any[]
  console.log(`\n  --- Deformers (${defList?.length || 0}) ---`)
  if (defList) {
    for (const d of defList.slice(0, 5)) {
      console.log(`    ${JSON.stringify(d).substring(0, 200)}`)
    }
  }

  // IDMaps
  const idmaps = gc.m_IDMaps as any[]
  console.log(`\n  --- IDMaps (${idmaps?.length || 0}) ---`)
  if (idmaps) {
    for (const m of idmaps.slice(0, 3)) {
      console.log(`    ${JSON.stringify(m).substring(0, 200)}`)
    }
  }
}

// ---- Summary ----
console.log(`\n${'='.repeat(70)}`)
console.log('  SUMMARY')
console.log(`${'='.repeat(70)}\n`)

console.log(`GeometryComponent6 count: ${geomComponents.length}`)
console.log(`Unique vertex strides: ${[...strideSet].sort((a, b) => a - b).join(', ')}`)
console.log(`Unique vertex component flags: ${[...compSet].sort((a, b) => a - b).map(c => `0x${c.toString(16)}`).join(', ')}`)
console.log(`Unique index strides: ${[...indexStrideSet].sort((a, b) => a - b).join(', ')}`)
console.log()
