#!/usr/bin/env npx tsx
/**
 * Full binary trace of a V1 animation file.
 * Dumps every u32/f32 from start to end with annotations.
 *
 * Usage: npx tsx scripts/trace-v1.ts <file.anim>
 *    or: npx tsx scripts/trace-v1.ts <dir> [index]
 */

import { readFileSync, readdirSync, statSync } from 'fs'
import { resolve, join } from 'path'

const ANIM_MAGIC = 0x6AB06AB0

function main() {
  const path = resolve(process.argv[2] || '')
  const idx = parseInt(process.argv[3] || '0')

  let data: Buffer
  if (statSync(path).isDirectory()) {
    // Find V1 anims with 10+ bones, sort by size
    const files = readdirSync(path)
      .filter(f => f.endsWith('.anim'))
      .map(f => {
        const d = readFileSync(join(path, f))
        if (d.length < 96) return null
        const v = new DataView(d.buffer, d.byteOffset, d.byteLength)
        if (v.getUint32(0, true) !== ANIM_MAGIC) return null
        const isV0 = v.getUint32(0x48, true) === 0xFFFFFFFF
        if (isV0) return null
        const bones = v.getUint32(0x10, true) & 0xFFFF
        const frames = v.getUint32(0x0C, true)
        return { name: f, data: d, bones, frames }
      })
      .filter(Boolean)
      .filter(f => f!.bones >= 10 && f!.bones <= 30 && f!.frames >= 10)
      .sort((a, b) => a!.data.length - b!.data.length) as { name: string, data: Buffer, bones: number, frames: number }[]

    console.log(`Found ${files.length} V1 anims with 10-30 bones, 10+ frames:`)
    for (const f of files.slice(0, 15)) {
      console.log(`  ${f.name}: ${f.bones} bones, ${f.frames} frames, ${f.data.length} bytes`)
    }
    if (files.length === 0) { console.log('No suitable files'); return }
    const chosen = files[Math.min(idx, files.length - 1)]
    console.log(`\nTracing: ${chosen.name}`)
    data = chosen.data
  } else {
    data = readFileSync(path)
  }

  trace(data)
}

function trace(data: Buffer) {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const arr = new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
  const u32 = (o: number) => view.getUint32(o, true)
  const i32 = (o: number) => view.getInt32(o, true)
  const f32 = (o: number) => view.getFloat32(o, true)
  const u16 = (o: number) => view.getUint16(o, true)

  // Outer header
  console.log(`\nFILE SIZE: ${data.length} bytes`)
  console.log(`\n=== OUTER HEADER (0x00-0x5F) ===`)
  const labels0: Record<number, string> = {
    0x00: 'magic',
    0x04: 'flags',
    0x08: 'fps',
    0x0C: 'frameCount',
    0x10: 'boneField',
    0x14: '?',
    0x18: '?',
    0x1C: '?',
    0x20: '?',
    0x24: '?',
    0x28: 'dataRegionSize',
    0x2C: '?',
    0x30: 'outerCount',
    0x34: '?',
    0x38: '?',
    0x3C: '?',
    0x40: '?',
    0x44: '?',
    0x48: 'dataStart',
    0x4C: '?',
    0x50: 'nameOff',
    0x54: '?',
    0x58: '?',
    0x5C: '?',
  }
  for (let off = 0; off < 0x60; off += 4) {
    const val = u32(off)
    const fval = f32(off)
    const fStr = isFinite(fval) && Math.abs(fval) > 1e-10 && Math.abs(fval) < 1e10 ? fval.toFixed(6) : ''
    console.log(`  ${off.toString(16).padStart(4, '0')}: ${val.toString().padStart(12)} ${hex(val)} ${fStr.padStart(14)} | ${labels0[off] || ''}`)
  }

  const frameCount = u32(0x0C)
  const boneField = u32(0x10)
  const boneCount = boneField & 0xFFFF
  const nameOff = u32(0x50)

  // Read name
  let animName = ''
  if (nameOff > 0 && nameOff < data.length) {
    const end = arr.indexOf(0, nameOff)
    if (end > nameOff) animName = String.fromCharCode(...arr.subarray(nameOff, Math.min(end, nameOff + 128)))
  }
  console.log(`  Name: "${animName}"`)

  // AC11 data region: 0x60 to 0x60 + dataSize
  const AC = 0x60
  const dataSize = u32(AC)
  const dataEnd = AC + dataSize
  console.log(`\n=== AC11 DATA REGION (0x60 to ${hex(dataEnd)}, ${dataSize} bytes) ===`)

  // Dump every u32 with float interpretation
  console.log(`\n--- Full u32 dump of AC11 region ---`)
  const labels60: Record<number, string> = {
    0x60: 'dataSize',
    0x64: 'hash',
    0x68: 'magic (AC11AC11)',
    0x6C: 'version',
    0x70: 'boneCount',
    0x74: 'lastFrame',
    0x78: 'fps',
    0x7C: 'field_7C',
    0x80: 'count1',
    0x84: 'count2',
    0x88: 'count3',
    0x8C: 'count4',
    0x90: 'zero_90',
  }

  const count1 = u32(0x80)
  const count2 = u32(0x84)
  const count3 = u32(0x88)
  const count4 = u32(0x8C)

  for (let off = AC; off < dataEnd && off + 4 <= data.length; off += 4) {
    const val = u32(off)
    const fval = f32(off)
    const fStr = isFinite(fval) && Math.abs(fval) > 1e-10 && Math.abs(fval) < 1e10 ? fval.toFixed(6) : ''
    const isSentinel = val === 0xFFFFFFFF
    const label = labels60[off] || ''

    // Try to detect quaternion-like float patterns
    let tag = ''
    if (isSentinel) tag = '← SENTINEL'
    if (off >= 0x94 && off < 0x94 + 12 && !label) {
      const relIdx = (off - 0x94) / 4
      tag = ['count5?', 'count6?', 'boneCount2?'][relIdx] || ''
    }

    console.log(`  ${off.toString(16).padStart(4, '0')}: ${val.toString().padStart(12)} ${hex(val)} ${fStr.padStart(14)} | ${label || tag}`)
  }

  // Hex dump of full AC11 region
  console.log(`\n--- Hex dump ---`)
  for (let off = AC; off < dataEnd; off += 16) {
    const end = Math.min(off + 16, dataEnd)
    const bytes = arr.subarray(off, end)
    const hexParts: string[] = []
    for (let i = 0; i < 16; i++) hexParts.push(i < bytes.length ? bytes[i].toString(16).padStart(2, '0') : '  ')
    let ascii = ''
    for (const b of bytes) ascii += b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : '.'
    console.log(`  ${off.toString(16).padStart(4, '0')}  ${hexParts.slice(0, 8).join(' ')}  ${hexParts.slice(8).join(' ')}  |${ascii}|`)
  }

  // Tail data (after AC11 data, before name)
  if (nameOff > dataEnd) {
    console.log(`\n--- Tail data (${hex(dataEnd)} to ${hex(nameOff)}, ${nameOff - dataEnd} bytes) ---`)
    for (let off = dataEnd; off + 4 <= nameOff; off += 4) {
      const val = u32(off)
      const fval = f32(off)
      const fStr = isFinite(fval) && Math.abs(fval) > 1e-10 && Math.abs(fval) < 1e10 ? fval.toFixed(6) : ''
      console.log(`  ${off.toString(16).padStart(4, '0')}: ${val.toString().padStart(12)} ${hex(val)} ${fStr.padStart(14)}`)
    }
  }

  console.log(`\n=== SUMMARY ===`)
  console.log(`  boneCount: ${boneCount}, frameCount: ${frameCount}, fps: ${f32(0x08)}`)
  console.log(`  count1: ${count1}, count2: ${count2}, count3: ${count3}, count4: ${count4}`)
  console.log(`  count5?: ${u32(0x94)}, count6?: ${u32(0x98)}, boneCount2?: ${u32(0x9C)}`)
  console.log(`  count1+count5+count6 = ${count1 + u32(0x94) + u32(0x98)}`)
  console.log(`  AC11 dataSize: ${dataSize}`)
  console.log(`  Name offset: ${hex(nameOff)} → "${animName}"`)

  // Try to find sentinel in track table
  console.log(`\n--- Looking for 0xFFFFFFFF sentinels in data ---`)
  for (let off = AC; off < dataEnd; off += 4) {
    if (u32(off) === 0xFFFFFFFF) {
      console.log(`  Sentinel at ${hex(off)} (relative to AC: ${off - AC})`)
    }
  }

  // What's special about the LAST 47 bytes?
  const last47 = dataEnd - 47
  console.log(`\n--- Last 47 bytes (${hex(last47)} to ${hex(dataEnd)}) ---`)
  for (let off = last47; off + 4 <= dataEnd; off += 4) {
    const fval = f32(off)
    const fStr = isFinite(fval) && Math.abs(fval) > 1e-10 && Math.abs(fval) < 1e10 ? fval.toFixed(6) : ''
    console.log(`  ${off.toString(16).padStart(4, '0')}: ${hex(u32(off))} ${fStr}`)
  }
}

function hex(v: number, pad = 8) { return '0x' + (v >>> 0).toString(16).padStart(pad, '0').toUpperCase() }

main()
