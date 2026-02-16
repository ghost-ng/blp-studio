import { readFileSync, readdirSync } from 'fs'
import { resolve, join } from 'path'

const ANIM_MAGIC = 0x6AB06AB0

function main() {
  const dir = resolve(process.argv[2] || '')
  const files = readdirSync(dir).filter(f => f.endsWith('.anim'))

  interface FileInfo {
    name: string
    boneCount: number
    frameCount: number
    count1: number
    totalAnim: number
    rAnim: number
    tAnim: number
    sAnim: number
    g0: number
    g1: number
    g2: number
    g3: number
    bodySize: number
    bodyStart: number
  }

  const infos: FileInfo[] = []

  for (const f of files) {
    const data = readFileSync(join(dir, f))
    if (data.length < 0xB4) continue
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
    if (view.getUint32(0, true) !== ANIM_MAGIC) continue
    if (view.getUint32(0x48, true) === 0xFFFFFFFF) continue

    const AC = 0x60
    const u32 = (o: number) => view.getUint32(o, true)

    const boneCount = u32(AC + 0x10)
    const frameCount = u32(0x0C)
    const count1 = u32(AC + 0x20)
    const dataSize = u32(AC + 0x00)
    const secOff1 = u32(AC + 0x48)
    const secOff2 = u32(AC + 0x4C)
    const secOff3 = u32(AC + 0x50)

    let cursor = AC + 0x44 + 16
    if (count1 >= 2) cursor += count1 * 4 + 4
    
    const segGroups: number[][] = []
    for (let s = 0; s < count1; s++) {
      segGroups.push([u32(cursor), u32(cursor + 4), u32(cursor + 8), u32(cursor + 12)])
      cursor += 16
    }

    const bfSize = secOff2 - secOff1
    if (bfSize < 0 || bfSize > 10000) continue

    const channelTypes: number[] = []
    const wordCount = Math.ceil(bfSize / 4)
    for (let w = 0; w < wordCount; w++) {
      const word = u32(cursor + w * 4)
      for (let i = 0; i < 16; i++) channelTypes.push((word >>> (i * 2)) & 3)
    }

    const rTypes: number[] = [], tTypes: number[] = [], sTypes: number[] = []
    for (let b = 0; b < boneCount; b++) rTypes.push(channelTypes[b] ?? 0)
    for (let b = 0; b < boneCount; b++) tTypes.push(channelTypes[boneCount + b] ?? 0)
    for (let b = 0; b < boneCount; b++) sTypes.push(channelTypes[2 * boneCount + b] ?? 0)

    const rAnim = rTypes.filter(v => v === 2).length
    const tAnim = tTypes.filter(v => v === 2).length
    const sAnim = sTypes.filter(v => v === 2).length
    const totalAnim = rAnim + tAnim + sAnim
    if (totalAnim === 0) continue

    const g = segGroups[0] || [0, 0, 0, 0]
    const bodyStart = AC + g[3]
    const bodySize = count1 === 1 ? (AC + dataSize) - bodyStart : -1

    infos.push({
      name: f, boneCount, frameCount, count1, totalAnim,
      rAnim, tAnim, sAnim,
      g0: g[0], g1: g[1], g2: g[2], g3: g[3],
      bodySize, bodyStart
    })
  }

  console.log(`Loaded ${infos.length} V1 files with animated channels\n`)

  const single = infos.filter(i => i.count1 === 1)
  console.log(`Single-segment files: ${single.length}`)

  console.log('\n=== Simplest single-segment files (top 15) ===')
  const simplest = single
    .filter(i => i.bodySize > 0)
    .sort((a, b) => {
      const scoreA = a.totalAnim * a.frameCount
      const scoreB = b.totalAnim * b.frameCount
      return scoreA - scoreB
    })
    .slice(0, 15)

  for (const i of simplest) {
    const data = readFileSync(join(dir, i.name))
    console.log(`\n--- ${i.name} ---`)
    console.log(`  bones=${i.boneCount} frames=${i.frameCount} totalAnim=${i.totalAnim} (R:${i.rAnim} T:${i.tAnim} S:${i.sAnim})`)
    console.log(`  g=[${i.g0}, ${i.g1}, ${i.g2}, ${i.g3}] bodySize=${i.bodySize}`)
    console.log(`  bytesPerEntry=${(i.bodySize/i.g0).toFixed(4)}`)
    console.log(`  g0 vs totalAnim*frames: ${i.g0} vs ${i.totalAnim * i.frameCount} (diff: ${i.g0 - i.totalAnim * i.frameCount})`)
    console.log(`  g1 vs rAnim*frames: ${i.g1} vs ${i.rAnim * i.frameCount} (diff: ${i.g1 - i.rAnim * i.frameCount})`)
    console.log(`  g2 vs (tAnim+sAnim)*frames: ${i.g2} vs ${(i.tAnim + i.sAnim) * i.frameCount} (diff: ${i.g2 - (i.tAnim + i.sAnim) * i.frameCount})`)
    
    const body = data.subarray(i.bodyStart, i.bodyStart + Math.min(i.bodySize, 96))
    const hexLine = Array.from(body).map(b => b.toString(16).padStart(2, '0')).join(' ')
    console.log(`  raw: ${hexLine}`)
    
    if (i.bodySize >= 24) {
      const bodyView = new DataView(data.buffer, data.byteOffset + i.bodyStart, i.bodySize)
      const u16vals: number[] = []
      for (let j = 0; j < Math.min(24, i.bodySize / 2); j++) {
        u16vals.push(bodyView.getUint16(j * 2, true))
      }
      console.log(`  as uint16 (first 24): [${u16vals.join(', ')}]`)
      const max = Math.max(...u16vals)
      const min = Math.min(...u16vals)
      console.log(`  uint16 range: ${min}-${max}`)
    }

    const u8vals = Array.from(body.subarray(0, Math.min(48, body.length)))
    const zeros = u8vals.filter(v => v === 0).length
    const high = u8vals.filter(v => v > 127).length
    console.log(`  byte stats: ${zeros} zeros, ${high} high (>127) out of ${u8vals.length}`)
  }
}

main()
