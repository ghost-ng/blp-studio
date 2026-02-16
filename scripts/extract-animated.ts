#!/usr/bin/env npx tsx
/**
 * Extract V1 animations that have actual animated channels from a BLP file.
 * Usage: npx tsx scripts/extract-animated.ts <file.blp> [maxCount]
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { resolve, join } from 'path'
import { BLPParser } from '../src/core/blp-parser'
import { readCivbig } from '../src/core/civbig'
import { OodleDecompressor } from '../src/core/oodle'
import {
  findOodleCandidates,
  findAllSharedData,
  findGameRootFromPath,
  findSharedDataCandidates,
  buildSharedDataIndex,
} from '../src/core/game-detect'

const [, , blpPath, countStr] = process.argv
if (!blpPath) { console.error('Usage: npx tsx scripts/extract-animated.ts <file.blp> [maxCount]'); process.exit(1) }
const maxCount = parseInt(countStr || '10')
const filepath = resolve(blpPath)

const parser = new BLPParser(filepath)
parser.parse()

const gameRoot = findGameRootFromPath(filepath)
let sdDirs = gameRoot ? findAllSharedData(gameRoot) : []
if (sdDirs.length === 0) {
  for (const d of findSharedDataCandidates()) {
    if (!sdDirs.includes(d)) sdDirs.push(d)
  }
}
const sdIndex = buildSharedDataIndex(sdDirs)

let oodle: OodleDecompressor | null = null
for (const p of findOodleCandidates()) {
  try { oodle = new OodleDecompressor(p); break } catch { /* */ }
}
console.log(`BLP: ${filepath}, Shared data: ${sdIndex.size}, Oodle: ${oodle ? 'ok' : 'no'}`)

const ANIM_MAGIC = 0x6AB06AB0
const outDir = join(resolve(blpPath, '..'), 'extracted-animated')
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true })

let found = 0
for (const alloc of parser.iterEntriesByType('BLP::BlobEntry')) {
  if (found >= maxCount) break
  const obj = parser.deserializeAlloc(alloc)
  const bt = (obj.m_nBlobType as number) ?? -1
  if (bt !== 5) continue
  const name = obj.m_Name as string
  const sz = (obj.m_nSize as number) || 0

  const civbigPath = sdIndex.get(name)
  if (!civbigPath) continue

  let data: Buffer
  try {
    const { data: rawData } = readCivbig(civbigPath)
    if (OodleDecompressor.isOodleCompressed(rawData) && oodle) {
      const d = oodle.decompress(rawData, sz || rawData.length * 4)
      data = d || rawData
    } else {
      data = rawData
    }
  } catch { continue }

  if (data.length < 0xB4) continue
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  if (view.getUint32(0, true) !== ANIM_MAGIC) continue
  if (view.getUint32(0x48, true) === 0xFFFFFFFF) continue // V0

  const AC = 0x60
  const u32 = (o: number) => view.getUint32(o, true)
  const boneCount = u32(AC + 0x10)
  const count1 = u32(AC + 0x20)
  const secOff1 = u32(AC + 0x48)
  const secOff2 = u32(AC + 0x4C)

  let cursor = AC + 0x44 + 16
  if (count1 >= 2) cursor += count1 * 4 + 4
  cursor += count1 * 16

  const bfSize = secOff2 - secOff1
  if (bfSize < 0 || bfSize > 1000) continue

  const channelTypes: number[] = []
  const wordCount = Math.ceil(bfSize / 4)
  for (let w = 0; w < wordCount; w++) {
    const word = u32(cursor + w * 4)
    for (let i = 0; i < 16; i++) channelTypes.push((word >>> (i * 2)) & 3)
  }

  let totalAnim = 0
  for (let b = 0; b < boneCount * 3; b++) {
    if ((channelTypes[b] ?? 0) === 2) totalAnim++
  }

  if (totalAnim === 0) continue

  const safeName = name.replace(/[^a-zA-Z0-9._-]/g, '_')
  const outPath = join(outDir, `${safeName}.anim`)
  writeFileSync(outPath, data)
  found++
  console.log(`[${found}] ${name} bones=${boneCount} animated=${totalAnim} size=${data.length}`)
}

console.log(`\nExtracted ${found} animated V1 files to ${outDir}`)
