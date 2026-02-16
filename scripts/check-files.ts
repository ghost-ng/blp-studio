import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'

const dir = process.argv[2] || ''
for (const f of readdirSync(dir).filter(x => x.endsWith('.anim'))) {
  const data = readFileSync(join(dir, f))
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const magic = view.getUint32(0, true)
  const off48 = data.length > 0x4C ? view.getUint32(0x48, true) : 0
  const ac60 = data.length > 0x64 ? view.getUint32(0x60, true) : 0
  console.log(`${f} sz=${data.length} magic=0x${magic.toString(16)} off48=0x${off48.toString(16)} ac60=0x${ac60.toString(16)}`)
}
