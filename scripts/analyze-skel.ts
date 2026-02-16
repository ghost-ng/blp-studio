#!/usr/bin/env npx tsx
/**
 * Deep analysis of RootNode skeleton format.
 * Reads an extracted .skel file and dumps per-bone record details.
 */

import { readFileSync } from 'fs'
import { resolve } from 'path'

const [,, skelPath] = process.argv
if (!skelPath) {
  console.error('Usage: npx tsx scripts/analyze-skel.ts <file.skel>')
  process.exit(1)
}

const data = readFileSync(resolve(skelPath))
const view = new DataView(data.buffer, data.byteOffset, data.byteLength)

const magic = data.subarray(0, 8).toString('ascii').replace(/\0/g, '')
console.log(`File: ${skelPath}`)
console.log(`Size: ${data.length} bytes`)
console.log(`Magic: "${magic}"`)

// Detect bone stride by finding name-like strings and computing distances
const nameOffsets: number[] = []
for (let off = 0; off < Math.min(data.length, 32768); off++) {
  // Look for strings that start at an offset and are preceded by non-ASCII or null
  if (off > 0 && data[off - 1] !== 0) continue
  const end = data.indexOf(0, off)
  if (end <= off || end - off < 3 || end - off > 64) continue
  const str = data.subarray(off, end).toString('ascii')
  if (/^[A-Za-z][A-Za-z0-9_]{2,}$/.test(str)) {
    nameOffsets.push(off)
  }
}

// Calculate stride from consecutive name offsets
const strides: number[] = []
for (let i = 1; i < nameOffsets.length && i < 20; i++) {
  strides.push(nameOffsets[i] - nameOffsets[i - 1])
}
const uniqueStrides = [...new Set(strides)]
console.log(`\nName offsets (first 20): ${nameOffsets.slice(0, 20).map(o => '0x' + o.toString(16)).join(', ')}`)
console.log(`Strides between names: ${uniqueStrides.map(s => `${s} (0x${s.toString(16)})`).join(', ')}`)

// Most common stride
const stride = uniqueStrides.length === 1 ? uniqueStrides[0] : 0
if (stride === 0) {
  console.log('Cannot determine consistent stride. Strides:', strides)
}

const boneCount = stride > 0 ? Math.floor(data.length / stride) : 0
console.log(`Stride: ${stride} bytes (0x${stride.toString(16)})`)
console.log(`Total records: ${boneCount} (${data.length} / ${stride})`)

// Determine where the name sits within each record
const nameWithinRecord = stride > 0 ? nameOffsets[0] % stride : 0
console.log(`Name offset within record: 0x${nameWithinRecord.toString(16)}`)

// Now dump each bone record in detail
console.log(`\n${'='.repeat(80)}`)
console.log('PER-BONE RECORD ANALYSIS')
console.log(`${'='.repeat(80)}`)

const MAX_BONES = Math.min(boneCount, 10)
for (let bone = 0; bone < MAX_BONES; bone++) {
  const base = bone * stride

  // Extract name
  const nameStart = base + nameWithinRecord
  const nameEnd = data.indexOf(0, nameStart)
  const name = nameEnd > nameStart ? data.subarray(nameStart, Math.min(nameEnd, nameStart + 64)).toString('ascii') : '???'

  console.log(`\n--- Bone ${bone}: "${name}" (record at 0x${base.toString(16)}) ---`)

  // Dump all float32 values in this record
  console.log(`  Float32 values:`)
  for (let off = 0; off + 4 <= stride; off += 4) {
    const absOff = base + off
    if (absOff + 4 > data.length) break
    const f = view.getFloat32(absOff, true)
    const i32 = view.getInt32(absOff, true)
    const u32 = view.getUint32(absOff, true)
    const i16a = view.getInt16(absOff, true)
    const i16b = view.getInt16(absOff + 2, true)

    // Only show non-zero values to reduce noise
    if (u32 === 0) continue

    // Check if it looks like a valid float
    const isFloat = isFinite(f) && Math.abs(f) < 100000 && Math.abs(f) > 0.00001
    const isAscii = data[absOff] >= 0x20 && data[absOff] < 0x7F

    let desc = ''
    if (isFloat) desc += `f32=${f.toFixed(6)} `
    desc += `i32=${i32} u32=0x${u32.toString(16).padStart(8, '0')} i16=[${i16a}, ${i16b}]`
    if (isAscii) {
      const chars = data.subarray(absOff, Math.min(absOff + 4, data.length))
      desc += ` ascii="${Array.from(chars).map(b => b >= 0x20 && b < 0x7F ? String.fromCharCode(b) : '.').join('')}"`
    }

    console.log(`    +0x${off.toString(16).padStart(3, '0')}: ${desc}`)
  }
}

// Now try to identify the parent index field
// Look for small integer patterns across all bones
console.log(`\n${'='.repeat(80)}`)
console.log('PARENT INDEX SEARCH')
console.log(`${'='.repeat(80)}`)

// For each offset within a record, check if the values look like parent indices
for (let fieldOff = 0; fieldOff + 2 <= stride; fieldOff += 2) {
  const values16: number[] = []
  const values32: number[] = []

  let valid16 = true
  let valid32 = fieldOff + 4 <= stride

  for (let bone = 0; bone < boneCount; bone++) {
    const absOff = bone * stride + fieldOff
    if (absOff + 2 > data.length) { valid16 = false; break }

    const v16 = view.getInt16(absOff, true)
    values16.push(v16)
    if (v16 < -1 || v16 >= boneCount) valid16 = false

    if (valid32 && absOff + 4 <= data.length) {
      const v32 = view.getInt32(absOff, true)
      values32.push(v32)
      if (v32 < -1 || v32 >= boneCount) valid32 = false
    }
  }

  // Check if root bone has parent -1 and others have valid parent indices
  if (valid16 && values16.length === boneCount) {
    const hasRoot = values16.filter(v => v === -1).length >= 1
    const hasSequential = values16.some((v, i) => i > 0 && v === i - 1)
    if (hasRoot && hasSequential) {
      console.log(`\n  ** LIKELY int16 parent array at field offset +0x${fieldOff.toString(16)} **`)
      console.log(`     Values: [${values16.slice(0, 30).join(', ')}${values16.length > 30 ? '...' : ''}]`)
      console.log(`     Root count: ${values16.filter(v => v === -1).length}`)
    }
  }

  if (valid32 && values32.length === boneCount) {
    const hasRoot = values32.filter(v => v === -1).length >= 1
    const hasSequential = values32.some((v, i) => i > 0 && v === i - 1)
    if (hasRoot && hasSequential) {
      console.log(`\n  ** LIKELY int32 parent array at field offset +0x${fieldOff.toString(16)} **`)
      console.log(`     Values: [${values32.slice(0, 30).join(', ')}${values32.length > 30 ? '...' : ''}]`)
    }
  }
}

// Identify transform fields - look for quaternion patterns
console.log(`\n${'='.repeat(80)}`)
console.log('TRANSFORM FIELD SEARCH')
console.log(`${'='.repeat(80)}`)

for (let fieldOff = 0; fieldOff + 16 <= stride; fieldOff += 4) {
  let quatCount = 0
  let identityCount = 0

  for (let bone = 0; bone < boneCount; bone++) {
    const absOff = bone * stride + fieldOff
    if (absOff + 16 > data.length) break

    const x = view.getFloat32(absOff, true)
    const y = view.getFloat32(absOff + 4, true)
    const z = view.getFloat32(absOff + 8, true)
    const w = view.getFloat32(absOff + 12, true)

    if (!isFinite(x) || !isFinite(y) || !isFinite(z) || !isFinite(w)) continue

    const mag = Math.sqrt(x*x + y*y + z*z + w*w)
    if (mag > 0.95 && mag < 1.05) {
      quatCount++
      if (Math.abs(w - 1) < 0.01 || Math.abs(x - 1) < 0.01) identityCount++
    }
  }

  if (quatCount > boneCount * 0.5) {
    console.log(`\n  ** Quaternion field at +0x${fieldOff.toString(16)} ** (${quatCount}/${boneCount} valid, ${identityCount} identity)`)
    // Print first 5 values
    for (let bone = 0; bone < Math.min(5, boneCount); bone++) {
      const absOff = bone * stride + fieldOff
      if (absOff + 16 > data.length) break
      const x = view.getFloat32(absOff, true)
      const y = view.getFloat32(absOff + 4, true)
      const z = view.getFloat32(absOff + 8, true)
      const w = view.getFloat32(absOff + 12, true)
      console.log(`     Bone ${bone}: [${x.toFixed(6)}, ${y.toFixed(6)}, ${z.toFixed(6)}, ${w.toFixed(6)}]`)
    }
  }
}

// Look for position-like float triplets (values between -1000 and 1000)
console.log(`\n${'='.repeat(80)}`)
console.log('POSITION FIELD SEARCH (float32 triplets)')
console.log(`${'='.repeat(80)}`)

for (let fieldOff = 0; fieldOff + 12 <= stride; fieldOff += 4) {
  let validCount = 0
  let zeroCount = 0

  for (let bone = 0; bone < boneCount; bone++) {
    const absOff = bone * stride + fieldOff
    if (absOff + 12 > data.length) break

    const x = view.getFloat32(absOff, true)
    const y = view.getFloat32(absOff + 4, true)
    const z = view.getFloat32(absOff + 8, true)

    if (isFinite(x) && isFinite(y) && isFinite(z) && Math.abs(x) < 1000 && Math.abs(y) < 1000 && Math.abs(z) < 1000) {
      validCount++
      if (x === 0 && y === 0 && z === 0) zeroCount++
    }
  }

  // Show if most values are valid and not all zero
  if (validCount === boneCount && zeroCount < boneCount * 0.8) {
    console.log(`\n  ** Position field at +0x${fieldOff.toString(16)} ** (${validCount}/${boneCount} valid, ${zeroCount} zero)`)
    for (let bone = 0; bone < Math.min(5, boneCount); bone++) {
      const absOff = bone * stride + fieldOff
      if (absOff + 12 > data.length) break
      const x = view.getFloat32(absOff, true)
      const y = view.getFloat32(absOff + 4, true)
      const z = view.getFloat32(absOff + 8, true)
      console.log(`     Bone ${bone}: [${x.toFixed(6)}, ${y.toFixed(6)}, ${z.toFixed(6)}]`)
    }
  }
}

// Summary: compact view of all bone names and likely parents
console.log(`\n${'='.repeat(80)}`)
console.log('FULL BONE LIST')
console.log(`${'='.repeat(80)}`)

for (let bone = 0; bone < boneCount; bone++) {
  const base = bone * stride
  const nameStart = base + nameWithinRecord
  const nameEnd = data.indexOf(0, nameStart)
  const name = nameEnd > nameStart ? data.subarray(nameStart, Math.min(nameEnd, nameStart + 64)).toString('ascii') : '???'
  console.log(`  ${bone.toString().padStart(3)}: ${name}`)
}
