import { log } from './logger'

/**
 * Parser for Civ7 RootNode skeleton (.skel) format.
 *
 * Format: fixed-size bone records, 296 bytes each.
 * No separate header — first record IS bone 0 (named "RootNode").
 *
 * Per-bone record layout (296 bytes = 0x128):
 *   0x000  160B  char[160]    Bone name (null-terminated, zero-padded)
 *   0x0A0   16B  float32×4    Rest quaternion A (identity: 0,0,0,1)
 *   0x0B0   16B  float32×4    Rest quaternion B (identity: 1,0,0,0)
 *   0x0C0   16B  float32×4    World position (x, y, z, w=1)
 *   0x0D0   16B  float32×4    World rotation quaternion (x, y, z, w)
 *   0x0E0   16B  float32×4    Local position (x, y, z, w=1)
 *   0x0F0   16B  float32×4    Local rotation quaternion (x, y, z, w)
 *   0x100   16B  float32×4    Scaled world position (x×s, y×s, z×s, scale)
 *   0x110   16B  float32×4    World rotation copy (x, y, z, w)
 *   0x120    4B  uint32       Bone name hash
 *   0x124    4B  int32        Parent bone index (-1 for root)
 */

const RECORD_SIZE = 296 // 0x128
const NAME_SIZE = 160   // 0x0A0

export interface SkeletonBone {
  index: number
  name: string
  parentIndex: number
  /** Local-space position relative to parent (x, y, z) */
  localPosition: [number, number, number]
  /** Local-space rotation quaternion (x, y, z, w) */
  localRotation: [number, number, number, number]
  /** World-space position (x, y, z) */
  worldPosition: [number, number, number]
  /** World-space rotation quaternion (x, y, z, w) */
  worldRotation: [number, number, number, number]
  /** Bone name hash (uint32) */
  nameHash: number
}

export interface ParsedSkeleton {
  boneCount: number
  bones: SkeletonBone[]
}

/**
 * Parse a RootNode skeleton binary blob into structured bone data.
 */
export function parseSkeleton(data: Buffer | Uint8Array): ParsedSkeleton | null {
  if (data.length < RECORD_SIZE) return null

  // Verify magic: first 8 bytes should be "RootNode"
  const magic = String.fromCharCode(data[0], data[1], data[2], data[3], data[4], data[5], data[6], data[7])
  if (!magic.startsWith('RootNode') && !magic.startsWith('Root')) return null

  const boneCount = Math.floor(data.length / RECORD_SIZE)
  const view = new DataView(
    data.buffer,
    data.byteOffset,
    data.byteLength
  )

  const bones: SkeletonBone[] = []

  for (let i = 0; i < boneCount; i++) {
    const base = i * RECORD_SIZE

    // Read name (null-terminated ASCII within 160-byte field)
    let nameEnd = base
    while (nameEnd < base + NAME_SIZE && data[nameEnd] !== 0) nameEnd++
    const name = String.fromCharCode(...data.subarray(base, nameEnd))

    // Local position at +0xE0 (x, y, z; skip w at +0xEC)
    const lpx = view.getFloat32(base + 0xE0, true)
    const lpy = view.getFloat32(base + 0xE4, true)
    const lpz = view.getFloat32(base + 0xE8, true)

    // Local rotation at +0xF0 (x, y, z, w)
    const lrx = view.getFloat32(base + 0xF0, true)
    const lry = view.getFloat32(base + 0xF4, true)
    const lrz = view.getFloat32(base + 0xF8, true)
    const lrw = view.getFloat32(base + 0xFC, true)

    // World position at +0xC0 (x, y, z)
    const wpx = view.getFloat32(base + 0xC0, true)
    const wpy = view.getFloat32(base + 0xC4, true)
    const wpz = view.getFloat32(base + 0xC8, true)

    // World rotation at +0xD0 (x, y, z, w)
    const wrx = view.getFloat32(base + 0xD0, true)
    const wry = view.getFloat32(base + 0xD4, true)
    const wrz = view.getFloat32(base + 0xD8, true)
    const wrw = view.getFloat32(base + 0xDC, true)

    // Name hash at +0x120
    const nameHash = view.getUint32(base + 0x120, true)

    // Parent index at +0x124
    const parentIndex = view.getInt32(base + 0x124, true)

    bones.push({
      index: i,
      name,
      parentIndex,
      localPosition: [lpx, lpy, lpz],
      localRotation: [lrx, lry, lrz, lrw],
      worldPosition: [wpx, wpy, wpz],
      worldRotation: [wrx, wry, wrz, wrw],
      nameHash,
    })
  }

  return { boneCount, bones }
}

/**
 * Parse a V0 animation blob (uncompressed keyframes).
 *
 * V0 format (magic B0 6A B0 6A):
 *   0x00  4B  uint32   Magic (0x6AB06AB0)
 *   0x04  4B  uint32   Flags/version
 *   0x08  4B  float32  FPS
 *   0x0C  4B  uint32   Frame count
 *   0x10  4B  uint32   Bone count
 *   0x14  4B  uint32   ?
 *   0x18  4B  uint32   Main data size
 *   0x1C  4B  uint32   ?
 *   0x20  4B  uint32   Secondary data size
 *   ...
 *   0x48  4B  uint32   Data offset marker (0xFFFFFFFF for V0)
 *   0x50  4B  uint32   Name string offset
 *   0x60  start of keyframe data
 *
 * Keyframe data: 10 float32 per bone per frame
 *   [qw, qx, qy, qz, px, py, pz, sx, sy, sz]
 */
export interface AnimKeyframe {
  rotation: [number, number, number, number] // w, x, y, z
  position: [number, number, number]
  scale: [number, number, number]
}

export interface ParsedAnimation {
  fps: number
  frameCount: number
  boneCount: number
  duration: number
  name: string
  isV0: boolean
  /** If true, keyframe positions/rotations are in world space (V1). If false, local space (V0). */
  isWorldSpace: boolean
  /** keyframes[frameIndex][boneIndex] */
  keyframes: AnimKeyframe[][] | null
}

const ANIM_MAGIC = 0x6AB06AB0

// Quaternion and vector type aliases
type Q4 = [number, number, number, number]
type V3 = [number, number, number]

export function parseAnimation(
  data: Buffer | Uint8Array,
  /** Skeleton rest-pose for V1 identity/constant channel fallback */
  restPose?: { worldPosition: V3; worldRotation: Q4; parentIndex: number }[]
): ParsedAnimation | null {
  if (data.length < 96) return null

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)

  const magic = view.getUint32(0, true)
  if (magic !== ANIM_MAGIC) return null

  const fps = view.getFloat32(0x08, true)
  const frameCount = view.getUint32(0x0C, true)
  const boneField = view.getUint32(0x10, true)
  const dataOff48 = view.getUint32(0x48, true)
  const nameOff = view.getUint32(0x50, true)

  const isV0 = dataOff48 === 0xFFFFFFFF
  const boneCount = isV0 ? boneField : (boneField & 0xFFFF)
  const duration = fps > 0 ? frameCount / fps : 0

  // Read animation name from end of file
  let name = ''
  if (nameOff > 0 && nameOff < data.length) {
    const end = data.indexOf(0, nameOff)
    if (end > nameOff) {
      name = String.fromCharCode(...data.subarray(nameOff, Math.min(end, nameOff + 128)))
    }
  }

  let keyframes: AnimKeyframe[][] | null = null

  if (isV0) {
    // V0: raw keyframe data at offset 0x60
    // 10 floats per bone per frame: qw, qx, qy, qz, px, py, pz, sx, sy, sz
    const dataStart = 0x60
    const floatsPerBone = 10
    const bytesPerFrame = boneCount * floatsPerBone * 4
    const expectedSize = dataStart + frameCount * bytesPerFrame

    if (data.length >= expectedSize && frameCount > 0 && boneCount > 0 && boneCount < 500) {
      keyframes = []
      for (let f = 0; f < frameCount; f++) {
        const frame: AnimKeyframe[] = []
        for (let b = 0; b < boneCount; b++) {
          const off = dataStart + (f * boneCount + b) * floatsPerBone * 4
          const qw = view.getFloat32(off + 0, true)
          const qx = view.getFloat32(off + 4, true)
          const qy = view.getFloat32(off + 8, true)
          const qz = view.getFloat32(off + 12, true)
          const px = view.getFloat32(off + 16, true)
          const py = view.getFloat32(off + 20, true)
          const pz = view.getFloat32(off + 24, true)
          const sx = view.getFloat32(off + 28, true)
          const sy = view.getFloat32(off + 32, true)
          const sz = view.getFloat32(off + 36, true)
          frame.push({
            rotation: [qw, qx, qy, qz],
            position: [px, py, pz],
            scale: [sx, sy, sz],
          })
        }
        keyframes.push(frame)
      }
    }
  } else {
    // V1: AC11AC11 compressed animation
    keyframes = parseV1Animation(view, data, boneCount, frameCount, restPose)
  }

  return { fps, frameCount, boneCount, duration, name, isV0, isWorldSpace: !isV0, keyframes }
}

/**
 * V1 AC11AC11 compressed animation decoder.
 *
 * AC11 inner data layout (AC = 0x60):
 *   AC+0x00  dataSize      AC+0x10  boneCount     AC+0x20  count1 (segments)
 *   AC+0x08  magic 11AC    AC+0x14  lastFrame     AC+0x34  valA (rot entries)
 *   AC+0x0C  version       AC+0x18  fps           AC+0x38  valB (pos entries)
 *                                                  AC+0x3C  valC (scale entries)
 *   AC+0x40  SENTINEL (0xFFFFFFFF)
 *   AC+0x44  secOff[0..3]  — cumulative section sizes
 *
 * After section offsets:
 *   if count1 >= 2: count1 frame boundaries + SENTINEL
 *   count1 × 16B segment groups [bitsPerFrame, rotBits, otherBits, bodyOffset]
 *   Bitfield: (secOff[2] - secOff[1]) bytes, 2 bits per channel
 *     Channel-grouped: [R₀..Rₙ, T₀..Tₙ, S₀..Sₙ]
 *     0 = identity, 1 = constant, 2 = animated
 *   Constant data: valA × 12B (rotation xyz) + valB × 12B (position) + valC × 12B (scale)
 *   Animated headers: totalAnim × 24B [offset_xyz, scale_xyz]
 *
 * Per-segment body (at BASE + g[3]):
 *   totalAnim bytes: bit widths per channel
 *   Continuous LSB bitstream: segFrames × bitsPerFrame bits
 *   Dequantize: value = offset + (q / maxQ) × scale, maxQ = (1 << bw) - 1
 */

function parseV1Animation(
  view: DataView, data: Buffer | Uint8Array, boneCount: number, frameCount: number,
  restPose?: { worldPosition: V3; worldRotation: Q4; parentIndex: number }[]
): AnimKeyframe[][] | null {
  const AC = 0x60
  const BASE = AC + 0x20 // Reference base for segment offsets
  if (data.length < AC + 0x54) return null

  const u32 = (o: number) => view.getUint32(o, true)
  const f32 = (o: number) => view.getFloat32(o, true)

  const count1 = u32(AC + 0x20)
  const valA = u32(AC + 0x34)
  const valB = u32(AC + 0x38)
  const valC = u32(AC + 0x3C)

  // V1 inner header has its own bone count — use it for channel parsing
  const v1BoneCount = u32(AC + 0x10)
  const channelBoneCount = v1BoneCount

  if (channelBoneCount === 0 || channelBoneCount > 10000 || frameCount === 0) return null

  // Section offsets are relative to BASE (AC + 0x20 = 0x80), not dataStart
  // sec0: segGroups | sec1: bitfield | sec2: constants | sec3: animHeaders
  const dataStart = AC + 0x54
  const secOff0 = u32(AC + 0x44)
  const secOff1 = u32(AC + 0x48)
  const secOff2 = u32(AC + 0x4C)

  // Animated channel counts from header (cross-check with bitfield)
  const hdrTotalAnim = u32(AC + 0x24)
  const hdrRAnim = u32(AC + 0x28)
  const hdrTAnim = u32(AC + 0x2C)
  const hdrSAnim = u32(AC + 0x30)

  // Navigate past section offset array to data
  let cursor = dataStart

  // Section 0: Frame boundaries + extra data
  const frameBounds: number[] = []
  if (count1 >= 2) {
    for (let i = 0; i < count1; i++) { frameBounds.push(u32(cursor)); cursor += 4 }
    cursor += 4 // sentinel
  } else {
    frameBounds.push(0)
  }

  // Jump to segment groups (section offsets relative to BASE)
  cursor = BASE + secOff0

  // Segment groups — count1 × 16 bytes [bitsPerFrame, rotBits, otherBits, bodyOffset]
  const segGroups: [number, number, number, number][] = []
  for (let s = 0; s < count1; s++) {
    segGroups.push([u32(cursor), u32(cursor + 4), u32(cursor + 8), u32(cursor + 12)])
    cursor += 16
  }

  // Bitfield — at BASE + secOff1
  cursor = BASE + secOff1

  // Bitfield: secOff[2] - secOff[1] bytes
  const bitfieldSize = secOff2 - secOff1
  if (bitfieldSize < 0 || bitfieldSize > 1000) return null
  const bitfieldStart = cursor

  // Read 2-bit channel types MSB-first (channel-grouped: R₀..Rₙ, T₀..Tₙ, S₀..Sₙ)
  const channelTypes: number[] = []
  const wordCount = Math.ceil(bitfieldSize / 4)
  for (let w = 0; w < wordCount; w++) {
    const word = u32(bitfieldStart + w * 4)
    for (let i = 0; i < 16; i++) {
      channelTypes.push((word >>> (30 - i * 2)) & 3)
    }
  }

  // Extract per-bone channel types (per-group word-aligned layout)
  // Each group (R, T, S) occupies ceil(boneCount/16) uint32 words = stride entries
  const stride = Math.ceil(channelBoneCount / 16) * 16
  const rTypes: number[] = []
  const tTypes: number[] = []
  const sTypes: number[] = []
  for (let b = 0; b < channelBoneCount; b++) rTypes.push(channelTypes[b] ?? 0)
  for (let b = 0; b < channelBoneCount; b++) tTypes.push(channelTypes[stride + b] ?? 0)
  for (let b = 0; b < channelBoneCount; b++) sTypes.push(channelTypes[2 * stride + b] ?? 0)

  cursor = bitfieldStart + bitfieldSize

  // Read constant data
  const constRotations: [number, number, number, number][] = []
  for (let i = 0; i < valA; i++) {
    if (cursor + 12 > data.length) return null
    const x = f32(cursor)
    const y = f32(cursor + 4)
    const z = f32(cursor + 8)
    const sumSq = x * x + y * y + z * z
    const rw = sumSq <= 1.0 ? Math.sqrt(1.0 - sumSq) : 0
    const len = Math.sqrt(rw * rw + sumSq)
    if (len > 1e-10) {
      constRotations.push([rw / len, x / len, y / len, z / len])
    } else {
      constRotations.push([1, 0, 0, 0])
    }
    cursor += 12
  }

  const constPositions: [number, number, number][] = []
  for (let i = 0; i < valB; i++) {
    if (cursor + 12 > data.length) return null
    // Scale by 10 (undo 0.1 scale factor stored in format)
    constPositions.push([f32(cursor) * 10, f32(cursor + 4) * 10, f32(cursor + 8) * 10])
    cursor += 12
  }

  const constScales: [number, number, number][] = []
  for (let i = 0; i < valC; i++) {
    if (cursor + 12 > data.length) return null
    constScales.push([f32(cursor), f32(cursor + 4), f32(cursor + 8)])
    cursor += 12
  }

  // Count animated channels per type
  let rAnim = 0, tAnim = 0, sAnim = 0
  for (let b = 0; b < channelBoneCount; b++) {
    if (rTypes[b] === 2) rAnim++
    if (tTypes[b] === 2) tAnim++
    if (sTypes[b] === 2) sAnim++
  }
  const totalAnim = rAnim + tAnim + sAnim

  const secOff3 = u32(AC + 0x50)

  // V1 decode summary
  log(`  V1: bones=${channelBoneCount} segs=${count1} frames=${frameCount} anim=[R${rAnim} T${tAnim} S${sAnim}]=${totalAnim}`)

  // Read animated channel headers from BASE + secOff3
  // 24 bytes each: [offset_xyz, scale_xyz]
  // Use header-derived totalAnim for count
  cursor = BASE + secOff3
  const animHeaders: { offset: [number, number, number]; scale: [number, number, number] }[] = []
  for (let i = 0; i < hdrTotalAnim; i++) {
    if (cursor + 24 > data.length) break
    animHeaders.push({
      offset: [f32(cursor), f32(cursor + 4), f32(cursor + 8)],
      scale: [f32(cursor + 12), f32(cursor + 16), f32(cursor + 20)],
    })
    cursor += 24
  }


  // Build per-bone channel source mappings
  // Maps each bone to its constant or animated channel index
  const boneRotSrc: { type: number; idx: number }[] = []
  const bonePosSrc: { type: number; idx: number }[] = []
  const boneSclSrc: { type: number; idx: number }[] = []
  let cri = 0, cpi = 0, csi = 0 // constant indices
  let ari = 0, api = 0, asi = 0 // animated indices

  for (let b = 0; b < channelBoneCount; b++) {
    if (rTypes[b] === 1) boneRotSrc.push({ type: 1, idx: cri++ })
    else if (rTypes[b] === 2) boneRotSrc.push({ type: 2, idx: ari++ })
    else boneRotSrc.push({ type: 0, idx: b })

    if (tTypes[b] === 1) bonePosSrc.push({ type: 1, idx: cpi++ })
    else if (tTypes[b] === 2) bonePosSrc.push({ type: 2, idx: api++ })
    else bonePosSrc.push({ type: 0, idx: b })

    if (sTypes[b] === 2) {
      boneSclSrc.push({ type: 2, idx: asi++ })
    } else if (valC === channelBoneCount) {
      // valC=boneCount: constant scale array has one entry per bone, indexed by bone index
      boneSclSrc.push({ type: 1, idx: b })
    } else if (sTypes[b] === 1) {
      boneSclSrc.push({ type: 1, idx: csi++ })
    } else {
      boneSclSrc.push({ type: 0, idx: b })
    }
  }

  // Pre-build the base frame in WORLD SPACE
  // V1 format stores world-space transforms: type-0 uses rest-pose world,
  // type-1 uses constant world values, type-2 will be overwritten per-frame
  const baseRot: Q4[] = []
  const basePos: V3[] = []
  const baseScl: V3[] = []

  for (let b = 0; b < channelBoneCount; b++) {
    const rs = boneRotSrc[b]
    if (rs.type === 1 && rs.idx < constRotations.length) {
      // Constant world rotation (already in [w,x,y,z])
      baseRot.push(constRotations[rs.idx])
    } else if (restPose && restPose[b]) {
      // Rest-pose WORLD rotation (skeleton stores [x,y,z,w], convert to [w,x,y,z])
      const wr = restPose[b].worldRotation
      baseRot.push([wr[3], wr[0], wr[1], wr[2]])
    } else {
      baseRot.push([1, 0, 0, 0])
    }

    const ps = bonePosSrc[b]
    if (ps.type === 1 && ps.idx < constPositions.length) {
      // Constant world position (already ×10 from decode)
      basePos.push(constPositions[ps.idx])
    } else if (restPose && restPose[b]) {
      // Rest-pose WORLD position
      basePos.push([...restPose[b].worldPosition])
    } else {
      basePos.push([0, 0, 0])
    }

    baseScl.push([1, 1, 1])
  }

  // Initialize all frames with base (constant/rest) pose
  const keyframes: AnimKeyframe[][] = []
  for (let f = 0; f < frameCount; f++) {
    const frame: AnimKeyframe[] = []
    for (let b = 0; b < channelBoneCount; b++) {
      frame.push({
        rotation: baseRot[b],
        position: basePos[b],
        scale: baseScl[b],
      })
    }
    keyframes.push(frame)
  }

  // If no animated channels, we're done
  if (totalAnim === 0) return keyframes

  // Build reverse lookup: animated channel index → bone index
  // Channel ordering: [rAnim rotation, tAnim position, sAnim scale]
  const channelToBone = new Int32Array(totalAnim)
  // channelType: 0=rotation, 1=position, 2=scale
  const channelKind = new Uint8Array(totalAnim)

  for (let b = 0; b < channelBoneCount; b++) {
    if (boneRotSrc[b].type === 2) {
      const ch = boneRotSrc[b].idx
      channelToBone[ch] = b
      channelKind[ch] = 0
    }
    if (bonePosSrc[b].type === 2) {
      const ch = rAnim + bonePosSrc[b].idx
      channelToBone[ch] = b
      channelKind[ch] = 1
    }
    if (boneSclSrc[b].type === 2) {
      const ch = rAnim + tAnim + boneSclSrc[b].idx
      channelToBone[ch] = b
      channelKind[ch] = 2
    }
  }

  // Decode per-segment body data for animated channels
  for (let seg = 0; seg < count1; seg++) {
    const g = segGroups[seg]
    if (g[0] === 0) continue // No animated bits this segment

    const segStart = frameBounds[seg]
    const segEnd = seg < count1 - 1 ? frameBounds[seg + 1] : frameCount
    const segFrames = segEnd - segStart
    if (segFrames <= 0) continue

    const bodyStart = BASE + g[3]
    if (bodyStart + totalAnim >= data.length) continue

    // Read per-channel bit widths for this segment
    const bw = new Uint8Array(totalAnim)
    for (let i = 0; i < totalAnim; i++) bw[i] = data[bodyStart + i]

    // Body layout: [bit widths (totalAnim B)] [init data] [bitstream]
    // Compute bitstream position backwards from known body end
    const bitsPerFrame = bw.reduce((a: number, b: number) => a + b, 0) * 3
    const bitstreamBytes = Math.ceil(bitsPerFrame * segFrames / 8)
    // Compute bitstream start by working backwards from known body end
    // Body layout: [bit widths] [init data (variable)] [bitstream]
    const bodyEnd = seg < count1 - 1
      ? BASE + segGroups[seg + 1][3]       // next segment's body start
      : AC + u32(AC + 0x00)                // end of V1 data block
    const bsStart = bodyEnd - bitstreamBytes
    let bitPos = 0

    // Decode each frame in this segment
    for (let f = 0; f < segFrames; f++) {
      const frameIdx = segStart + f
      if (frameIdx >= frameCount) break
      const kf = keyframes[frameIdx]

      // Read all animated channels for this frame
      for (let ch = 0; ch < totalAnim; ch++) {
        const w = bw[ch]
        const h = animHeaders[ch]
        if (!h) continue

        let vx: number, vy: number, vz: number

        if (w === 0) {
          // 0-bit channel: constant at offset for this segment
          vx = h.offset[0]
          vy = h.offset[1]
          vz = h.offset[2]
        } else {
          // Inline LSB bit read for 3 components
          let qx = 0, qy = 0, qz = 0
          for (let i = 0; i < w; i++) {
            const p = bitPos + i
            qx |= ((data[bsStart + (p >> 3)] >> (p & 7)) & 1) << i
          }
          bitPos += w
          for (let i = 0; i < w; i++) {
            const p = bitPos + i
            qy |= ((data[bsStart + (p >> 3)] >> (p & 7)) & 1) << i
          }
          bitPos += w
          for (let i = 0; i < w; i++) {
            const p = bitPos + i
            qz |= ((data[bsStart + (p >> 3)] >> (p & 7)) & 1) << i
          }
          bitPos += w

          const maxQ = (1 << w) - 1
          vx = h.offset[0] + (qx / maxQ) * h.scale[0]
          vy = h.offset[1] + (qy / maxQ) * h.scale[1]
          vz = h.offset[2] + (qz / maxQ) * h.scale[2]
        }

        const boneIdx = channelToBone[ch]
        const kind = channelKind[ch]

        if (kind === 0) {
          // Rotation: quaternion smallest-3, reconstruct w then normalize
          const sumSq = vx * vx + vy * vy + vz * vz
          const rw = sumSq <= 1.0 ? Math.sqrt(1.0 - sumSq) : 0
          const len = Math.sqrt(rw * rw + sumSq)
          if (len > 1e-10) {
            kf[boneIdx] = { rotation: [rw / len, vx / len, vy / len, vz / len], position: kf[boneIdx].position, scale: kf[boneIdx].scale }
          } else {
            kf[boneIdx] = { rotation: [1, 0, 0, 0], position: kf[boneIdx].position, scale: kf[boneIdx].scale }
          }
        } else if (kind === 1) {
          // Position: scale by 10 (undo 0.1 scale factor stored in format)
          kf[boneIdx] = { rotation: kf[boneIdx].rotation, position: [vx * 10, vy * 10, vz * 10], scale: kf[boneIdx].scale }
        } else {
          // Scale
          kf[boneIdx] = { rotation: kf[boneIdx].rotation, position: kf[boneIdx].position, scale: [vx, vy, vz] }
        }
      }
    }
  }

  // V1 keyframes are in WORLD space — return as-is for direct use by the viewer
  return keyframes
}
