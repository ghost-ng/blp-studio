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

  const single = infos.filter(i => i.count1 === 1 && i.bodySize > 0)
  console.log(`Analyzing ${single.length} single-segment files\n`)

  console.log('=== Body structure analysis ===\n')

  const simplest = single
    .sort((a, b) => a.totalAnim * a.frameCount - b.totalAnim * b.frameCount)
    .slice(0, 8)

  for (const i of simplest) {
    const data = readFileSync(join(dir, i.name))
    const bodyView = new DataView(data.buffer, data.byteOffset + i.bodyStart, i.bodySize)

    console.log(`--- ${i.name} ---`)
    console.log(`  frames=${i.frameCount} totalAnim=${i.totalAnim} (R:${i.rAnim} T:${i.tAnim} S:${i.sAnim})`)
    console.log(`  g=[${i.g0}, ${i.g1}, ${i.g2}, ${i.g3}] bodySize=${i.bodySize}`)
    
    console.log(`  First 8 floats:`)
    for (let j = 0; j < 8 && j * 4 < i.bodySize; j++) {
      const f = bodyView.getFloat32(j * 4, true)
      console.log(`    [${j}] = ${f.toFixed(6)}`)
    }

    const floatBytes = 32
    if (i.bodySize > floatBytes) {
      const afterFloats = data.subarray(i.bodyStart + floatBytes, i.bodyStart + Math.min(i.bodySize, floatBytes + 64))
      const hexLine = Array.from(afterFloats).map(b => b.toString(16).padStart(2, '0')).join(' ')
      console.log(`  After float header (64 bytes): ${hexLine}`)
    }

    console.log(`  Expected entries: totalAnim*frames = ${i.totalAnim * i.frameCount}`)
    console.log(`  g0 = ${i.g0} (diff: ${i.g0 - i.totalAnim * i.frameCount})`)
    console.log(`  Remaining after 32-byte header: ${i.bodySize - 32} bytes`)
    console.log(`  Bytes per entry (excl header): ${((i.bodySize - 32) / (i.totalAnim * i.frameCount)).toFixed(4)}`)
    console.log('')
  }
}

main()
