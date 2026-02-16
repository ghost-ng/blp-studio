#!/usr/bin/env npx tsx
/**
 * Compare V0 and V1 animation data for the same skeleton.
 * Extracts V0 bone data as ground truth, then searches for corresponding
 * values in V1 data to understand the compression scheme.
 */

import { readFileSync, readdirSync } from 'fs'
import { resolve, join } from 'path'

const ANIM_MAGIC = 0x6AB06AB0

function main() {
  const dir = resolve(process.argv[2] || '')

  // Load all anims
  const files = readdirSync(dir).filter(f => f.endsWith('.anim'))
  const anims: { name: string, data: Buffer, isV0: boolean, bones: number, frames: number, skeleton: string }[] = []

  for (const f of files) {
    const data = readFileSync(join(dir, f))
    if (data.length < 96) continue
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
    if (view.getUint32(0, true) !== ANIM_MAGIC) continue
    const isV0 = view.getUint32(0x48, true) === 0xFFFFFFFF
    const bones = isV0 ? view.getUint32(0x10, true) : (view.getUint32(0x10, true) & 0xFFFF)
    const frames = view.getUint32(0x0C, true)
    // Extract skeleton name: everything before the last underscore-separated part
    const baseName = f.replace('BLOB_', '').replace('.anim', '')
    // For "Ant3_Med_Siege01_Idle01", skeleton = "Ant3_Med_Siege01"
    const parts = baseName.split('_')
    const skeleton = parts.slice(0, -1).join('_') // drop last part (action name)
    anims.push({ name: f, data, isV0, bones, frames, skeleton })
  }

  const v0 = anims.filter(a => a.isV0)
  const v1 = anims.filter(a => !a.isV0)

  // Find V0/V1 pairs with same skeleton
  const v0Map = new Map<string, typeof anims[0][]>()
  for (const a of v0) {
    const key = a.skeleton
    if (!v0Map.has(key)) v0Map.set(key, [])
    v0Map.get(key)!.push(a)
  }

  console.log('V0 skeletons:', [...v0Map.keys()])

  for (const [skel, v0Anims] of v0Map) {
    const v1Match = v1.filter(a => a.skeleton === skel)
    if (v1Match.length === 0) continue

    console.log(`\n${'='.repeat(80)}`)
    console.log(`Skeleton: ${skel} (${v0Anims[0].bones} bones)`)
    console.log(`  V0: ${v0Anims.map(a => a.name).join(', ')}`)
    console.log(`  V1: ${v1Match.map(a => a.name).join(', ')}`)

    const ref = v0Anims[0]
    const refView = new DataView(ref.data.buffer, ref.data.byteOffset, ref.data.byteLength)
    const boneCount = ref.bones

    // Extract V0 frame 0 data
    console.log(`\nV0 Reference: ${ref.name} (${boneCount} bones, ${ref.frames} frames)`)
    console.log('Frame 0 bone data:')
    const v0Bones: { rot: number[], pos: number[], scale: number[] }[] = []
    for (let b = 0; b < boneCount; b++) {
      const off = 0x60 + b * 40
      const qw = refView.getFloat32(off, true)
      const qx = refView.getFloat32(off + 4, true)
      const qy = refView.getFloat32(off + 8, true)
      const qz = refView.getFloat32(off + 12, true)
      const px = refView.getFloat32(off + 16, true)
      const py = refView.getFloat32(off + 20, true)
      const pz = refView.getFloat32(off + 24, true)
      const sx = refView.getFloat32(off + 28, true)
      const sy = refView.getFloat32(off + 32, true)
      const sz = refView.getFloat32(off + 36, true)
      v0Bones.push({ rot: [qw, qx, qy, qz], pos: [px, py, pz], scale: [sx, sy, sz] })
      console.log(`  bone[${b}]: q=[${[qw, qx, qy, qz].map(v => v.toFixed(6)).join(',')}] p=[${[px, py, pz].map(v => v.toFixed(6)).join(',')}] s=[${[sx, sy, sz].map(v => v.toFixed(6)).join(',')}]`)
    }

    // Check if V0 has constant bones (same across all frames)
    console.log(`\nConstant bone analysis (V0):`)
    for (let b = 0; b < boneCount; b++) {
      const ref0 = v0Bones[b]
      let rotConst = true, posConst = true, scaleConst = true
      for (let f = 1; f < ref.frames; f++) {
        const off = 0x60 + (f * boneCount + b) * 40
        if (off + 40 > ref.data.length) break
        const qw = refView.getFloat32(off, true)
        const qx = refView.getFloat32(off + 4, true)
        const qy = refView.getFloat32(off + 8, true)
        const qz = refView.getFloat32(off + 12, true)
        if (Math.abs(qw - ref0.rot[0]) > 0.001 || Math.abs(qx - ref0.rot[1]) > 0.001 ||
            Math.abs(qy - ref0.rot[2]) > 0.001 || Math.abs(qz - ref0.rot[3]) > 0.001) {
          rotConst = false
          break
        }
        const px = refView.getFloat32(off + 16, true)
        const py = refView.getFloat32(off + 20, true)
        const pz = refView.getFloat32(off + 24, true)
        if (Math.abs(px - ref0.pos[0]) > 0.001 || Math.abs(py - ref0.pos[1]) > 0.001 ||
            Math.abs(pz - ref0.pos[2]) > 0.001) posConst = false
        const sx = refView.getFloat32(off + 28, true)
        const sy = refView.getFloat32(off + 32, true)
        const sz = refView.getFloat32(off + 36, true)
        if (Math.abs(sx - ref0.scale[0]) > 0.001 || Math.abs(sy - ref0.scale[1]) > 0.001 ||
            Math.abs(sz - ref0.scale[2]) > 0.001) scaleConst = false
      }
      console.log(`  bone[${b}]: rot=${rotConst ? 'CONST' : 'anim'} pos=${posConst ? 'CONST' : 'anim'} scale=${scaleConst ? 'CONST' : 'anim'}`)
    }

    // Now analyze V1 match
    const target = v1Match[0]
    const tView = new DataView(target.data.buffer, target.data.byteOffset, target.data.byteLength)
    const tArr = new Uint8Array(target.data.buffer, target.data.byteOffset, target.data.byteLength)

    console.log(`\nV1 Target: ${target.name} (${target.bones} bones, ${target.frames} frames, ${target.data.length} bytes)`)

    // Search for V0 bone values in V1 data
    console.log(`\nSearching for V0 bone position values in V1 data:`)
    for (let b = 0; b < boneCount; b++) {
      const pos = v0Bones[b].pos
      for (let c = 0; c < 3; c++) {
        if (Math.abs(pos[c]) < 0.001) continue // skip zeros
        // Search for this float in V1
        const targetVal = pos[c]
        for (let off = 0x60; off + 4 <= target.data.length; off += 4) {
          const val = tView.getFloat32(off, true)
          if (Math.abs(val - targetVal) < 0.01) {
            console.log(`  bone[${b}].pos[${c}]=${targetVal.toFixed(4)} found at V1 offset ${off.toString(16).padStart(4, '0')}`)
          }
        }
      }
    }

    // Search for V0 rotation values in V1 data
    console.log(`\nSearching for V0 bone rotation values in V1 data:`)
    for (let b = 0; b < boneCount; b++) {
      const rot = v0Bones[b].rot
      // Only search non-trivial components
      for (let c = 0; c < 4; c++) {
        if (Math.abs(rot[c]) < 0.01 || Math.abs(Math.abs(rot[c]) - 1.0) < 0.01) continue
        const targetVal = rot[c]
        for (let off = 0x60; off + 4 <= target.data.length; off += 4) {
          const val = tView.getFloat32(off, true)
          if (Math.abs(val - targetVal) < 0.01) {
            console.log(`  bone[${b}].rot[${c}]=${targetVal.toFixed(6)} found at V1 offset ${off.toString(16).padStart(4, '0')}`)
          }
        }
      }
    }

    break // Only process first matching skeleton
  }
}

main()
