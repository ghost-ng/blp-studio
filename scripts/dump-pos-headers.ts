#!/usr/bin/env npx tsx
/**
 * Dump animated position headers to understand structure.
 */
import { readFileSync, readdirSync } from 'fs'
import { resolve, join } from 'path'

const ANIM_MAGIC = 0x6AB06AB0

function main() {
  const dir = resolve(process.argv[2] || '')
  const files = readdirSync(dir).filter(f => f.endsWith('.anim'))

  let dumped = 0
  const allHeaders: number[][] = []

  for (const f of files) {
    if (dumped >= 30) break
    const data = readFileSync(join(dir, f))
    if (data.length < 0xB4) continue
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
    if (view.getUint32(0, true) !== ANIM_MAGIC) continue
    if (view.getUint32(0x48, true) === 0xFFFFFFFF) continue

    const AC = 0x60
    const u32 = (o: number) => view.getUint32(o, true)
    const f32 = (o: number) => view.getFloat32(o, true)

    const boneCount = u32(AC + 0x10)
    const count1 = u32(AC + 0x20)
    const secOff1 = u32(AC + 0x48)
    const secOff2 = u32(AC + 0x4C)
    const secOff3 = u32(AC + 0x50)

    let cursor = AC + 0x44 + 16
    if (count1 >= 2) cursor += count1 * 4 + 4
    cursor += count1 * 16

    const bfSize = secOff2 - secOff1
    if (bfSize < 0 || bfSize > 10000) continue

    const channelTypes: number[] = []
    const wordCount = Math.ceil(bfSize / 4)
    for (let w = 0; w < wordCount; w++) {
      const word = u32(cursor + w * 4)
      for (let i = 0; i < 16; i++) channelTypes.push((word >>> (i * 2)) & 3)
    }
    const rTypes: number[] = [], tTypes: number[] = []
    for (let b = 0; b < boneCount; b++) rTypes.push(channelTypes[b] ?? 0)
    for (let b = 0; b < boneCount; b++) tTypes.push(channelTypes[boneCount + b] ?? 0)
    const rAnim = rTypes.filter(v => v === 2).length
    const tAnim = tTypes.filter(v => v === 2).length
    if (tAnim === 0) continue

    cursor += bfSize + (secOff3 - secOff2)
    cursor += rAnim * 24

    if (dumped < 5) {
      console.log(`\n--- ${f} (bones=${boneCount} tAnim=${tAnim} rAnim=${rAnim}) ---`)
    }
    for (let i = 0; i < Math.min(tAnim, 3); i++) {
      if (cursor + 24 > data.length) break
      const v = [f32(cursor), f32(cursor+4), f32(cursor+8), f32(cursor+12), f32(cursor+16), f32(cursor+20)]
      if (dumped < 5) {
        console.log(`  pos[${i}]: [${v.map(x => x.toFixed(6)).join(', ')}]`)
        // Check patterns
        console.log(`    v0-v1=${(v[0]-v[1]).toFixed(6)} v2-v3=${(v[2]-v[3]).toFixed(6)} v4-v5=${(v[4]-v[5]).toFixed(6)}`)
        console.log(`    v0/v3=${(v[3]!==0?v[0]/v[3]:NaN).toFixed(4)} v1/v4=${(v[4]!==0?v[1]/v[4]:NaN).toFixed(4)} v2/v5=${(v[5]!==0?v[2]/v[5]:NaN).toFixed(4)}`)
      }
      allHeaders.push(v)
      cursor += 24
    }
    dumped++
  }

  // Statistical analysis of all collected headers
  console.log(`\n\n=== STATISTICAL ANALYSIS (${allHeaders.length} headers) ===`)
  for (let i = 0; i < 6; i++) {
    const vals = allHeaders.map(h => h[i])
    const min = Math.min(...vals)
    const max = Math.max(...vals)
    const avg = vals.reduce((a,b)=>a+b,0) / vals.length
    console.log(`  v[${i}]: min=${min.toFixed(4)} max=${max.toFixed(4)} avg=${avg.toFixed(4)}`)
  }

  // Check: is v[1] always > v[0] or vice versa?
  let v0_lt_v1 = 0, v2_lt_v3 = 0, v4_lt_v5 = 0
  let v0_lt_v3 = 0, v1_lt_v4 = 0, v2_lt_v5 = 0
  for (const h of allHeaders) {
    if (h[0] < h[1]) v0_lt_v1++
    if (h[2] < h[3]) v2_lt_v3++
    if (h[4] < h[5]) v4_lt_v5++
    if (h[0] < h[3]) v0_lt_v3++
    if (h[1] < h[4]) v1_lt_v4++
    if (h[2] < h[5]) v2_lt_v5++
  }
  const n = allHeaders.length
  console.log(`\nInterleaved: v[0]<v[1]: ${v0_lt_v1}/${n}  v[2]<v[3]: ${v2_lt_v3}/${n}  v[4]<v[5]: ${v4_lt_v5}/${n}`)
  console.log(`Grouped: v[0]<v[3]: ${v0_lt_v3}/${n}  v[1]<v[4]: ${v1_lt_v4}/${n}  v[2]<v[5]: ${v2_lt_v5}/${n}`)

  // Check if v[0] ≈ -v[1], v[2] ≈ -v[3], v[4] ≈ -v[5] (offset = 0, scale pattern)
  let symmetric = 0
  for (const h of allHeaders) {
    if (Math.abs(h[0] + h[1]) < 0.01 && Math.abs(h[2] + h[3]) < 0.01 && Math.abs(h[4] + h[5]) < 0.01) symmetric++
  }
  console.log(`\nSymmetric (v0≈-v1): ${symmetric}/${n}`)

  // Check if values could be [mid, range, mid, range, mid, range]
  // The first 3 values might all be one thing, the last 3 another
  console.log(`\nMagnitude analysis:`)
  const mag03 = allHeaders.map(h => Math.abs(h[0]) + Math.abs(h[1]) + Math.abs(h[2]))
  const mag35 = allHeaders.map(h => Math.abs(h[3]) + Math.abs(h[4]) + Math.abs(h[5]))
  console.log(`  |v[0..2]| avg=${(mag03.reduce((a,b)=>a+b,0)/n).toFixed(4)}`)
  console.log(`  |v[3..5]| avg=${(mag35.reduce((a,b)=>a+b,0)/n).toFixed(4)}`)

  // Check if second half is always >= 0 (would suggest [offset, range])
  let secondHalfPositive = 0
  for (const h of allHeaders) {
    if (h[3] >= -0.001 && h[4] >= -0.001 && h[5] >= -0.001) secondHalfPositive++
  }
  console.log(`  v[3..5] all ≥ 0: ${secondHalfPositive}/${n}`)
}
main()
