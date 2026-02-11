/**
 * Wwise SoundBank (.bnk) parser
 *
 * Parses BKHD/DIDX/DATA/HIRC/STID sections from Wwise SoundBank files
 * and extracts embedded .wem audio files from the DATA section.
 */

export interface WwiseBankInfo {
  bankVersion: number
  bankId: number
  sections: WwiseSection[]
  embeddedFiles: WwiseEmbeddedFile[]
}

export interface WwiseSection {
  tag: string
  offset: number
  size: number
}

export interface WwiseEmbeddedFile {
  id: number
  offset: number  // offset within DATA section payload
  size: number
}

/**
 * Parse a Wwise SoundBank buffer and return its structure.
 */
export function parseWwiseBank(data: Buffer | Uint8Array): WwiseBankInfo {
  const buf = data instanceof Buffer ? data : Buffer.from(data.buffer, data.byteOffset, data.byteLength)
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)

  let bankVersion = 0
  let bankId = 0
  const sections: WwiseSection[] = []
  const embeddedFiles: WwiseEmbeddedFile[] = []

  // Scan sections
  let pos = 0
  let dataOffset = -1 // byte offset of DATA payload in the file

  while (pos + 8 <= buf.length) {
    const tag = String.fromCharCode(buf[pos], buf[pos + 1], buf[pos + 2], buf[pos + 3])
    const chunkSize = view.getUint32(pos + 4, true)

    // Only accept known section tags or uppercase 4-char tags
    if (!/^[A-Z]{4}$/.test(tag) && tag !== 'BKHD' && tag !== 'DIDX' && tag !== 'DATA' && tag !== 'HIRC' && tag !== 'STID') {
      break
    }

    sections.push({ tag, offset: pos, size: chunkSize })

    if (tag === 'BKHD' && pos + 16 <= buf.length) {
      bankVersion = view.getUint32(pos + 8, true)
      bankId = view.getUint32(pos + 12, true)
    }

    if (tag === 'DIDX') {
      // DIDX contains 12-byte entries: uint32 id, uint32 offsetInData, uint32 size
      const didxPayloadStart = pos + 8
      const didxPayloadEnd = didxPayloadStart + chunkSize
      let didxPos = didxPayloadStart
      while (didxPos + 12 <= didxPayloadEnd) {
        const fileId = view.getUint32(didxPos, true)
        const fileOffset = view.getUint32(didxPos + 4, true)
        const fileSize = view.getUint32(didxPos + 8, true)
        embeddedFiles.push({ id: fileId, offset: fileOffset, size: fileSize })
        didxPos += 12
      }
    }

    if (tag === 'DATA') {
      dataOffset = pos + 8 // payload starts after tag + size
    }

    pos += 8 + chunkSize
    // Align to 4 bytes (some banks pad)
    // pos = (pos + 3) & ~3  // uncomment if alignment issues
  }

  // Adjust embedded file offsets to be absolute (relative to buffer start)
  if (dataOffset >= 0) {
    for (const file of embeddedFiles) {
      file.offset += dataOffset
    }
  }

  return { bankVersion, bankId, sections, embeddedFiles }
}

/**
 * Extract a single embedded .wem file from a SoundBank buffer.
 */
export function extractWemFile(bankData: Buffer | Uint8Array, file: WwiseEmbeddedFile): Buffer {
  const buf = bankData instanceof Buffer ? bankData : Buffer.from(bankData.buffer, bankData.byteOffset, bankData.byteLength)
  return buf.subarray(file.offset, file.offset + file.size) as Buffer
}
