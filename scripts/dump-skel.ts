#!/usr/bin/env npx tsx
/**
 * Extract and analyze skeleton (.skel) blobs from a BLP file.
 * Usage: npx tsx scripts/dump-skel.ts <file.blp> [asset-name]
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { resolve, join, basename } from 'path'
import { BLPParser } from '../src/core/blp-parser'
import { readCivbig } from '../src/core/civbig'
import { OodleDecompressor } from '../src/core/oodle'
import { findOodleCandidates, findAllSharedData, findGameRootFromPath, findSharedDataCandidates, buildSharedDataIndex } from '../src/core/game-detect'

function hexdump(data: Buffer | Uint8Array, maxRows = 32, startOffset = 0): void {
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

const [, , blpPath, targetName] = process.argv
if (!blpPath) {
  console.error('Usage: npx tsx scripts/dump-skel.ts <file.blp> [asset-name]')
  process.exit(1)
}

const filepath = resolve(blpPath)
const parser = new BLPParser(filepath)
parser.parse()

// Build shared data index - try BLP path first, then Steam paths as fallback
const gameRoot = findGameRootFromPath(filepath)
let sdDirs = gameRoot ? findAllSharedData(gameRoot) : []
// If no SHARED_DATA found from BLP path (e.g. BLP is in user data, not game install), scan Steam
if (sdDirs.length === 0) {
  const steamDirs = findSharedDataCandidates()
  for (const d of steamDirs) {
    if (!sdDirs.includes(d)) sdDirs.push(d)
  }
}
console.log(`Game root: ${gameRoot || 'not found from path'}`)
console.log(`SHARED_DATA dirs: ${sdDirs.length}`)
for (const d of sdDirs) console.log(`  ${d}`)
const sdIndex = buildSharedDataIndex(sdDirs)

// Find oodle
let oodle: OodleDecompressor | null = null
const oodleCandidates = findOodleCandidates()
for (const p of oodleCandidates) {
  try { oodle = new OodleDecompressor(p); break } catch { /* */ }
}

console.log(`\nShared data: ${sdIndex.size} files, Oodle: ${oodle ? 'loaded' : 'NOT FOUND'}\n`)

// Collect skeleton blobs (blobType 12) and animations (blobType 5)
const skeletons: { name: string; size: number }[] = []
const animations: { name: string; size: number }[] = []

for (const alloc of parser.iterEntriesByType('BLP::BlobEntry')) {
  const obj = parser.deserializeAlloc(alloc)
  const name = obj.m_Name as string
  const bt = (obj.m_nBlobType as number) ?? -1
  const sz = (obj.m_nSize as number) || 0
  if (bt === 12) skeletons.push({ name, size: sz })
  if (bt === 5) animations.push({ name, size: sz })
}

console.log(`Found ${skeletons.length} skeletons, ${animations.length} animations\n`)

// Analyze the first skeleton (or the one matching targetName)
const target = targetName
  ? skeletons.find(s => s.name === targetName) || skeletons.find(s => s.name.includes(targetName))
  : skeletons[0]

if (!target) {
  console.log('No skeleton found.')
  // List some
  for (const s of skeletons.slice(0, 10)) {
    console.log(`  ${s.name} (${s.size} bytes)`)
  }
  process.exit(0)
}

console.log(`Analyzing skeleton: ${target.name} (${target.size} bytes)\n`)

const civbigPath = sdIndex.get(target.name)
if (!civbigPath) {
  console.error(`Not found in SHARED_DATA index: ${target.name}`)
  process.exit(1)
}

const { data: rawData } = readCivbig(civbigPath)
let skelData: Buffer
if (OodleDecompressor.isOodleCompressed(rawData) && oodle) {
  const d = oodle.decompress(rawData, target.size || rawData.length * 4)
  skelData = d || rawData
} else {
  skelData = rawData
}

console.log(`Decompressed size: ${skelData.length} bytes\n`)

// Full hex dump of first 512 bytes
console.log('=== Header (first 512 bytes) ===')
hexdump(skelData, 32, 0)

// Look for magic
const magic8 = skelData.length >= 8 ? skelData.subarray(0, 8).toString('ascii').replace(/\0/g, '') : ''
const magic4 = skelData.length >= 4 ? skelData.subarray(0, 4).toString('ascii').replace(/\0/g, '') : ''
console.log(`\nMagic: "${magic8}" / "${magic4}"`)

// Check for RootNode format
if (magic8.startsWith('RootNode') || magic4.startsWith('Root')) {
  console.log('Format: RootNode skeleton')
} else {
  console.log('Format: Unknown (not RootNode)')
}

const view = new DataView(skelData.buffer, skelData.byteOffset, skelData.byteLength)

// Scan for bone name strings
console.log('\n=== Scanning for bone names (offset 32+) ===')
const textRange = skelData.subarray(32, Math.min(skelData.length, 8192))
const textStr = Array.from(textRange).map(b => b >= 0x20 && b < 0x7F ? String.fromCharCode(b) : '\0').join('')
const names = textStr.match(/[A-Za-z_][A-Za-z0-9_.]{3,}/g)
const uniqueNames = names ? [...new Set(names)] : []
console.log(`Found ${uniqueNames.length} unique name-like strings:`)
for (const n of uniqueNames.slice(0, 30)) {
  // Find the offset of this name in the data
  const nameBytes = Buffer.from(n, 'ascii')
  const idx = skelData.indexOf(nameBytes, 32)
  console.log(`  0x${idx.toString(16).padStart(4, '0')}: "${n}"`)
}
if (uniqueNames.length > 30) console.log(`  ... ${uniqueNames.length - 30} more`)

// Analyze structure: look for arrays of small integers (potential parent indices)
console.log('\n=== Looking for parent index arrays ===')
// Try different offsets and see if we find arrays of small int16/int32 values
// that look like parent indices (-1 for root, 0..N for others)
const boneCount = uniqueNames.length

for (let testOff = 8; testOff < Math.min(512, skelData.length - boneCount * 2); testOff += 4) {
  // Try int16 parent array at this offset
  let valid16 = true
  const parents16: number[] = []
  for (let i = 0; i < boneCount && testOff + i * 2 + 2 <= skelData.length; i++) {
    const val = view.getInt16(testOff + i * 2, true)
    parents16.push(val)
    if (val < -1 || val >= boneCount) { valid16 = false; break }
  }
  if (valid16 && parents16.length === boneCount && parents16.filter(p => p === -1).length >= 1) {
    console.log(`  Potential int16 parent array at 0x${testOff.toString(16)}: [${parents16.slice(0, 20).join(', ')}${parents16.length > 20 ? '...' : ''}]`)
  }

  // Try int32 parent array
  if (testOff + boneCount * 4 <= skelData.length) {
    let valid32 = true
    const parents32: number[] = []
    for (let i = 0; i < boneCount; i++) {
      const val = view.getInt32(testOff + i * 4, true)
      parents32.push(val)
      if (val < -1 || val >= boneCount) { valid32 = false; break }
    }
    if (valid32 && parents32.length === boneCount && parents32.filter(p => p === -1).length >= 1) {
      console.log(`  Potential int32 parent array at 0x${testOff.toString(16)}: [${parents32.slice(0, 20).join(', ')}${parents32.length > 20 ? '...' : ''}]`)
    }
  }
}

// Look for float32 arrays that could be rest-pose transforms
console.log('\n=== Looking for transform data (float32 arrays) ===')
for (let testOff = 64; testOff < Math.min(1024, skelData.length - 40); testOff += 4) {
  const f0 = view.getFloat32(testOff, true)
  const f1 = view.getFloat32(testOff + 4, true)
  const f2 = view.getFloat32(testOff + 8, true)
  const f3 = view.getFloat32(testOff + 12, true)
  // Check if this looks like a quaternion (w,x,y,z with magnitude ~1)
  const mag = Math.sqrt(f0*f0 + f1*f1 + f2*f2 + f3*f3)
  if (mag > 0.95 && mag < 1.05 && Math.abs(f0) <= 1.01 && Math.abs(f1) <= 1.01 && Math.abs(f2) <= 1.01 && Math.abs(f3) <= 1.01) {
    console.log(`  Potential quaternion at 0x${testOff.toString(16)}: [${f0.toFixed(4)}, ${f1.toFixed(4)}, ${f2.toFixed(4)}, ${f3.toFixed(4)}] (mag=${mag.toFixed(4)})`)
    // Check if next 3 floats look like position
    if (testOff + 28 <= skelData.length) {
      const px = view.getFloat32(testOff + 16, true)
      const py = view.getFloat32(testOff + 20, true)
      const pz = view.getFloat32(testOff + 24, true)
      if (Math.abs(px) < 1000 && Math.abs(py) < 1000 && Math.abs(pz) < 1000) {
        console.log(`    + position: [${px.toFixed(4)}, ${py.toFixed(4)}, ${pz.toFixed(4)}]`)
      }
    }
    // Only show first 5
    if (testOff > 300) { console.log('  (stopping quaternion scan)'); break }
  }
}

// Write raw .skel file for external analysis
const outDir = join(resolve(blpPath, '..'), 'extracted')
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true })
const outPath = join(outDir, `${target.name}.skel`)
writeFileSync(outPath, skelData)
console.log(`\nWrote ${skelData.length} bytes to ${outPath}`)

// Also dump an animation for comparison
if (animations.length > 0) {
  const anim = animations[0]
  const animPath = sdIndex.get(anim.name)
  if (animPath) {
    const { data: animRaw } = readCivbig(animPath)
    let animData: Buffer
    if (OodleDecompressor.isOodleCompressed(animRaw) && oodle) {
      const d = oodle.decompress(animRaw, anim.size || animRaw.length * 4)
      animData = d || animRaw
    } else {
      animData = animRaw
    }
    console.log(`\n=== First animation: ${anim.name} (${animData.length} bytes) ===`)
    hexdump(animData, 8, 0)
    const animView = new DataView(animData.buffer, animData.byteOffset, animData.byteLength)
    if (animData.length >= 96) {
      const fps = animView.getFloat32(0x08, true)
      const frameCount = animView.getUint32(0x0C, true)
      const boneField = animView.getUint32(0x10, true)
      const isV1 = (boneField & 0xFFFF0000) !== 0
      const animBoneCount = isV1 ? boneField & 0xFFFF : boneField
      console.log(`  FPS: ${fps}, Frames: ${frameCount}, Bones: ${animBoneCount}, Version: ${isV1 ? 'V1' : 'V0'}`)
    }
  }
}
