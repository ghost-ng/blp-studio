/**
 * Mesh geometry parser for Civ VII BLP files.
 *
 * Parses AssetPackage_GeometryComponent6 allocations from the BLP type registry
 * to extract vertex positions, indices, normals, UVs, and bone skinning data.
 *
 * Buffer layout (single GB_*_MB file):
 *   [LOD 0 vertices][LOD 1 vertices][...][all LOD indices]
 *
 * Vertex format (eCompression=1, float16 positions):
 *   +0:  float16×3 position + 2B pad  (8B)
 *   +8:  packed normal uint8×4         (4B)
 *   +12: float16×2 UV                  (4B)
 *   +16: uint8×4 bone indices          (4B, if components & 0x2)
 *   +20: uint8×4 bone weights          (4B, if components & 0x2)
 *   +24: extra data                    (8B, if components & 0x4)
 *   +?:  float16×2 UV2                 (4B, if components & 0x8)
 */

// ---- Float16 decode ----
function decodeFloat16(u16: number): number {
  const sign = (u16 >> 15) & 1
  const exp = (u16 >> 10) & 0x1f
  const mant = u16 & 0x3ff
  if (exp === 0) return (sign ? -1 : 1) * (mant / 1024) * Math.pow(2, -14)
  if (exp === 31) return mant === 0 ? (sign ? -Infinity : Infinity) : NaN
  return (sign ? -1 : 1) * Math.pow(2, exp - 15) * (1 + mant / 1024)
}

// ---- Types ----

export interface MeshLod {
  vbName: string
  ibName: string // same as vbName (shared buffer)
  vertexOffset: number    // byte offset into buffer for vertex data
  vertexStride: number    // bytes per vertex (20, 28, 36)
  vertexComponents: number // bitflags (0x9, 0xb, 0xf)
  compression: number     // 1 = float16 positions
  primitiveCount: number  // triangle count
  minIndex: number
  maxIndex: number
  indexStart: number      // element offset into buffer for index data
  indexStride: number     // 4 = uint32, 2 = uint16
  materialHash: number
  materialName: string  // from pVB.m_MaterialName
}

export interface MeshSubmesh {
  nameHash: number
  materialHash: number
  lodStart: number
  lodCount: number
  skeletonIndex: number  // 65535 = no skeleton
}

export interface MeshGeometry {
  nameHash: number
  meshStart: number
  meshCount: number
  lod: number
  diameterPixels: number
}

export interface MeshDeformer {
  nameHash: number
  transformIndex: number
  parent: number         // 65535 = root
  inverseBind: {
    position: [number, number, number]
    scale: number
    rotation: [number, number, number, number] // quaternion [s, i, j, k]
  }
}

export interface MeshSkeleton {
  hash: number
  deformerStart: number
  deformerCount: number
}

export interface ParsedGeometryComponent {
  geometries: MeshGeometry[]
  meshes: MeshSubmesh[]
  lods: MeshLod[]
  skeletons: MeshSkeleton[]
  deformers: MeshDeformer[]
}

export interface ParsedMeshData {
  positions: Float32Array   // xyz interleaved
  indices: Uint32Array
  normals: Float32Array | null  // xyz interleaved
  uvs: Float32Array | null      // uv interleaved
  boneIndices: Uint8Array | null // 4 per vertex
  boneWeights: Float32Array | null // 4 per vertex (normalized)
  vertexCount: number
  triangleCount: number
}

/**
 * Extract geometry components from a deserialized BLP.
 * Call this from the main process after parser.parse().
 */
export function extractGeometryComponents(
  parser: { iterEntriesByType(t: string): Generator<any>; deserializeAlloc(a: any): Record<string, unknown> }
): ParsedGeometryComponent[] {
  const results: ParsedGeometryComponent[] = []

  for (const alloc of parser.iterEntriesByType('AssetPackage_GeometryComponent6')) {
    const obj = parser.deserializeAlloc(alloc)
    results.push(parseGeometryComponent(obj))
  }

  return results
}

function parseGeometryComponent(obj: Record<string, unknown>): ParsedGeometryComponent {
  const geoms = (obj.m_Geometry as any[]) || []
  const meshes = (obj.m_Meshes as any[]) || []
  const lodArr = (obj.m_MeshLods as any[]) || []
  const skelArr = (obj.m_MeshSkeletons as any[]) || []
  const defArr = (obj.m_Deformers as any[]) || []

  return {
    geometries: geoms.map(g => ({
      nameHash: (g.nNameHash as number) || 0,
      meshStart: (g.nMeshStart as number) || 0,
      meshCount: (g.nMeshCount as number) || 0,
      lod: (g.nLod as number) || 0,
      diameterPixels: (g.fDiameterPixels as number) || 0,
    })),
    meshes: meshes.map(m => ({
      nameHash: (m.nHash as number) || 0,
      materialHash: (m.nMaterialHash as number) || 0,
      lodStart: (m.nLodStart as number) || 0,
      lodCount: (m.nLodCount as number) || 0,
      skeletonIndex: (m.nSkeleton as number) ?? 65535,
    })),
    lods: lodArr.map(l => {
      const vb = l.pVB as Record<string, unknown> | null
      const ib = l.pIB as Record<string, unknown> | null
      return {
        vbName: (vb?.m_Name as string) || '',
        ibName: (ib?.m_Name as string) || '',
        vertexOffset: (l.nVertexOffset as number) || 0,
        vertexStride: (l.nVertexStride as number) || 0,
        vertexComponents: (l.eVertexComponents as number) || 0,
        compression: (l.eCompression as number) || 0,
        primitiveCount: (l.nPrimitiveCount as number) || 0,
        minIndex: (l.nMinIndex as number) || 0,
        maxIndex: (l.nMaxIndex as number) || 0,
        indexStart: (l.nIndexStart as number) || 0,
        indexStride: (l.nIndexStride as number) || 4,
        materialHash: (l.nMaterialHash as number) || 0,
        materialName: (vb?.m_MaterialName as string) || '',
      }
    }),
    skeletons: skelArr.map(s => ({
      hash: (s.nHash as number) || 0,
      deformerStart: (s.nDeformerStart as number) || 0,
      deformerCount: (s.nDeformerCount as number) || 0,
    })),
    deformers: defArr.map(d => {
      const ib = d.InverseBind as any
      const pos = ib?.m_v3Position
      const rot = ib?.m_kRotation
      return {
        nameHash: (d.nNameHash as number) || 0,
        transformIndex: (d.nTransform as number) || 0,
        parent: (d.nParent as number) ?? 65535,
        inverseBind: {
          position: [pos?.x || 0, pos?.y || 0, pos?.z || 0] as [number, number, number],
          scale: (ib?.m_fScale as number) || 1,
          rotation: [rot?.s || 0, rot?.i || 0, rot?.j || 0, rot?.k || 0] as [number, number, number, number],
        },
      }
    }),
  }
}

/**
 * Parse vertex and index data from a raw GPU buffer for a specific LOD.
 * Returns typed arrays ready for Three.js BufferGeometry.
 */
export function parseMeshLodData(buffer: Buffer, lod: MeshLod): ParsedMeshData {
  const {
    vertexOffset, vertexStride, vertexComponents, compression,
    primitiveCount, minIndex, maxIndex, indexStart, indexStride,
  } = lod

  const vertexCount = maxIndex - minIndex + 1
  const triangleCount = primitiveCount
  const indexCount = triangleCount * 3

  const dv = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)

  // ---- Parse positions ----
  const positions = new Float32Array(vertexCount * 3)

  if (compression === 1) {
    // Float16 positions
    for (let v = 0; v < vertexCount; v++) {
      const off = vertexOffset + (minIndex + v) * vertexStride
      positions[v * 3] = decodeFloat16(dv.getUint16(off, true))
      positions[v * 3 + 1] = decodeFloat16(dv.getUint16(off + 2, true))
      positions[v * 3 + 2] = decodeFloat16(dv.getUint16(off + 4, true))
    }
  } else {
    // Float32 positions (fallback)
    for (let v = 0; v < vertexCount; v++) {
      const off = vertexOffset + (minIndex + v) * vertexStride
      positions[v * 3] = dv.getFloat32(off, true)
      positions[v * 3 + 1] = dv.getFloat32(off + 4, true)
      positions[v * 3 + 2] = dv.getFloat32(off + 8, true)
    }
  }

  // ---- Parse indices ----
  const indices = new Uint32Array(indexCount)
  const idxByteStart = indexStart * indexStride

  for (let i = 0; i < indexCount; i++) {
    const off = idxByteStart + i * indexStride
    const rawIdx = indexStride === 2
      ? dv.getUint16(off, true)
      : dv.getUint32(off, true)
    // Remap: indices are relative to the LOD's vertex range
    indices[i] = rawIdx - minIndex
  }

  // ---- Parse normals ----
  let normals: Float32Array | null = null
  if (compression === 1) {
    // Normal at +8 (UNORM8×4, mapped via (val-128)/127)
    normals = new Float32Array(vertexCount * 3)
    for (let v = 0; v < vertexCount; v++) {
      const off = vertexOffset + (minIndex + v) * vertexStride + 8
      const nx = (buffer[off] - 128) / 127
      const ny = (buffer[off + 1] - 128) / 127
      const nz = (buffer[off + 2] - 128) / 127
      // Normalize to unit length
      const mag = Math.sqrt(nx * nx + ny * ny + nz * nz)
      if (mag > 0.001) {
        normals[v * 3] = nx / mag
        normals[v * 3 + 1] = ny / mag
        normals[v * 3 + 2] = nz / mag
      } else {
        normals[v * 3 + 2] = 1 // default up
      }
    }
  }

  // ---- Parse UVs ----
  let uvs: Float32Array | null = null
  const uvOffset = compression === 1 ? 12 : 24 // after position(8) + normal(4) for compressed
  if (uvOffset + 4 <= vertexStride) {
    uvs = new Float32Array(vertexCount * 2)
    for (let v = 0; v < vertexCount; v++) {
      const off = vertexOffset + (minIndex + v) * vertexStride + uvOffset
      uvs[v * 2] = decodeFloat16(dv.getUint16(off, true))
      uvs[v * 2 + 1] = 1 - decodeFloat16(dv.getUint16(off + 2, true)) // flip V for OpenGL convention
    }
  }

  // ---- Parse bone data (if components & 0x2) ----
  let boneIndices: Uint8Array | null = null
  let boneWeights: Float32Array | null = null
  if (vertexComponents & 0x2) {
    const boneOffset = compression === 1 ? 16 : 32
    boneIndices = new Uint8Array(vertexCount * 4)
    boneWeights = new Float32Array(vertexCount * 4)
    for (let v = 0; v < vertexCount; v++) {
      const idxOff = vertexOffset + (minIndex + v) * vertexStride + boneOffset
      const wgtOff = idxOff + 4
      for (let j = 0; j < 4; j++) {
        boneIndices[v * 4 + j] = buffer[idxOff + j]
        boneWeights[v * 4 + j] = buffer[wgtOff + j] / 255
      }
    }
  }

  return {
    positions,
    indices,
    normals,
    uvs,
    boneIndices,
    boneWeights,
    vertexCount,
    triangleCount,
  }
}
