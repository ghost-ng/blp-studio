import { readFileSync } from 'fs'
import { resolve } from 'path'

const filepath = resolve(process.argv[2] || '')
const data = readFileSync(filepath)
const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
const u32 = (o: number) => view.getUint32(o, true)
const f32 = (o: number) => view.getFloat32(o, true)

console.log(`File: ${filepath} (${data.length} bytes)\n`)

// Outer header
console.log('=== OUTER HEADER (0x00-0x5F) ===')
for (let off = 0; off < 0x60; off += 4) {
  const v = u32(off)
  const fv = f32(off)
  const isFloat = isFinite(fv) && Math.abs(fv) > 0.0001 && Math.abs(fv) < 1e6
  console.log(`  0x${off.toString(16).padStart(2,'0')}: 0x${v.toString(16).padStart(8,'0')} = ${v.toString().padStart(10)}${isFloat ? ` [f32=${fv.toFixed(6)}]` : ''}`)
}

const fps = f32(0x08)
const frameCount = u32(0x0C)
const boneField = u32(0x10)
console.log(`\nfps=${fps} frameCount=${frameCount} boneField=0x${boneField.toString(16)}`)

// AC11 subheader
const AC = 0x60
console.log('\n=== AC11 SUBHEADER (0x60+) ===')
for (let off = 0; off < Math.min(0x60, data.length - AC); off += 4) {
  const abs = AC + off
  const v = u32(abs)
  const fv = f32(abs)
  const isFloat = isFinite(fv) && Math.abs(fv) > 0.0001 && Math.abs(fv) < 1e6
  console.log(`  AC+0x${off.toString(16).padStart(2,'0')} (0x${abs.toString(16)}): 0x${v.toString(16).padStart(8,'0')} = ${v.toString().padStart(10)}${isFloat ? ` [f32=${fv.toFixed(6)}]` : ''}`)
}

const dataSize = u32(AC + 0x00)
const magic2 = u32(AC + 0x08)
const boneCount = u32(AC + 0x10)
const lastFrame = u32(AC + 0x14)
const count1 = u32(AC + 0x20)
const valA = u32(AC + 0x34)
const valB = u32(AC + 0x38)
const valC = u32(AC + 0x3C)
const sentinel = u32(AC + 0x40)
const secOff0 = u32(AC + 0x44)
const secOff1 = u32(AC + 0x48)
const secOff2 = u32(AC + 0x4C)
const secOff3 = u32(AC + 0x50)

console.log(`\ndataSize=${dataSize} magic2=0x${magic2.toString(16)} boneCount=${boneCount}`)
console.log(`lastFrame=${lastFrame} count1=${count1}`)
console.log(`valA=${valA} valB=${valB} valC=${valC}`)
console.log(`sentinel=0x${sentinel.toString(16)}`)
console.log(`secOff=[${secOff0}, ${secOff1}, ${secOff2}, ${secOff3}]`)

// Navigate data
let cursor = AC + 0x44 + 16 // past secOff array
console.log(`\nAfter secOff: cursor=0x${cursor.toString(16)}`)

if (count1 >= 2) {
  console.log('Frame boundaries:')
  for (let i = 0; i < count1; i++) {
    console.log(`  [${i}] = ${u32(cursor)}`)
    cursor += 4
  }
  console.log(`  sentinel = 0x${u32(cursor).toString(16)}`)
  cursor += 4
}

console.log('\nSegment groups:')
for (let s = 0; s < count1; s++) {
  console.log(`  [${s}] = [${u32(cursor)}, ${u32(cursor+4)}, ${u32(cursor+8)}, ${u32(cursor+12)}]`)
  cursor += 16
}

const bfSize = secOff2 - secOff1
console.log(`\nBitfield at cursor=0x${cursor.toString(16)}, size=${bfSize}`)

if (bfSize > 0 && bfSize < 1000) {
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

  console.log(`R types: [${rTypes.join(',')}]`)
  console.log(`T types: [${tTypes.join(',')}]`)
  console.log(`S types: [${sTypes.join(',')}]`)

  const rAnim = rTypes.filter(v => v === 2).length
  const tAnim = tTypes.filter(v => v === 2).length
  const sAnim = sTypes.filter(v => v === 2).length
  console.log(`rAnim=${rAnim} tAnim=${tAnim} sAnim=${sAnim} total=${rAnim+tAnim+sAnim}`)

  cursor += bfSize

  // Constants
  console.log(`\nConstant data at cursor=0x${cursor.toString(16)}`)
  console.log(`valA=${valA} rot entries (${valA*12} bytes)`)
  for (let i = 0; i < valA; i++) {
    console.log(`  rot[${i}] = [${f32(cursor).toFixed(6)}, ${f32(cursor+4).toFixed(6)}, ${f32(cursor+8).toFixed(6)}]`)
    cursor += 12
  }
  console.log(`valB=${valB} pos entries (${valB*12} bytes)`)
  for (let i = 0; i < valB; i++) {
    console.log(`  pos[${i}] = [${f32(cursor).toFixed(6)}, ${f32(cursor+4).toFixed(6)}, ${f32(cursor+8).toFixed(6)}]`)
    cursor += 12
  }
  console.log(`valC=${valC} scl entries (${valC*12} bytes)`)
  for (let i = 0; i < valC; i++) {
    console.log(`  scl[${i}] = [${f32(cursor).toFixed(6)}, ${f32(cursor+4).toFixed(6)}, ${f32(cursor+8).toFixed(6)}]`)
    cursor += 12
  }

  // Animated headers
  const totalAnim = rAnim + tAnim + sAnim
  console.log(`\nAnimated headers at cursor=0x${cursor.toString(16)} (${totalAnim} channels × 24B)`)
  for (let i = 0; i < totalAnim; i++) {
    if (cursor + 24 > data.length) break
    const label = i < rAnim ? `rot[${i}]` : i < rAnim + tAnim ? `pos[${i-rAnim}]` : `scl[${i-rAnim-tAnim}]`
    const vals = [f32(cursor), f32(cursor+4), f32(cursor+8), f32(cursor+12), f32(cursor+16), f32(cursor+20)]
    console.log(`  ${label}: [${vals.map(v => v.toFixed(6)).join(', ')}]`)
    cursor += 24
  }

  // Body
  const bodyStart = AC + (count1 > 0 ? u32(AC + 0x44 + 16 + (count1 >= 2 ? count1 * 4 + 4 : 0) + 12) : secOff3)
  console.log(`\nCurrent cursor=0x${cursor.toString(16)}`)
  console.log(`Expected body at AC+g[3]: need to recalculate`)

  // Just dump remaining data
  const remaining = data.length - cursor
  console.log(`\nRemaining data: ${remaining} bytes from 0x${cursor.toString(16)} to end`)

  // Hex dump remaining
  const dumpLen = Math.min(remaining, 256)
  const lines = Math.ceil(dumpLen / 16)
  for (let row = 0; row < lines; row++) {
    const off = cursor + row * 16
    const bytes: string[] = []
    for (let i = 0; i < 16; i++) {
      if (off + i < data.length) bytes.push(data[off + i].toString(16).padStart(2, '0'))
      else bytes.push('  ')
    }
    console.log(`  0x${off.toString(16)}: ${bytes.slice(0,8).join(' ')}  ${bytes.slice(8).join(' ')}`)
  }

  // Also interpret as various types
  console.log(`\nRemaining as uint16 LE:`)
  for (let i = 0; i < Math.min(32, remaining/2); i++) {
    const off = cursor + i * 2
    if (off + 2 > data.length) break
    console.log(`  [${i}] = ${view.getUint16(off, true)} (0x${view.getUint16(off, true).toString(16).padStart(4,'0')})`)
  }
}
