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

  let g0Match = 0, g0Mismatch = 0
  for (const i of single) {
    if (i.g0 === i.totalAnim * i.frameCount) g0Match++
    else g0Mismatch++
  }
  console.log(`\ng0 === totalAnim * frameCount: ${g0Match}/${single.length} (${(g0Match/single.length*100).toFixed(1)}%)`)

  let g1Match = 0
  for (const i of single) {
    if (i.g1 === i.rAnim * i.frameCount) g1Match++
  }
  console.log(`g1 === rAnim * frameCount: ${g1Match}/${single.length}`)

  let g2Match = 0
  for (const i of single) {
    if (i.g2 === (i.tAnim + i.sAnim) * i.frameCount) g2Match++
  }
  console.log(`g2 === (tAnim+sAnim) * frameCount: ${g2Match}/${single.length}`)

  const ratios: number[] = []
  for (const i of single) {
    if (i.g0 > 0 && i.bodySize > 0) {
      ratios.push(i.bodySize / i.g0)
    }
  }
  if (ratios.length > 0) {
    ratios.sort((a, b) => a - b)
    console.log(`\nbodySize / g0 ratios:`)
    console.log(`  min=${ratios[0].toFixed(4)} max=${ratios[ratios.length-1].toFixed(4)}`)
    console.log(`  median=${ratios[Math.floor(ratios.length/2)].toFixed(4)}`)
    console.log(`  mean=${(ratios.reduce((a,b)=>a+b,0)/ratios.length).toFixed(4)}`)
    
    const buckets = new Map<string, number>()
    for (const r of ratios) {
      const key = r.toFixed(1)
      buckets.set(key, (buckets.get(key) || 0) + 1)
    }
    console.log(`  distribution:`)
    for (const [k, v] of [...buckets.entries()].sort((a, b) => parseFloat(a[0]) - parseFloat(b[0]))) {
      console.log(`    ${k}: ${v}`)
    }
  }

  console.log('\n=== Body size formula tests ===')
  const formulas: { name: string; fn: (i: FileInfo) => number }[] = [
    { name: 'g0 * 2', fn: i => i.g0 * 2 },
    { name: 'g0 * 3', fn: i => i.g0 * 3 },
    { name: 'g0 * 4', fn: i => i.g0 * 4 },
    { name: 'g0 * 6', fn: i => i.g0 * 6 },
    { name: 'g0 * 8', fn: i => i.g0 * 8 },
    { name: 'g1*6 + g2*6', fn: i => i.g1 * 6 + i.g2 * 6 },
    { name: 'g1*8 + g2*6', fn: i => i.g1 * 8 + i.g2 * 6 },
    { name: 'rAnim*frames*6 + (tAnim+sAnim)*frames*6', fn: i => i.rAnim * i.frameCount * 6 + (i.tAnim + i.sAnim) * i.frameCount * 6 },
    { name: 'ceil(g0*3*2/4)*4', fn: i => Math.ceil(i.g0 * 6 / 4) * 4 },
  ]
  for (const { name, fn } of formulas) {
    let match = 0
    for (const i of single) {
      if (i.bodySize > 0 && fn(i) === i.bodySize) match++
    }
    console.log(`  ${name}: ${match}/${single.length}`)
  }

  console.log('\n=== Simplest single-segment files ===')
  const simplest = single
    .filter(i => i.bodySize > 0 && i.frameCount <= 10 && i.totalAnim <= 5)
    .sort((a, b) => a.totalAnim * a.frameCount - b.totalAnim * b.frameCount)
    .slice(0, 10)

  for (const i of simplest) {
    const data = readFileSync(join(dir, i.name))
    console.log(`\n--- ${i.name} ---`)
    console.log(`  bones=${i.boneCount} frames=${i.frameCount} totalAnim=${i.totalAnim} (R:${i.rAnim} T:${i.tAnim} S:${i.sAnim})`)
    console.log(`  g=[${i.g0}, ${i.g1}, ${i.g2}, ${i.g3}] bodySize=${i.bodySize} bytesPerEntry=${(i.bodySize/i.g0).toFixed(2)}`)
    
    const body = data.subarray(i.bodyStart, i.bodyStart + Math.min(i.bodySize, 128))
    const hexLine = Array.from(body).map(b => b.toString(16).padStart(2, '0')).join(' ')
    console.log(`  raw: ${hexLine}`)
    
    if (i.bodySize >= i.g0 * 2) {
      const bodyView = new DataView(data.buffer, data.byteOffset + i.bodyStart, i.bodySize)
      const u16vals: number[] = []
      for (let j = 0; j < Math.min(i.g0 * 3, i.bodySize / 2); j++) {
        u16vals.push(bodyView.getUint16(j * 2, true))
      }
      console.log(`  as uint16 (first ${Math.min(u16vals.length, 30)}): [${u16vals.slice(0, 30).join(', ')}]`)
      const max = Math.max(...u16vals)
      const min = Math.min(...u16vals)
      console.log(`  uint16 range: ${min}-${max}`)
    }

    const u8vals = Array.from(body.subarray(0, Math.min(60, body.length)))
    const zeros = u8vals.filter(v => v === 0).length
    const high = u8vals.filter(v => v > 127).length
    console.log(`  byte stats: ${zeros} zeros, ${high} high (>127) out of ${u8vals.length}`)
  }

  const multi = infos.filter(i => i.count1 > 1).slice(0, 5)
  console.log(`\n=== Multi-segment samples (${infos.filter(i => i.count1 > 1).length} total) ===`)
  for (const i of multi) {
    console.log(`  ${i.name}: count1=${i.count1} frames=${i.frameCount} totalAnim=${i.totalAnim} g=[${i.g0}, ${i.g1}, ${i.g2}, ${i.g3}]`)
  }
}

main()
