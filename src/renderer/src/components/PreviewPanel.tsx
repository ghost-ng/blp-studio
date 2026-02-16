import React, { useRef, useEffect, useState, useMemo, useCallback } from 'react'
import { flushSync } from 'react-dom'
import { ColorInspector, pickPixel, PickedColor } from './ColorInspector'
import { MagnifierLoupe } from './MagnifierLoupe'
import { SkeletonViewer } from './SkeletonViewer'

interface AssetEntry {
  name: string
  type: 'texture' | 'blob' | 'gpu' | 'sound'
  metadata: Record<string, unknown>
}

interface TexturePreview {
  name: string
  width: number
  height: number
  mips: number
  dxgiFormat: number
  dxgiFormatName: string
  rgbaPixels?: Uint8Array | null  // populated renderer-side via blp-preview:// protocol fetch
  bitmap?: ImageBitmap | null     // GPU-resident texture for instant display (off V8 heap)
  tooLarge?: boolean
}

interface AssetData {
  data: Uint8Array
  totalSize: number
  truncated: boolean
  blobType: number
  typeFlags: number
}

interface PreviewPanelProps {
  selectedAsset: AssetEntry | null
  preview: TexturePreview | null
  assetData: AssetData | null
  loading: boolean
  onExtract: () => void
  onReplace?: () => void
  onRevert?: () => void
  isReplaced?: boolean
  onCopyImage?: () => void
  experimentalEnabled?: boolean
  onPainted?: () => void
}

interface CanvasContextMenuState {
  x: number
  y: number
}

// --- Blob type names ---
const BLOB_TYPE_NAMES: Record<number, string> = {
  0: 'Heightmap',
  1: 'Blend Heightmap',
  2: 'ID Map',
  3: 'Material ID',
  5: 'Animation',
  6: 'StateSet',
  7: 'Audio (WAV)',
  9: 'Blend Mesh',
  11: 'Mesh',
  12: 'Skeleton',
  13: 'Collision',
}

// --- Blob type file extensions ---
const BLOB_TYPE_EXT: Record<number, string> = {
  0: '.hmu', 1: '.bmu', 2: '.idm', 3: '.mid',
  5: '.anim', 6: '.ssid', 7: '.wav', 9: '.bmu',
  11: '.bin', 12: '.skel', 13: '.bin',
}

// --- Blob type descriptions (shown when preview not available) ---
const BLOB_TYPE_DESC: Record<number, string> = {
  0: 'Terrain elevation data used for rendering 3D landscape.',
  1: 'Blended heightmap for smooth terrain transitions.',
  2: 'Indexed color map that encodes terrain/feature type IDs.',
  3: 'Material assignment map for terrain rendering.',
  5: 'Skeletal animation with bone transforms per frame.',
  6: 'State machine configuration controlling animation transitions.',
  7: 'PCM audio waveform data.',
  9: 'Blended mesh weights for terrain geometry.',
  11: '3D geometry data (vertices, indices, normals, UVs).',
  12: 'Bone hierarchy defining a skeleton for animation.',
  13: 'Simplified geometry used for physics collision detection.',
}

// --- Asset type descriptions (shown when no data found) ---
const ASSET_TYPE_DESC: Record<string, string> = {
  texture: 'Image data used for surface rendering (diffuse, normal, specular maps).',
  blob: 'Binary data blob — the specific format depends on its sub-type.',
  gpu: 'GPU buffer containing vertex, index, or compute data uploaded directly to the graphics card.',
  sound: 'Wwise SoundBank containing embedded audio events and streams.',
}

// --- File signature detection ---
function detectSignature(data: Uint8Array): string | null {
  if (data.length < 4) return null
  const u32 = (data[0]) | (data[1] << 8) | (data[2] << 16) | (data[3] << 24)
  const ascii4 = String.fromCharCode(data[0], data[1], data[2], data[3])

  if (ascii4 === 'RIFF') return 'RIFF (WAV/AVI)'
  if (ascii4 === 'OggS') return 'Ogg Vorbis'
  if (ascii4 === 'BKHD') return 'Wwise SoundBank'
  if (data[0] === 0x89 && ascii4.substring(1, 4) === 'PNG') return 'PNG Image'
  if (ascii4 === 'DDS ') return 'DDS Texture'
  if (u32 === 0x46546C67) return 'glTF Binary'
  if (ascii4 === 'CID0') return 'Compiled ID (material)'
  if (ascii4 === 'hmu0') return 'Civ7 Heightmap'
  if (ascii4 === 'IDM0') return 'Civ7 ID Map'
  if (ascii4 === 'bmu0') return 'Civ7 Blend Mesh'
  if (ascii4 === 'Root') return 'Civ7 Skeleton'
  if (data[0] === 0x8C) return 'Oodle Kraken (compressed)'
  return null
}

// --- Known binary signatures ---
const KNOWN_SIGNATURES: [string | number[], string][] = [
  ['CID0', 'Compiled Material ID'],
  ['BKHD', 'Wwise SoundBank'],
  ['RIFF', 'RIFF Container (WAV/AVI)'],
  ['OggS', 'Ogg Vorbis'],
  [[0x89, 0x50, 0x4E, 0x47], 'PNG Image'],
  ['DDS ', 'DirectDraw Surface'],
  ['glTF', 'glTF Binary'],
  ['hmu0', 'Civ7 Heightmap'],
  ['IDM0', 'Civ7 ID Map'],
  ['bmu0', 'Civ7 Blend Mesh'],
  ['Root', 'Civ7 Skeleton (RootNode)'],
  [[0x00, 0x00, 0x00, 0x14], 'Possible FBX fragment'],
  [[0xB0, 0x6A, 0xB0, 0x6A], 'Civ7 Skeletal Animation'],
]

function detectMagic(data: Uint8Array): string | null {
  if (data.length < 4) return null
  for (const [sig, name] of KNOWN_SIGNATURES) {
    if (typeof sig === 'string') {
      if (data.length >= sig.length) {
        let match = true
        for (let i = 0; i < sig.length; i++) {
          if (data[i] !== sig.charCodeAt(i)) { match = false; break }
        }
        if (match) return name
      }
    } else {
      let match = true
      for (let i = 0; i < sig.length; i++) {
        if (data[i] !== sig[i]) { match = false; break }
      }
      if (match) return name
    }
  }
  return null
}

function magicHex(data: Uint8Array, n: number): string {
  return Array.from(data.slice(0, Math.min(n, data.length))).map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ')
}

function magicAscii(data: Uint8Array, n: number): string {
  return Array.from(data.slice(0, Math.min(n, data.length))).map(b => b >= 0x20 && b < 0x7F ? String.fromCharCode(b) : '.').join('')
}

// --- Parse blob structure details from header bytes ---
function parseBlobDetails(data: Uint8Array, blobType: number): Record<string, string> | null {
  if (data.length < 4) return null
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const details: Record<string, string> = {}

  // Always show magic bytes
  details['Magic'] = magicHex(data, 8) + '  "' + magicAscii(data, 8) + '"'

  // Detect known signatures
  const detected = detectMagic(data)
  if (detected) details['Signature'] = detected

  if (blobType === 3) {
    // Material ID - CID0 format
    const magic = String.fromCharCode(data[0], data[1], data[2], data[3])
    if (magic === 'CID0') {
      if (data.length >= 8) details['Version/Flags'] = '0x' + view.getUint32(4, true).toString(16).toUpperCase()
      if (data.length >= 12) {
        const count = view.getUint32(8, true)
        details['Entry Count'] = count.toString()
      }
      // Try to read string table entries after header
      if (data.length >= 20) {
        const offset16 = view.getUint32(12, true)
        if (offset16 > 0 && offset16 < data.length) details['Data Offset'] = '0x' + offset16.toString(16)
      }
    }
  } else if (blobType === 0 || blobType === 1) {
    // Heightmap - hmu0 format: 32B header + uint16 grid
    // Header: magic(4) + width(4) + height(4) + padding(4) + heightScale(float32) + zeros(12)
    const magic = String.fromCharCode(data[0], data[1], data[2], data[3])
    if (magic === 'hmu0' && data.length >= 32) {
      const w = view.getUint32(4, true)
      const h = view.getUint32(8, true)
      const heightScale = view.getFloat32(16, true)
      details['Format'] = 'hmu0 (uint16 heightmap)'
      details['Grid Size'] = `${w} x ${h}`
      if (isFinite(heightScale) && heightScale !== 0) details['Height Scale'] = heightScale.toFixed(4)
      details['Data Size'] = formatSize(data.length - 32)
      // Sample height range from uint16 data
      const gridStart = 32
      const pixelCount = Math.min(w * h, (data.length - gridStart) / 2)
      let min = Infinity, max = -Infinity
      for (let i = 0; i < pixelCount; i++) {
        const v = view.getUint16(gridStart + i * 2, true)
        if (v < min) min = v
        if (v > max) max = v
      }
      if (isFinite(min)) {
        details['Height Range'] = `${min} .. ${max} (uint16)`
        if (isFinite(heightScale) && heightScale !== 0) {
          details['World Range'] = `${(min * heightScale).toFixed(2)} .. ${(max * heightScale).toFixed(2)}`
        }
      }
    } else {
      // Fallback: try raw float32 grid
      const totalFloats = Math.floor(data.length / 4)
      const sqrt = Math.round(Math.sqrt(totalFloats))
      if (sqrt * sqrt === totalFloats && sqrt > 1) {
        details['Grid Size'] = `${sqrt} x ${sqrt}`
        details['Format'] = 'Float32 heightmap (raw)'
      }
      details['Total Values'] = totalFloats.toLocaleString()
      if (data.length >= 16) {
        let min = Infinity, max = -Infinity
        const sampleCount = Math.min(totalFloats, 1000)
        for (let i = 0; i < sampleCount; i++) {
          const v = view.getFloat32(i * 4, true)
          if (isFinite(v)) { min = Math.min(min, v); max = Math.max(max, v) }
        }
        if (isFinite(min)) details['Height Range'] = `${min.toFixed(2)} .. ${max.toFixed(2)}`
      }
    }
  } else if (blobType === 2) {
    // ID Map - IDM0 format: magic(4) + width(4) + height(4) + materialCount(4) + palette(materialCount*3) + uint8 grid
    const magic = String.fromCharCode(data[0], data[1], data[2], data[3])
    if (magic === 'IDM0' && data.length >= 16) {
      const w = view.getUint32(4, true)
      const h = view.getUint32(8, true)
      const matCount = view.getUint32(12, true)
      const headerSize = 16 + matCount * 3
      details['Format'] = 'IDM0 (indexed ID map)'
      details['Grid Size'] = `${w} x ${h}`
      details['Material Count'] = matCount.toString()
      details['Header Size'] = `${headerSize} bytes`
      // Read palette colors
      if (matCount > 0 && matCount <= 256 && data.length >= headerSize) {
        const colors: string[] = []
        for (let i = 0; i < Math.min(matCount, 8); i++) {
          const off = 16 + i * 3
          colors.push(`#${data[off].toString(16).padStart(2, '0')}${data[off + 1].toString(16).padStart(2, '0')}${data[off + 2].toString(16).padStart(2, '0')}`)
        }
        details['Palette'] = colors.join(', ') + (matCount > 8 ? '...' : '')
      }
      // Count unique IDs in grid
      if (data.length > headerSize) {
        const gridData = data.subarray(headerSize)
        const ids = new Set(gridData.subarray(0, Math.min(gridData.length, 65536)))
        details['Unique IDs'] = ids.size.toString()
      }
    } else {
      // Fallback: raw uint8 grid
      const sqrt = Math.round(Math.sqrt(data.length))
      if (sqrt * sqrt === data.length && sqrt > 1) {
        details['Grid Size'] = `${sqrt} x ${sqrt}`
      }
      const ids = new Set(data.slice(0, Math.min(data.length, 65536)))
      details['Unique IDs'] = ids.size.toString()
      details['ID Values'] = Array.from(ids).sort((a, b) => a - b).slice(0, 16).join(', ') + (ids.size > 16 ? '...' : '')
    }
  } else if (blobType === 5) {
    // Animation (.anim) - Civ7 skeletal animation format
    // Magic: B0 6A B0 6A | Two variants: V0 (uncompressed) and V1 (indexed)
    // Header: 96 bytes, then track data, then ASCII name string at end
    if (data.length >= 96) {
      const fps = view.getFloat32(0x08, true)
      const frameCount = view.getUint32(0x0C, true)
      const dataOff48 = view.getUint32(0x48, true)
      const nameOff = view.getUint32(0x50, true)
      const nameLen = view.getUint32(0x30, true)

      // Read animation name from end of file
      let animName = ''
      if (nameOff > 0 && nameOff < data.length) {
        const end = data.indexOf(0, nameOff)
        if (end > nameOff) {
          animName = Array.from(data.slice(nameOff, Math.min(end, nameOff + 128)))
            .map(b => String.fromCharCode(b)).join('')
        }
      }

      const isV0 = dataOff48 === 0xFFFFFFFF // V0: uncompressed raw keyframes

      if (isV0) {
        // V0: raw keyframe data - 10 floats per bone per frame
        // [qw, qx, qy, qz, px, py, pz, sx, sy, sz] per bone per frame
        const boneCount = view.getUint32(0x10, true)
        const mainDataSize = view.getUint32(0x18, true)
        const secondarySize = view.getUint32(0x20, true)
        const duration = fps > 0 ? frameCount / fps : 0

        details['Format'] = 'V0 (uncompressed keyframes)'
        details['Frame Rate'] = fps.toFixed(0) + ' fps'
        details['Frame Count'] = frameCount.toLocaleString()
        if (duration > 0) details['Duration'] = duration.toFixed(2) + 's'
        details['Bone Count'] = boneCount.toString()
        details['Encoding'] = '10 float32/bone/frame (quat+pos+scale)'
        details['Keyframe Data'] = formatSize(mainDataSize)
        if (secondarySize > 0) details['Bone Index Table'] = formatSize(secondarySize)
        if (animName) details['Animation Name'] = animName
      } else {
        // V1: indexed/compressed with AC11AC11 subheader at offset 0x60
        const versionField = view.getUint32(0x10, true)
        const trackDataSize = view.getUint32(0x28, true)
        const duration = fps > 0 ? frameCount / fps : 0

        // Bone count from data subheader (0x70) or version field low word
        let boneCount = versionField & 0xFFFF
        if (data.length >= 0xA0) {
          const subBoneCount = view.getUint32(0x70, true)
          if (subBoneCount > 0 && subBoneCount < 10000) boneCount = subBoneCount
        }

        details['Format'] = 'V1 (indexed tracks)'
        details['Frame Rate'] = fps.toFixed(0) + ' fps'
        details['Frame Count'] = frameCount.toLocaleString()
        if (duration > 0) details['Duration'] = duration.toFixed(2) + 's'
        details['Bone Count'] = boneCount.toString()
        details['Track Data'] = formatSize(trackDataSize)
        if (animName) details['Animation Name'] = animName
      }
    }
  } else if (blobType === 6) {
    // StateSet (.ssid)
    if (data.length >= 16) {
      details['Header[0]'] = '0x' + view.getUint32(0, true).toString(16).toUpperCase()
      details['Header[1]'] = '0x' + view.getUint32(4, true).toString(16).toUpperCase()
      // Look for embedded string references
      const stateCount = view.getUint32(8, true)
      if (stateCount > 0 && stateCount < 256) details['State Count?'] = stateCount.toString()
    }
  } else if (blobType === 9) {
    // Blend Mesh - bmu0 format: magic(4) + width(4) + height(4) + padding(4) + uint8 grid
    const magic = String.fromCharCode(data[0], data[1], data[2], data[3])
    if (magic === 'bmu0' && data.length >= 16) {
      const w = view.getUint32(4, true)
      const h = view.getUint32(8, true)
      details['Format'] = 'bmu0 (blend mesh grid)'
      details['Grid Size'] = `${w} x ${h}`
      details['Data Size'] = formatSize(data.length - 16)
      // Count unique blend values
      if (data.length > 16) {
        const gridData = data.subarray(16)
        const vals = new Set(gridData.subarray(0, Math.min(gridData.length, 65536)))
        details['Unique Values'] = vals.size.toString()
      }
    } else {
      if (data.length >= 16) {
        const v0 = view.getUint32(0, true)
        const v1 = view.getUint32(4, true)
        if (v0 > 0 && v0 < 1000000) details['Vertex Count?'] = v0.toLocaleString()
        if (v1 > 0 && v1 < 256) details['Blend Targets?'] = v1.toString()
      }
    }
  } else if (blobType === 11) {
    // Mesh
    if (data.length >= 20) {
      const v0 = view.getUint32(0, true)
      const v1 = view.getUint32(4, true)
      const v2 = view.getUint32(8, true)
      const v3 = view.getUint32(12, true)
      if (v0 > 0 && v0 < 1000000) details['Vertex Count?'] = v0.toLocaleString()
      if (v1 > 0 && v1 < 10000000) details['Index Count?'] = v1.toLocaleString()
      if (v2 > 0 && v2 <= 128) details['Vertex Stride?'] = v2.toString() + ' bytes'
      if (v3 > 0 && v3 <= 64) details['Submesh Count?'] = v3.toString()
      // Try to detect float position data after header
      if (data.length > 64 && v2 > 0 && v2 <= 128) {
        const headerSize = 64
        const firstVert = view.getFloat32(headerSize, true)
        if (isFinite(firstVert) && Math.abs(firstVert) < 10000) {
          details['First Vertex X'] = firstVert.toFixed(4)
        }
      }
    }
  } else if (blobType === 12) {
    // Skeleton - RootNode format: "RootNode" or "Root" magic, bone data at offset ~256
    const magic8 = data.length >= 8 ? String.fromCharCode(data[0], data[1], data[2], data[3], data[4], data[5], data[6], data[7]) : ''
    const magic4 = String.fromCharCode(data[0], data[1], data[2], data[3])
    if (magic8.startsWith('RootNode') || magic4 === 'Root') {
      details['Format'] = 'RootNode skeleton'
      // Scan for ASCII bone name strings deeper in the file
      const searchStart = Math.min(128, data.length)
      const textRange = data.subarray(searchStart, Math.min(data.length, 4096))
      const textStr = Array.from(textRange).map(b => b >= 0x20 && b < 0x7F ? String.fromCharCode(b) : '\0').join('')
      const names = textStr.match(/[A-Za-z_][A-Za-z0-9_]{3,}/g)
      if (names && names.length > 0) {
        const unique = [...new Set(names)]
        details['Bone Count'] = unique.length.toString() + ' (approx)'
        details['Bone Names'] = unique.slice(0, 6).join(', ') + (unique.length > 6 ? '...' : '')
      }
    } else if (data.length >= 16) {
      const boneCount = view.getUint32(0, true)
      if (boneCount > 0 && boneCount < 1000) {
        details['Bone Count'] = boneCount.toString()
        const text = magicAscii(data, Math.min(data.length, 512))
        const names = text.match(/[A-Za-z_][A-Za-z0-9_]{2,}/g)
        if (names && names.length > 0) {
          details['Bone Names'] = names.slice(0, 5).join(', ') + (names.length > 5 ? '...' : '')
        }
      }
    }
  } else if (blobType === 13) {
    // Collision
    if (data.length >= 16) {
      details['Header[0]'] = '0x' + view.getUint32(0, true).toString(16).toUpperCase()
      const vertCount = view.getUint32(4, true)
      if (vertCount > 0 && vertCount < 1000000) details['Vertex Count?'] = vertCount.toLocaleString()
      const triCount = view.getUint32(8, true)
      if (triCount > 0 && triCount < 1000000) details['Triangle Count?'] = triCount.toLocaleString()
    }
  }

  // For all types: look for embedded strings in the data
  if (!details['Signature'] && !detected && data.length >= 8) {
    // Check if first 4 bytes form a recognizable ASCII tag
    const tag = magicAscii(data, 4)
    if (/^[A-Z][A-Z0-9]{2,3}$/.test(tag)) {
      details['Possible Tag'] = '"' + tag + '"'
    }
  }

  return Object.keys(details).length > 0 ? details : null
}

// --- Format file size ---
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

// --- Hex dump component ---
function HexDump({ data, maxRows = 32 }: { data: Uint8Array; maxRows?: number }) {
  const rows = Math.min(maxRows, Math.ceil(data.length / 16))

  return (
    <div className="font-mono text-xs leading-5 select-text">
      {/* Header */}
      <div className="text-gray-500 border-b border-gray-700 pb-1 mb-1">
        <span className="inline-block w-20">Offset</span>
        <span className="inline-block" style={{ width: '25rem' }}>
          {'00 01 02 03 04 05 06 07  08 09 0A 0B 0C 0D 0E 0F'}
        </span>
        <span>ASCII</span>
      </div>

      {Array.from({ length: rows }, (_, row) => {
        const offset = row * 16
        const bytes = data.subarray(offset, Math.min(offset + 16, data.length))

        // Hex part
        const hexParts: string[] = []
        for (let i = 0; i < 16; i++) {
          if (i < bytes.length) {
            hexParts.push(bytes[i].toString(16).padStart(2, '0'))
          } else {
            hexParts.push('  ')
          }
        }
        const hexStr = hexParts.slice(0, 8).join(' ') + '  ' + hexParts.slice(8).join(' ')

        // ASCII part
        let asciiStr = ''
        for (let i = 0; i < bytes.length; i++) {
          const b = bytes[i]
          asciiStr += (b >= 0x20 && b <= 0x7E) ? String.fromCharCode(b) : '.'
        }

        return (
          <div key={offset} className="hover:bg-gray-800/50">
            <span className="inline-block w-20 text-gray-500">
              {offset.toString(16).padStart(8, '0')}
            </span>
            <span className="inline-block text-gray-300" style={{ width: '25rem' }}>
              {hexStr}
            </span>
            <span className="text-amber-400/70">{asciiStr}</span>
          </div>
        )
      })}
    </div>
  )
}

// --- WAV format detection ---
const WAV_FORMAT_NAMES: Record<number, string> = {
  1: 'PCM', 2: 'MS ADPCM', 3: 'IEEE Float', 6: 'A-law', 7: 'mu-law',
  0x11: 'IMA ADPCM', 0xFFFE: 'Extensible', 0xFFFF: 'Wwise Encoded',
}

function getWavFormatCode(data: Uint8Array): number | null {
  if (data.length < 22) return null
  if (data[0] !== 0x52 || data[1] !== 0x49 || data[2] !== 0x46 || data[3] !== 0x46) return null // RIFF
  if (data[8] !== 0x57 || data[9] !== 0x41 || data[10] !== 0x56 || data[11] !== 0x45) return null // WAVE
  if (data[12] !== 0x66 || data[13] !== 0x6D || data[14] !== 0x74 || data[15] !== 0x20) return null // fmt
  return data[20] | (data[21] << 8)
}

function isWavPlayable(data: Uint8Array): boolean {
  const fmt = getWavFormatCode(data)
  return fmt === 1 || fmt === 3 // PCM or IEEE Float
}

// --- Audio preview (WAV/RIFF) with Wwise auto-decode ---
function AudioPreview({ data, name }: { data: Uint8Array; name: string }) {
  const fmtCode = getWavFormatCode(data)
  const fmtName = fmtCode !== null ? (WAV_FORMAT_NAMES[fmtCode] || `Unknown (0x${fmtCode.toString(16).toUpperCase()})`) : 'Unknown'
  const nativePlayable = fmtCode === 1 || fmtCode === 3

  const [decodedData, setDecodedData] = useState<Uint8Array | null>(null)
  const [decoding, setDecoding] = useState(false)
  const [decodeError, setDecodeError] = useState(false)

  // Auto-decode Wwise audio via vgmstream
  useEffect(() => {
    if (nativePlayable || decodedData || decoding) return
    setDecoding(true)
    setDecodeError(false)
    window.electronAPI.decodeWwiseAudio(data).then(result => {
      if (result) {
        setDecodedData(new Uint8Array(result))
      } else {
        setDecodeError(true)
      }
      setDecoding(false)
    }).catch(() => {
      setDecodeError(true)
      setDecoding(false)
    })
  }, [data, nativePlayable])

  const playableData = nativePlayable ? data : decodedData
  const audioUrl = useMemo(() => {
    if (!playableData) return null
    const blob = new Blob([playableData], { type: 'audio/wav' })
    return URL.createObjectURL(blob)
  }, [playableData])

  useEffect(() => {
    return () => { if (audioUrl) URL.revokeObjectURL(audioUrl) }
  }, [audioUrl])

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center gap-2 text-sm text-gray-400">
        <span className="text-lg">{'\u{1F3B5}'}</span>
        <span className="font-mono">{name}</span>
      </div>
      {decoding ? (
        <div className="flex items-center gap-2 text-sm text-blue-300">
          <div className="w-48">
            <div className="h-1.5 bg-gray-700 rounded-full overflow-hidden">
              <div className="h-full bg-blue-500 rounded-full" style={{
                animation: 'progress-slide 1.2s ease-in-out infinite',
                width: '40%',
              }} />
            </div>
          </div>
          <span>Decoding {fmtName} audio...</span>
        </div>
      ) : audioUrl ? (
        <audio controls className="w-full" src={audioUrl} />
      ) : decodeError ? (
        <div className="text-sm text-gray-400 bg-gray-800 rounded px-3 py-2 border border-gray-700">
          <span className="text-amber-400">Could not decode audio</span>
          <span className="text-gray-500 ml-2">({fmtName})</span>
          <p className="text-xs text-gray-500 mt-1">vgmstream-cli.exe may be missing from resources/. Extract the file to play externally.</p>
        </div>
      ) : null}
      <div className="flex items-center gap-3 text-xs text-gray-500">
        <span>Size: {formatSize(data.length)}</span>
        <span>Format: {fmtName}</span>
        {decodedData && <span className="text-green-400">Decoded to PCM</span>}
        {data.length >= 28 && fmtCode !== null && (
          <span>{(data[24] | (data[25] << 8) | (data[26] << 16) | (data[27] << 24))} Hz</span>
        )}
        {data.length >= 24 && fmtCode !== null && (
          <span>{data[22] | (data[23] << 8)} ch</span>
        )}
      </div>
    </div>
  )
}

// --- Wwise SoundBank header preview ---

/** Full parsed bank info from IPC (matches preload type) */
interface WwiseBankParsed {
  bankVersion: number
  bankId: number
  embeddedFiles: { id: number; size: number }[]
  hirc: {
    totalCount: number
    sounds: { id: number; sourceId: number; streamType: number; pluginId: number }[]
    actions: { id: number; actionType: number; actionTypeName: string; referenceId: number }[]
    events: { id: number; actionIds: number[] }[]
    otherTypeCounts: { type: number; typeName: string; count: number }[]
  } | null
  stid: { id: number; name: string }[] | null
  fileLabels: { fileId: number; eventIds: number[]; labels: string[] }[]
}

/** Inline .wem audio player for a single embedded file */
function WemPlayer({ assetName, fileId }: { assetName: string; fileId: number }) {
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      if (audioUrl) URL.revokeObjectURL(audioUrl)
    }
  }, [audioUrl])

  const handlePlay = useCallback(async () => {
    if (state === 'loading') return
    if (audioUrl) {
      // Already decoded — toggle visibility by resetting
      URL.revokeObjectURL(audioUrl)
      setAudioUrl(null)
      setState('idle')
      return
    }
    setState('loading')
    try {
      const wavData = await window.electronAPI.previewWem(assetName, fileId)
      if (!mountedRef.current) {
        // Component unmounted while we were decoding — do not update state
        return
      }
      if (wavData && wavData.length > 0) {
        const blob = new Blob([wavData], { type: 'audio/wav' })
        setAudioUrl(URL.createObjectURL(blob))
        setState('ready')
      } else {
        setState('error')
      }
    } catch {
      if (mountedRef.current) setState('error')
    }
  }, [assetName, fileId, audioUrl, state])

  return (
    <span className="inline-flex items-center gap-1">
      <button
        onClick={handlePlay}
        disabled={state === 'loading'}
        className={`text-xs px-1.5 py-0.5 rounded transition-colors ${
          state === 'loading' ? 'text-gray-500 bg-gray-800' :
          state === 'ready' ? 'text-green-400 hover:text-green-300 bg-green-900/30' :
          state === 'error' ? 'text-red-400 bg-red-900/20' :
          'text-blue-400 hover:text-blue-300 hover:bg-blue-900/30'
        }`}
        title={state === 'error' ? 'Decode failed (vgmstream missing?)' : state === 'ready' ? 'Hide player' : 'Preview audio'}
      >
        {state === 'loading' ? '\u23F3' : state === 'ready' ? '\u23F9' : state === 'error' ? '\u26A0' : '\u25B6'}
      </button>
      {state === 'ready' && audioUrl && (
        <audio controls autoPlay className="h-7" style={{ maxWidth: '220px' }} src={audioUrl} />
      )}
    </span>
  )
}

function WwiseBankPreview({ data, assetName }: { data: Uint8Array; assetName: string }) {
  // Parse BKHD section header from local data for quick display
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  let bankVersion = 0
  let bankId = 0

  if (data.length >= 16) {
    bankVersion = view.getUint32(8, true)
    bankId = view.getUint32(12, true)
  }

  // Scan sections from local data
  const sections: { name: string; offset: number; size: number }[] = []
  let pos = 0
  while (pos + 8 <= data.length) {
    const tag = String.fromCharCode(data[pos], data[pos + 1], data[pos + 2], data[pos + 3])
    const size = view.getUint32(pos + 4, true)
    if (/^[A-Z]{4}$/.test(tag) || tag === 'BKHD' || tag === 'DIDX' || tag === 'DATA' || tag === 'HIRC' || tag === 'STID') {
      sections.push({ name: tag, offset: pos, size })
      pos += 8 + size
    } else {
      break
    }
  }

  // Fetch full parsed bank info via IPC (includes HIRC + STID + file labels)
  const [bankInfo, setBankInfo] = useState<WwiseBankParsed | null>(null)
  const [extracting, setExtracting] = useState(false)
  const [extractStatus, setExtractStatus] = useState<string | null>(null)
  const [showInfo, setShowInfo] = useState(false)
  const [showRawData, setShowRawData] = useState(false)

  useEffect(() => {
    let cancelled = false
    window.electronAPI.parseWwiseBank(assetName).then(info => {
      if (!cancelled && info) {
        setBankInfo(info)
      }
    })
    return () => { cancelled = true }
  }, [assetName])

  // Build lookup: fileId → labels
  const fileLabelMap = useMemo(() => {
    if (!bankInfo?.fileLabels) return new Map<number, string[]>()
    const map = new Map<number, string[]>()
    for (const fl of bankInfo.fileLabels) {
      map.set(fl.fileId, fl.labels)
    }
    return map
  }, [bankInfo?.fileLabels])

  const embeddedFiles = bankInfo?.embeddedFiles ?? null

  const handleExtractAll = useCallback(async () => {
    const dir = await window.electronAPI.selectDirectory()
    if (!dir) return
    setExtracting(true)
    setExtractStatus(null)
    try {
      const result = await window.electronAPI.extractAllWwiseAudio(assetName, dir)
      setExtractStatus(`Extracted ${result.success} file${result.success !== 1 ? 's' : ''}${result.failed ? `, ${result.failed} failed` : ''}`)
    } catch (e) {
      setExtractStatus(`Error: ${e}`)
    }
    setExtracting(false)
  }, [assetName])

  const handleExtractSingle = useCallback(async (fileId: number) => {
    const dir = await window.electronAPI.selectDirectory()
    if (!dir) return
    setExtracting(true)
    try {
      const result = await window.electronAPI.extractWwiseAudio(assetName, fileId, dir)
      if (result) {
        setExtractStatus(`Extracted ${fileId}.wem (${formatSize(result.data.length)})`)
      }
    } catch (e) {
      setExtractStatus(`Error: ${e}`)
    }
    setExtracting(false)
  }, [assetName])

  // Bank name from STID
  const bankName = bankInfo?.stid?.find(s => s.id === bankId)?.name ?? null

  return (
    <div className="p-4 space-y-3 overflow-auto flex-1">
      {/* Embedded audio files — always shown first */}
      {embeddedFiles && embeddedFiles.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-400">Embedded Audio: {embeddedFiles.length} file{embeddedFiles.length !== 1 ? 's' : ''}</span>
            <button
              onClick={handleExtractAll}
              disabled={extracting}
              className="px-2 py-0.5 bg-blue-700 hover:bg-blue-600 disabled:bg-gray-700 disabled:text-gray-500 rounded text-xs transition-colors"
            >
              {extracting ? 'Extracting...' : 'Extract All .wem'}
            </button>
          </div>
          <table className="text-xs font-mono w-full">
            <thead>
              <tr className="text-gray-500 border-b border-gray-700">
                <th className="text-left py-1 pr-3">File ID</th>
                <th className="text-left py-1 pr-3">Labels</th>
                <th className="text-right py-1 pr-3">Size</th>
                <th className="text-right py-1 pr-1">Actions</th>
              </tr>
            </thead>
            <tbody>
              {embeddedFiles.map(f => {
                const labels = fileLabelMap.get(f.id)
                return (
                  <tr key={f.id} className="text-gray-300 hover:bg-gray-800/50 group">
                    <td className="py-0.5 pr-3 text-amber-400">{f.id}</td>
                    <td className="py-0.5 pr-3">
                      {labels && labels.length > 0 ? (
                        <span className="flex flex-wrap gap-1">
                          {labels.map((lbl, i) => (
                            <span key={i} className={`px-1 py-0 rounded text-[10px] ${
                              lbl.startsWith('Event:') ? 'bg-purple-900/30 text-purple-300 border border-purple-800/40' :
                              'bg-gray-700/50 text-gray-400 border border-gray-600/30'
                            }`}>
                              {lbl}
                            </span>
                          ))}
                        </span>
                      ) : (
                        <span className="text-gray-600">-</span>
                      )}
                    </td>
                    <td className="py-0.5 pr-3 text-right text-gray-400">{formatSize(f.size)}</td>
                    <td className="py-0.5 pr-1 text-right whitespace-nowrap">
                      <WemPlayer assetName={assetName} fileId={f.id} />
                      <button
                        onClick={() => handleExtractSingle(f.id)}
                        disabled={extracting}
                        className="text-blue-400 hover:text-blue-300 disabled:text-gray-600 ml-1 text-xs"
                      >
                        Extract
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {extractStatus && (
            <p className="text-xs text-gray-400">{extractStatus}</p>
          )}
        </div>
      )}
      {embeddedFiles && embeddedFiles.length === 0 && (
        <p className="text-xs text-gray-500">No embedded audio files (event-only bank)</p>
      )}

      {/* Media-only bank indicator */}
      {bankInfo && !bankInfo.hirc && sections.some(s => s.name === 'DIDX') && (
        <div className="text-xs text-gray-500 bg-gray-800/50 rounded px-2 py-1 border border-gray-700/50">
          Media-only bank (no HIRC hierarchy). Audio files are referenced by events in other banks.
        </div>
      )}

      {/* Info + Raw Data toggle buttons */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => setShowInfo(!showInfo)}
          className="px-2 py-0.5 bg-gray-700 hover:bg-gray-600 rounded text-xs text-gray-300 transition-colors"
        >
          {showInfo ? 'Hide Info' : 'Info'}
        </button>
        <button
          onClick={() => setShowRawData(!showRawData)}
          className="px-2 py-0.5 bg-gray-700 hover:bg-gray-600 rounded text-xs text-gray-300 transition-colors"
        >
          {showRawData ? 'Hide Raw Data' : 'Raw Data'}
        </button>
      </div>

      {/* Collapsible Info section */}
      {showInfo && (
        <div className="space-y-3 border border-gray-700 rounded p-3 bg-gray-800/30">
          {/* Header line */}
          <div className="text-sm flex items-center gap-2 flex-wrap">
            <span className="text-gray-400">Version: {bankVersion}</span>
            <span className="text-gray-600">|</span>
            <span className="text-gray-400">Bank ID: 0x{bankId.toString(16).toUpperCase()}</span>
            {bankName && (
              <>
                <span className="text-gray-600">|</span>
                <span className="px-1.5 py-0.5 bg-cyan-900/40 border border-cyan-800/50 rounded text-xs font-mono text-cyan-300">
                  {bankName}
                </span>
              </>
            )}
          </div>

          {/* Section table */}
          {sections.length > 0 && (
            <table className="text-xs font-mono w-full max-w-md">
              <thead>
                <tr className="text-gray-500 border-b border-gray-700">
                  <th className="text-left py-1 pr-4">Section</th>
                  <th className="text-right py-1 pr-4">Offset</th>
                  <th className="text-right py-1">Size</th>
                </tr>
              </thead>
              <tbody>
                {sections.map((s, i) => (
                  <tr key={i} className="text-gray-300 hover:bg-gray-800/50">
                    <td className="py-0.5 pr-4 text-cyan-400">{s.name}</td>
                    <td className="py-0.5 pr-4 text-right">0x{s.offset.toString(16).toUpperCase()}</td>
                    <td className="py-0.5 text-right">{formatSize(s.size)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {/* HIRC summary */}
          {bankInfo?.hirc && (
            <div className="space-y-1">
              <div className="text-xs text-gray-400 flex items-center gap-1">
                <span>Hierarchy: {bankInfo.hirc.totalCount} objects</span>
                <span className="text-gray-600 ml-1">
                  ({bankInfo.hirc.events.length} events, {bankInfo.hirc.actions.length} actions, {bankInfo.hirc.sounds.length} sounds)
                </span>
              </div>
              <div className="ml-3 space-y-2">
                {/* Events */}
                {bankInfo.hirc.events.length > 0 && (
                  <div>
                    <div className="text-xs text-purple-400 mb-0.5">Events ({bankInfo.hirc.events.length})</div>
                    <div className="flex flex-wrap gap-1">
                      {bankInfo.hirc.events.slice(0, 20).map(evt => (
                        <span key={evt.id} className="px-1.5 py-0.5 bg-purple-900/30 border border-purple-800/40 rounded text-[10px] font-mono text-purple-300">
                          0x{evt.id.toString(16).toUpperCase()} ({evt.actionIds.length} action{evt.actionIds.length !== 1 ? 's' : ''})
                        </span>
                      ))}
                      {bankInfo.hirc.events.length > 20 && (
                        <span className="text-[10px] text-gray-500">+{bankInfo.hirc.events.length - 20} more</span>
                      )}
                    </div>
                  </div>
                )}
                {/* Actions */}
                {bankInfo.hirc.actions.length > 0 && (
                  <div>
                    <div className="text-xs text-green-400 mb-0.5">Actions ({bankInfo.hirc.actions.length})</div>
                    <div className="flex flex-wrap gap-1">
                      {bankInfo.hirc.actions.slice(0, 20).map(act => (
                        <span key={act.id} className="px-1.5 py-0.5 bg-green-900/30 border border-green-800/40 rounded text-[10px] font-mono text-green-300">
                          {act.actionTypeName}
                        </span>
                      ))}
                      {bankInfo.hirc.actions.length > 20 && (
                        <span className="text-[10px] text-gray-500">+{bankInfo.hirc.actions.length - 20} more</span>
                      )}
                    </div>
                  </div>
                )}
                {/* Sounds */}
                {bankInfo.hirc.sounds.length > 0 && (
                  <div>
                    <div className="text-xs text-amber-400 mb-0.5">Sounds ({bankInfo.hirc.sounds.length})</div>
                    <div className="flex flex-wrap gap-1 text-[10px] text-gray-400">
                      {(() => {
                        const embedded = bankInfo.hirc.sounds.filter(s => s.streamType === 0).length
                        const prefetch = bankInfo.hirc.sounds.filter(s => s.streamType === 1).length
                        const streamed = bankInfo.hirc.sounds.filter(s => s.streamType === 2).length
                        return (
                          <>
                            {embedded > 0 && <span>{embedded} embedded</span>}
                            {prefetch > 0 && <span>{prefetch} prefetch</span>}
                            {streamed > 0 && <span>{streamed} streamed</span>}
                          </>
                        )
                      })()}
                    </div>
                  </div>
                )}
                {/* Other types */}
                {bankInfo.hirc.otherTypeCounts.length > 0 && (
                  <div className="text-[10px] text-gray-500">
                    Other: {bankInfo.hirc.otherTypeCounts.map(t => `${t.typeName}(${t.count})`).join(', ')}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Collapsible Raw Data section */}
      {showRawData && (
        <div className="overflow-auto max-h-[400px]">
          <HexDump data={data} maxRows={32} />
        </div>
      )}
    </div>
  )
}

// --- Blob preview with format analysis and batch extraction ---
function BlobPreview({ data, assetData, selectedAsset }: {
  data: Uint8Array
  assetData: AssetData
  selectedAsset: AssetEntry
}) {
  const [extracting, setExtracting] = useState(false)
  const [extractStatus, setExtractStatus] = useState<string | null>(null)
  const [showRawData, setShowRawData] = useState(false)
  const blobType = assetData.blobType
  const typeName = BLOB_TYPE_NAMES[blobType] || `Unknown (${blobType})`
  const ext = BLOB_TYPE_EXT[blobType] || '.bin'
  const details = useMemo(() => parseBlobDetails(data, blobType), [data, blobType])
  const hasVisualPreview = isBlobPreviewable(blobType, data)
  const [showInfo, setShowInfo] = useState(!hasVisualPreview)

  const handleExtractAllOfType = useCallback(async () => {
    const dir = await window.electronAPI.selectDirectory()
    if (!dir) return
    setExtracting(true)
    setExtractStatus(null)
    try {
      const result = await window.electronAPI.extractBlobsByType(blobType, dir)
      setExtractStatus(`Extracted ${result.success} ${typeName.toLowerCase()} file${result.success !== 1 ? 's' : ''} (${ext})${result.failed ? `, ${result.failed} failed` : ''}`)
    } catch (e) {
      setExtractStatus(`Error: ${e}`)
    }
    setExtracting(false)
  }, [blobType, typeName, ext])

  const needsFlex = blobType === 5 || blobType === 12 // animation / skeleton viewers need flex fill

  return (
    <div className={`p-4 space-y-3 ${needsFlex ? 'flex flex-col h-full' : ''}`}>
      {selectedAsset.type === 'blob' && blobType >= 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-gray-400">Type:</span>
            <span className="text-cyan-400">{typeName}</span>
            <span className="text-gray-600">|</span>
            <span className="text-gray-400">{formatSize(assetData.totalSize)}</span>
            <span className="text-gray-600">|</span>
            <span className="text-gray-500 font-mono text-xs">{ext}</span>
            {hasVisualPreview && details && (
              <button
                onClick={() => setShowInfo(!showInfo)}
                className="ml-auto px-2 py-0.5 bg-gray-700 hover:bg-gray-600 rounded text-xs text-gray-300 transition-colors"
              >
                {showInfo ? 'Hide Info' : 'Info'}
              </button>
            )}
          </div>

          {/* Format-specific details (collapsed by default for previewable types) */}
          {details && showInfo && (
            <div className="max-h-48 overflow-y-auto">
              <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs max-w-sm pl-1">
                {Object.entries(details).map(([key, value]) => (
                  <React.Fragment key={key}>
                    <span className="text-gray-500">{key}</span>
                    <span className="text-gray-300 font-mono">{value}</span>
                  </React.Fragment>
                ))}
              </div>
            </div>
          )}

          {/* Batch extract button */}
          {showInfo && (
            <div className="flex items-center gap-2">
              <button
                onClick={handleExtractAllOfType}
                disabled={extracting}
                className="px-2 py-0.5 bg-blue-700 hover:bg-blue-600 disabled:bg-gray-700 disabled:text-gray-500 rounded text-xs transition-colors"
              >
                {extracting ? 'Extracting...' : `Extract All ${typeName}s`}
              </button>
              {extractStatus && (
                <span className="text-xs text-gray-400">{extractStatus}</span>
              )}
            </div>
          )}
        </div>
      )}

      {/* Type-specific visual previews */}
      {(blobType === 0 || blobType === 1) && (
        <HeightmapPreview data={data} details={details} />
      )}
      {blobType === 2 && (
        <IDMapPreview data={data} details={details} />
      )}
      {blobType === 9 && (
        <BlendMeshPreview data={data} details={details} />
      )}
      {blobType === 5 && details && showInfo && <AnimationSummary data={data} details={details} />}
      {blobType === 5 && <AnimationSkeletonViewer animationName={selectedAsset.name} />}
      {blobType === 12 && <SkeletonViewer assetName={selectedAsset.name} />}

      {/* Description for types without visual preview */}
      {!hasVisualPreview && (
        <div className="text-xs space-y-1 px-1">
          {BLOB_TYPE_DESC[blobType] && (
            <p className="text-gray-500">{BLOB_TYPE_DESC[blobType]}</p>
          )}
          <p className="text-gray-600">No visual preview available for this format. Use Raw Data or Extract to inspect.</p>
          <p className="text-gray-700 italic">Format identification is experimental and may be inaccurate.</p>
        </div>
      )}

      {/* Raw hex dump toggle */}
      <div>
        <button
          onClick={() => setShowRawData(!showRawData)}
          className="px-2 py-0.5 bg-gray-700 hover:bg-gray-600 rounded text-xs text-gray-300 transition-colors"
        >
          {showRawData ? 'Hide Raw Data' : 'Raw Data'}
        </button>
        {showRawData && (
          <div className="mt-2 overflow-auto max-h-[400px]">
            <HexDump data={data} maxRows={32} />
            {assetData.truncated && (
              <p className="text-xs text-gray-500">
                Showing first {formatSize(data.length)} of {formatSize(assetData.totalSize)}. Extract to view full file.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// --- Animation visual summary ---
function AnimationSummary({ data, details }: { data: Uint8Array; details: Record<string, string> }) {
  const frameCount = details['Frame Count'] ? parseInt(details['Frame Count'].replace(/,/g, '')) : 0
  const duration = details['Duration'] ? parseFloat(details['Duration']) : 0
  const fps = details['Frame Rate'] ? parseFloat(details['Frame Rate']) : 0
  const boneCount = details['Bone Count'] ? parseInt(details['Bone Count']) : 0
  const format = details['Format'] || ''
  const animName = details['Animation Name'] || ''

  return (
    <div className="space-y-2">
      {/* Animation name badge */}
      {animName && (
        <div className="flex items-center gap-2">
          <span className="px-2 py-0.5 bg-cyan-900/40 border border-cyan-800/50 rounded text-xs font-mono text-cyan-300">
            {animName}
          </span>
          <span className="text-xs text-gray-600">{format}</span>
        </div>
      )}

      {/* Stats row */}
      <div className="flex items-center gap-3 text-xs">
        {boneCount > 0 && (
          <span className="text-gray-400">
            <span className="text-gray-300 font-medium">{boneCount}</span> bones
          </span>
        )}
        {frameCount > 0 && (
          <span className="text-gray-400">
            <span className="text-gray-300 font-medium">{frameCount.toLocaleString()}</span> frames
          </span>
        )}
        {fps > 0 && (
          <span className="text-gray-400">
            <span className="text-gray-300 font-medium">{fps.toFixed(0)}</span> fps
          </span>
        )}
        {duration > 0 && (
          <span className="text-gray-400">
            <span className="text-gray-300 font-medium">{duration.toFixed(2)}</span>s
          </span>
        )}
      </div>

      {/* Timeline bar */}
      {frameCount > 0 && (
        <div className="space-y-1">
          <div className="flex items-center justify-between text-xs text-gray-500">
            <span>0</span>
            <span>{duration > 0 ? `${duration.toFixed(2)}s` : `${frameCount} frames`}</span>
          </div>
          <div className="h-3 bg-gray-800 rounded overflow-hidden relative">
            <div className="absolute inset-0 flex">
              {Array.from({ length: Math.min(frameCount, 60) }, (_, i) => (
                <div
                  key={i}
                  className="flex-1 border-r border-gray-700"
                  style={{ opacity: i % 10 === 0 ? 0.8 : 0.3 }}
                />
              ))}
            </div>
            <div className="absolute inset-0 bg-gradient-to-r from-cyan-600/40 via-blue-600/40 to-purple-600/40 rounded" />
          </div>
        </div>
      )}
    </div>
  )
}

// --- Animation skeleton finder (finds skeleton in BLP, renders SkeletonViewer with auto-play) ---
function AnimationSkeletonViewer({ animationName }: { animationName: string }) {
  const [skeletonName, setSkeletonName] = useState<string | null>(null)
  const [searched, setSearched] = useState(false)

  useEffect(() => {
    setSkeletonName(null)
    setSearched(false)
    window.electronAPI.listSkeletons().then(skels => {
      setSearched(true)
      if (skels.length > 0) setSkeletonName(skels[0].name)
    }).catch(() => setSearched(true))
  }, [animationName])

  if (!searched) return <div className="text-xs text-gray-500">Finding skeleton...</div>
  if (!skeletonName) return <div className="text-xs text-gray-600">No skeleton found in this BLP</div>

  return <SkeletonViewer assetName={skeletonName} initialAnimation={animationName} />
}

// --- Heightmap preview (renders hmu0 uint16 or raw float32 grid as grayscale image) ---
function HeightmapPreview({ data, details }: { data: Uint8Array; details: Record<string, string> | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [zoom, setZoom] = useState(1)

  const gridInfo = useMemo(() => {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
    const magic = data.length >= 4 ? String.fromCharCode(data[0], data[1], data[2], data[3]) : ''

    // hmu0 format: 32B header + uint16 grid
    if (magic === 'hmu0' && data.length >= 32) {
      const w = view.getUint32(4, true)
      const h = view.getUint32(8, true)
      if (w > 0 && w <= 4096 && h > 0 && h <= 4096 && data.length >= 32 + w * h * 2) {
        return { width: w, height: h, offset: 32, format: 'uint16' as const }
      }
    }
    // Fallback: raw float32 sqrt grid
    const totalFloats = Math.floor(data.length / 4)
    const sqrt = Math.round(Math.sqrt(totalFloats))
    if (sqrt * sqrt === totalFloats && sqrt > 1) {
      return { width: sqrt, height: sqrt, offset: 0, format: 'float32' as const }
    }
    return null
  }, [data])

  useEffect(() => {
    if (!canvasRef.current || !gridInfo) return
    const { width, height, offset, format } = gridInfo
    const canvas = canvasRef.current
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
    const imgData = ctx.createImageData(width, height)
    const pixelCount = width * height

    if (format === 'uint16') {
      // Find min/max for normalization
      let min = 65535, max = 0
      for (let i = 0; i < pixelCount; i++) {
        const v = view.getUint16(offset + i * 2, true)
        if (v < min) min = v
        if (v > max) max = v
      }
      const range = max - min || 1
      for (let i = 0; i < pixelCount; i++) {
        const v = view.getUint16(offset + i * 2, true)
        const byte = Math.round(((v - min) / range) * 255)
        const idx = i * 4
        imgData.data[idx] = byte
        imgData.data[idx + 1] = byte
        imgData.data[idx + 2] = byte
        imgData.data[idx + 3] = 255
      }
    } else {
      // float32 path
      let min = Infinity, max = -Infinity
      for (let i = 0; i < pixelCount; i++) {
        const v = view.getFloat32(offset + i * 4, true)
        if (isFinite(v)) { min = Math.min(min, v); max = Math.max(max, v) }
      }
      const range = max - min || 1
      for (let i = 0; i < pixelCount; i++) {
        const v = view.getFloat32(offset + i * 4, true)
        const normalized = isFinite(v) ? (v - min) / range : 0
        const byte = Math.round(normalized * 255)
        const idx = i * 4
        imgData.data[idx] = byte
        imgData.data[idx + 1] = byte
        imgData.data[idx + 2] = byte
        imgData.data[idx + 3] = 255
      }
    }

    ctx.putImageData(imgData, 0, 0)
  }, [data, gridInfo])

  if (!gridInfo) return null

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3 text-xs">
        <span className="text-gray-400">
          <span className="text-gray-300 font-medium">{gridInfo.width}x{gridInfo.height}</span> grid
        </span>
        <span className="text-gray-500">{gridInfo.format === 'uint16' ? 'uint16' : 'float32'}</span>
        {details?.['Height Range'] && (
          <span className="text-gray-400">Range: <span className="text-gray-300 font-mono">{details['Height Range']}</span></span>
        )}
        <span className="text-gray-400 cursor-pointer hover:text-gray-200" onClick={() => setZoom(z => z === 1 ? 2 : z === 2 ? 4 : 1)}>
          Zoom: {Math.round(zoom * 100)}%
        </span>
      </div>
      <div className="overflow-auto max-h-[400px] bg-gray-900 rounded border border-gray-700">
        <canvas
          ref={canvasRef}
          style={{
            display: 'block',
            width: gridInfo.width * zoom,
            height: gridInfo.height * zoom,
            imageRendering: zoom > 1 ? 'pixelated' : 'auto',
          }}
        />
      </div>
    </div>
  )
}

// --- ID Map preview (renders IDM0 or raw uint8 grid as color-indexed image) ---
const FALLBACK_COLORS = [
  [0, 0, 0], [31, 119, 180], [255, 127, 14], [44, 160, 44], [214, 39, 40],
  [148, 103, 189], [140, 86, 75], [227, 119, 194], [127, 127, 127],
  [188, 189, 34], [23, 190, 207], [65, 68, 81], [174, 199, 232],
  [255, 187, 120], [152, 223, 138], [255, 152, 150], [197, 176, 213],
]

function IDMapPreview({ data, details }: { data: Uint8Array; details: Record<string, string> | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [zoom, setZoom] = useState(1)

  const gridInfo = useMemo(() => {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
    const magic = data.length >= 4 ? String.fromCharCode(data[0], data[1], data[2], data[3]) : ''

    // IDM0 format: magic(4) + width(4) + height(4) + materialCount(4) + palette(matCount*3) + uint8 grid
    if (magic === 'IDM0' && data.length >= 16) {
      const w = view.getUint32(4, true)
      const h = view.getUint32(8, true)
      const matCount = view.getUint32(12, true)
      const headerSize = 16 + matCount * 3
      if (w > 0 && w <= 4096 && h > 0 && h <= 4096 && matCount <= 256 && data.length >= headerSize + w * h) {
        // Read embedded RGB palette
        const palette: [number, number, number][] = []
        for (let i = 0; i < matCount; i++) {
          const off = 16 + i * 3
          palette.push([data[off], data[off + 1], data[off + 2]])
        }
        return { width: w, height: h, offset: headerSize, palette }
      }
    }
    // Fallback: raw uint8 square grid
    const sqrt = Math.round(Math.sqrt(data.length))
    if (sqrt * sqrt === data.length && sqrt > 1) {
      return { width: sqrt, height: sqrt, offset: 0, palette: null }
    }
    return null
  }, [data])

  useEffect(() => {
    if (!canvasRef.current || !gridInfo) return
    const { width, height, offset, palette } = gridInfo
    const canvas = canvasRef.current
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const imgData = ctx.createImageData(width, height)
    for (let i = 0; i < width * height; i++) {
      const id = data[offset + i]
      let r: number, g: number, b: number
      if (palette && id < palette.length) {
        [r, g, b] = palette[id]
      } else {
        [r, g, b] = FALLBACK_COLORS[id % FALLBACK_COLORS.length]
      }
      const idx = i * 4
      imgData.data[idx] = r
      imgData.data[idx + 1] = g
      imgData.data[idx + 2] = b
      imgData.data[idx + 3] = 255
    }
    ctx.putImageData(imgData, 0, 0)
  }, [data, gridInfo])

  if (!gridInfo) return null

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3 text-xs">
        <span className="text-gray-400">
          <span className="text-gray-300 font-medium">{gridInfo.width}x{gridInfo.height}</span> grid
        </span>
        {gridInfo.palette && (
          <span className="text-gray-500">{gridInfo.palette.length} materials</span>
        )}
        {details?.['Unique IDs'] && (
          <span className="text-gray-400"><span className="text-gray-300 font-medium">{details['Unique IDs']}</span> unique IDs</span>
        )}
        <span className="text-gray-400 cursor-pointer hover:text-gray-200" onClick={() => setZoom(z => z === 1 ? 2 : z === 2 ? 4 : 1)}>
          Zoom: {Math.round(zoom * 100)}%
        </span>
      </div>
      {/* Palette swatch row */}
      {gridInfo.palette && gridInfo.palette.length > 0 && (
        <div className="flex items-center gap-0.5 flex-wrap">
          {gridInfo.palette.map(([r, g, b], i) => (
            <div
              key={i}
              title={`Material ${i}: rgb(${r},${g},${b})`}
              className="w-4 h-4 rounded-sm border border-gray-600"
              style={{ backgroundColor: `rgb(${r},${g},${b})` }}
            />
          ))}
        </div>
      )}
      <div className="overflow-auto max-h-[400px] bg-gray-900 rounded border border-gray-700">
        <canvas
          ref={canvasRef}
          style={{
            display: 'block',
            width: gridInfo.width * zoom,
            height: gridInfo.height * zoom,
            imageRendering: zoom > 1 ? 'pixelated' : 'auto',
          }}
        />
      </div>
    </div>
  )
}

// --- Blend Mesh preview (renders bmu0 uint8 grid as grayscale image) ---
function BlendMeshPreview({ data, details }: { data: Uint8Array; details: Record<string, string> | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [zoom, setZoom] = useState(1)

  const gridInfo = useMemo(() => {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
    const magic = data.length >= 4 ? String.fromCharCode(data[0], data[1], data[2], data[3]) : ''

    // bmu0 format: magic(4) + width(4) + height(4) + padding(4) + uint8 grid
    if (magic === 'bmu0' && data.length >= 16) {
      const w = view.getUint32(4, true)
      const h = view.getUint32(8, true)
      if (w > 0 && w <= 4096 && h > 0 && h <= 4096 && data.length >= 16 + w * h) {
        return { width: w, height: h, offset: 16 }
      }
    }
    return null
  }, [data])

  useEffect(() => {
    if (!canvasRef.current || !gridInfo) return
    const { width, height, offset } = gridInfo
    const canvas = canvasRef.current
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const imgData = ctx.createImageData(width, height)
    for (let i = 0; i < width * height; i++) {
      const v = data[offset + i]
      const idx = i * 4
      imgData.data[idx] = v
      imgData.data[idx + 1] = v
      imgData.data[idx + 2] = v
      imgData.data[idx + 3] = 255
    }
    ctx.putImageData(imgData, 0, 0)
  }, [data, gridInfo])

  if (!gridInfo) return null

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3 text-xs">
        <span className="text-gray-400">
          <span className="text-gray-300 font-medium">{gridInfo.width}x{gridInfo.height}</span> grid
        </span>
        <span className="text-gray-500">uint8 blend weights</span>
        {details?.['Unique Values'] && (
          <span className="text-gray-400"><span className="text-gray-300 font-medium">{details['Unique Values']}</span> unique values</span>
        )}
        <span className="text-gray-400 cursor-pointer hover:text-gray-200" onClick={() => setZoom(z => z === 1 ? 2 : z === 2 ? 4 : 1)}>
          Zoom: {Math.round(zoom * 100)}%
        </span>
      </div>
      <div className="overflow-auto max-h-[400px] bg-gray-900 rounded border border-gray-700">
        <canvas
          ref={canvasRef}
          style={{
            display: 'block',
            width: gridInfo.width * zoom,
            height: gridInfo.height * zoom,
            imageRendering: zoom > 1 ? 'pixelated' : 'auto',
          }}
        />
      </div>
    </div>
  )
}

// --- Determine if a blob type is previewable ---
function isBlobPreviewable(blobType: number, data: Uint8Array): boolean {
  const magic = data.length >= 4 ? String.fromCharCode(data[0], data[1], data[2], data[3]) : ''

  // Heightmap - hmu0 or raw float32 grid
  if (blobType === 0 || blobType === 1) {
    if (magic === 'hmu0' && data.length >= 32) {
      const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
      const w = view.getUint32(4, true)
      const h = view.getUint32(8, true)
      if (w > 0 && w <= 4096 && h > 0 && h <= 4096 && data.length >= 32 + w * h * 2) return true
    }
    const totalFloats = Math.floor(data.length / 4)
    const sqrt = Math.round(Math.sqrt(totalFloats))
    if (sqrt * sqrt === totalFloats && sqrt > 1) return true
    return false
  }
  // ID Map - IDM0 or raw uint8 square grid
  if (blobType === 2) {
    if (magic === 'IDM0' && data.length >= 16) {
      const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
      const w = view.getUint32(4, true)
      const h = view.getUint32(8, true)
      const matCount = view.getUint32(12, true)
      const headerSize = 16 + matCount * 3
      if (w > 0 && w <= 4096 && h > 0 && h <= 4096 && matCount <= 256 && data.length >= headerSize + w * h) return true
    }
    const sqrt = Math.round(Math.sqrt(data.length))
    return sqrt * sqrt === data.length && sqrt > 1
  }
  // Blend Mesh - bmu0
  if (blobType === 9) {
    if (magic === 'bmu0' && data.length >= 16) {
      const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
      const w = view.getUint32(4, true)
      const h = view.getUint32(8, true)
      if (w > 0 && w <= 4096 && h > 0 && h <= 4096 && data.length >= 16 + w * h) return true
    }
    return false
  }
  // Animation - always show analysis
  if (blobType === 5) return true
  // WAV audio handled upstream
  if (blobType === 7) return true
  // Skeleton - 3D viewer
  if (blobType === 12) return true
  return false
}

function ActionButtons({ onExtract, onReplace, onRevert, isReplaced, experimentalEnabled }: {
  onExtract: () => void
  onReplace?: () => void
  onRevert?: () => void
  isReplaced?: boolean
  experimentalEnabled?: boolean
}) {
  return (
    <div className="flex items-center gap-1">
      {isReplaced && onRevert && (
        <button
          onClick={onRevert}
          className="px-2 py-0.5 bg-amber-700 hover:bg-amber-600 rounded text-xs transition-colors"
        >
          Revert
        </button>
      )}
      {onReplace ? (
        <button
          onClick={onReplace}
          className="px-2 py-0.5 bg-blue-700 hover:bg-blue-600 rounded text-xs transition-colors"
        >
          Replace
        </button>
      ) : !experimentalEnabled && (
        <button
          disabled
          title="Enable experimental features in Settings to use Replace"
          className="px-2 py-0.5 bg-gray-800 text-gray-500 rounded text-xs cursor-not-allowed"
        >
          Replace
        </button>
      )}
      <button
        onClick={onExtract}
        className="px-2 py-0.5 bg-gray-700 hover:bg-gray-600 rounded text-xs transition-colors"
      >
        Extract
      </button>
    </div>
  )
}

export function PreviewPanel({ selectedAsset, preview, assetData, loading, onExtract, onReplace, onRevert, isReplaced, onCopyImage, experimentalEnabled, onPainted }: PreviewPanelProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [zoom, setZoom] = useState(1)
  const [canvasContextMenu, setCanvasContextMenu] = useState<CanvasContextMenuState | null>(null)
  const canvasMenuRef = useRef<HTMLDivElement>(null)
  const [pickedColor, setPickedColor] = useState<PickedColor | null>(null)
  const [ctrlHeld, setCtrlHeld] = useState(false)
  const [hoverPixel, setHoverPixel] = useState<{ x: number; y: number } | null>(null)
  const [canvasRect, setCanvasRect] = useState<DOMRect | null>(null)
  const lastHoverRef = useRef<{ x: number; y: number } | null>(null)
  const [gridSize, setGridSize] = useState(0)

  // Track Ctrl key for magnifier
  useEffect(() => {
    const down = (e: KeyboardEvent) => { if (e.key === 'Control') setCtrlHeld(true) }
    const up = (e: KeyboardEvent) => { if (e.key === 'Control') setCtrlHeld(false) }
    const blur = () => setCtrlHeld(false)
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', blur)
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', blur) }
  }, [])

  const handleCanvasMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!canvasRef.current || !preview) return
    const rect = canvasRef.current.getBoundingClientRect()
    const px = Math.floor((e.clientX - rect.left) / zoom)
    const py = Math.floor((e.clientY - rect.top) / zoom)
    if (px >= 0 && py >= 0 && px < preview.width && py < preview.height) {
      if (!lastHoverRef.current || lastHoverRef.current.x !== px || lastHoverRef.current.y !== py) {
        const next = { x: px, y: py }
        lastHoverRef.current = next
        setHoverPixel(next)
        setCanvasRect(rect)
      }
    } else {
      if (lastHoverRef.current) { lastHoverRef.current = null; setHoverPixel(null) }
    }
  }, [preview, zoom])

  const handleCanvasMouseLeave = useCallback(() => {
    lastHoverRef.current = null
    setHoverPixel(null)
  }, [])

  // Close context menu on outside click or Escape
  useEffect(() => {
    if (!canvasContextMenu) return
    const handleClick = (e: MouseEvent) => {
      if (canvasMenuRef.current && !canvasMenuRef.current.contains(e.target as Node)) {
        setCanvasContextMenu(null)
      }
    }
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setCanvasContextMenu(null)
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKey)
    }
  }, [canvasContextMenu])

  const handleCanvasContextMenu = useCallback((e: React.MouseEvent) => {
    if (!onCopyImage || !preview) return
    e.preventDefault()
    setCanvasContextMenu({ x: e.clientX, y: e.clientY })
  }, [onCopyImage, preview])

  useEffect(() => {
    if (!preview || !canvasRef.current) return
    // Need either bitmap (GPU-resident, from prefetch cache) or rgbaPixels (from direct fetch)
    if (!preview.bitmap && !preview.rgbaPixels) return

    const t0 = performance.now()
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    canvas.width = preview.width
    canvas.height = preview.height

    if (preview.bitmap) {
      // GPU-resident ImageBitmap — instant draw, no V8 heap pressure
      ctx.drawImage(preview.bitmap, 0, 0)
    } else if (preview.rgbaPixels) {
      // Direct pixel data (cache miss / direct fetch path)
      const imageData = new ImageData(
        new Uint8ClampedArray(preview.rgbaPixels.buffer, preview.rgbaPixels.byteOffset, preview.rgbaPixels.byteLength),
        preview.width, preview.height
      )
      ctx.putImageData(imageData, 0, 0)
    }
    const t1 = performance.now()

    // Fit-to-view: scale down so entire texture is visible, cap at 100%
    const container = scrollRef.current
    if (container) {
      const availW = container.clientWidth - 32  // 16px padding each side
      const availH = container.clientHeight - 32
      if (availW > 0 && availH > 0) {
        setZoom(Math.min(availW / preview.width, availH / preview.height, 1))
      } else {
        setZoom(1)
      }
    } else {
      setZoom(1)
    }

    window.electronAPI?.logTiming(`[canvas] ${preview.name}: ${preview.bitmap ? 'drawImage' : 'putImageData'}=${(t1 - t0).toFixed(0)}ms (${preview.width}x${preview.height})`)
    onPainted?.()
  }, [preview, onPainted])

  // Use native event listener with { passive: false } — React registers wheel as passive
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault()
      const delta = e.deltaY > 0 ? 0.9 : 1.1
      setZoom(prev => Math.max(0.1, Math.min(10, prev * delta)))
    }
    el.addEventListener('wheel', handleWheel, { passive: false })
    return () => el.removeEventListener('wheel', handleWheel)
  }, [])

  // Single click: pick color
  const handleCanvasClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (ctrlHeld || !canvasRef.current || !preview) return
    if (!preview.rgbaPixels && !preview.bitmap) return
    const rect = canvasRef.current.getBoundingClientRect()
    const px = Math.floor((e.clientX - rect.left) / zoom)
    const py = Math.floor((e.clientY - rect.top) / zoom)
    if (px >= 0 && py >= 0 && px < preview.width && py < preview.height) {
      if (preview.rgbaPixels) {
        setPickedColor(pickPixel(preview.rgbaPixels, preview.width, px, py))
      } else {
        const ctx = canvasRef.current.getContext('2d')
        if (ctx) {
          const d = ctx.getImageData(px, py, 1, 1).data
          setPickedColor({ x: px, y: py, r: d[0], g: d[1], b: d[2], a: d[3] })
        }
      }
    }
  }, [ctrlHeld, preview, zoom])

  // Double click: zoom 2x centered on clicked point
  const handleCanvasDoubleClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!canvasRef.current || !scrollRef.current || !preview) return
    const container = scrollRef.current
    const canvas = canvasRef.current

    const rect = canvas.getBoundingClientRect()
    const px = Math.floor((e.clientX - rect.left) / zoom)
    const py = Math.floor((e.clientY - rect.top) / zoom)

    // Viewport position of the click relative to scroll container
    const containerRect = container.getBoundingClientRect()
    const viewportX = e.clientX - containerRect.left
    const viewportY = e.clientY - containerRect.top

    const newZoom = Math.min(zoom * 2, 10)

    // Force synchronous render so canvas resizes immediately
    flushSync(() => setZoom(newZoom))

    // Measure actual canvas position after render, scroll so clicked pixel stays under cursor
    const newContainerRect = container.getBoundingClientRect()
    const newCanvasRect = canvas.getBoundingClientRect()
    const canvasInScrollX = newCanvasRect.left - newContainerRect.left + container.scrollLeft
    const canvasInScrollY = newCanvasRect.top - newContainerRect.top + container.scrollTop

    container.scrollLeft = canvasInScrollX + px * newZoom - viewportX
    container.scrollTop = canvasInScrollY + py * newZoom - viewportY
  }, [zoom, preview])

  const effectiveGridPx = gridSize * zoom
  const gridOpacity = effectiveGridPx >= 32 ? 0.5 : effectiveGridPx >= 16 ? 0.4 : effectiveGridPx >= 8 ? 0.35 : 0.3
  const showGridOverlay = gridSize > 0 && effectiveGridPx >= 4

  if (!selectedAsset) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-500">
        <div className="text-center">
          <div className="text-4xl mb-2">&#x1F4C1;</div>
          <p>Select an asset to preview</p>
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-400">
        <div className="w-64 text-center">
          <p className="text-sm mb-3">Loading {selectedAsset?.name || 'preview'}...</p>
          <div className="h-1.5 bg-gray-700 rounded-full overflow-hidden">
            <div className="h-full bg-blue-500 rounded-full" style={{
              animation: 'progress-slide 1.2s ease-in-out infinite',
              width: '40%',
            }} />
          </div>
        </div>
      </div>
    )
  }

  // --- Texture preview ---
  if (selectedAsset.type === 'texture' && preview && preview.tooLarge) {
    return (
      <div className="flex-1 flex flex-col">
        <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-850 border-b border-gray-700 text-sm">
          <span className="text-gray-400">{preview.width}x{preview.height}</span>
          <span className="text-gray-600">|</span>
          <span className="text-gray-400">{preview.dxgiFormatName}</span>
          <div className="flex-1" />
          <ActionButtons onExtract={onExtract} onReplace={onReplace} onRevert={onRevert} isReplaced={isReplaced} experimentalEnabled={experimentalEnabled} />
        </div>
        <div className="flex-1 flex items-center justify-center text-gray-400">
          <div className="text-center space-y-2">
            <div className="text-2xl">&#x1F4D0;</div>
            <p className="text-sm">Texture too large for preview ({preview.width}x{preview.height})</p>
            <p className="text-xs text-gray-500">Extract to view as DDS file</p>
          </div>
        </div>
      </div>
    )
  }

  if (selectedAsset.type === 'texture' && preview && (preview.rgbaPixels || preview.bitmap)) {
    return (
      <div className="flex-1 flex flex-col">
        <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-850 border-b border-gray-700 text-sm">
          <span className="text-gray-400">{preview.width}x{preview.height}</span>
          <span className="text-gray-600">|</span>
          <span className="text-gray-400">{preview.dxgiFormatName}</span>
          {selectedAsset.metadata.rawSize && (
            <><span className="text-gray-600">|</span><span className="text-gray-500">{formatSize(selectedAsset.metadata.rawSize as number)}</span></>
          )}
          <span className="text-gray-600">|</span>
          <span className="text-gray-400 cursor-pointer hover:text-gray-200 transition-colors" onClick={() => {
            const container = scrollRef.current
            if (container && preview) {
              const availW = container.clientWidth - 32
              const availH = container.clientHeight - 32
              if (availW > 0 && availH > 0) {
                setZoom(Math.min(availW / preview.width, availH / preview.height, 1))
              }
            }
          }} title="Fit to view">Zoom: {Math.round(zoom * 100)}%</span>
          <span className="text-gray-600">|</span>
          <div className="flex items-center gap-1">
            <span className="text-gray-500 mr-1">Grid:</span>
            <select
              value={gridSize}
              onChange={e => setGridSize(Number(e.target.value))}
              className="bg-gray-700 border border-gray-600 rounded px-1 py-0.5 text-gray-200 text-xs"
            >
              <option value={0}>Off</option>
              <option value={1}>1px</option>
              <option value={4}>4px</option>
              <option value={8}>8px</option>
              <option value={16}>16px</option>
              <option value={32}>32px</option>
            </select>
          </div>
          {isReplaced && <span className="text-amber-400 text-xs">Modified</span>}
          <div className="flex-1" />
          <ActionButtons onExtract={onExtract} onReplace={onReplace} onRevert={onRevert} isReplaced={isReplaced} experimentalEnabled={experimentalEnabled} />
        </div>
        <div
          ref={scrollRef}
          className="flex-1 overflow-auto checkerboard-bg relative"
          onContextMenu={handleCanvasContextMenu}
        >
          <div style={{
            minWidth: '100%',
            minHeight: '100%',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
          }}>
            <div className="relative" style={{ flexShrink: 0 }}>
              <canvas
                ref={canvasRef}
                onClick={handleCanvasClick}
                onDoubleClick={handleCanvasDoubleClick}
                onMouseMove={handleCanvasMouseMove}
                onMouseLeave={handleCanvasMouseLeave}
                style={{
                  display: 'block',
                  width: preview.width * zoom,
                  height: preview.height * zoom,
                  imageRendering: zoom > 2 ? 'pixelated' : 'auto',
                  cursor: ctrlHeld ? 'none' : 'crosshair',
                }}
              />
              {showGridOverlay && (
                <div style={{
                  position: 'absolute',
                  inset: 0,
                  backgroundSize: `${gridSize * zoom}px ${gridSize * zoom}px`,
                  backgroundImage: `linear-gradient(to right, rgba(255,255,255,${gridOpacity}) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,${gridOpacity}) 1px, transparent 1px)`,
                  pointerEvents: 'none',
                  imageRendering: 'pixelated',
                }} />
              )}
            </div>
          </div>
          {/* Magnifier loupe */}
          {ctrlHeld && hoverPixel && canvasRect && (
            <MagnifierLoupe
              pixels={preview.rgbaPixels || null}
              width={preview.width}
              height={preview.height}
              mouseX={hoverPixel.x}
              mouseY={hoverPixel.y}
              canvasRect={canvasRect}
              zoom={zoom}
              visible={true}
              sourceCanvas={!preview.rgbaPixels ? canvasRef.current : undefined}
            />
          )}
        </div>
        {/* Color inspector bar */}
        <ColorInspector color={pickedColor} hoverPixel={hoverPixel} />
        {/* Canvas context menu */}
        {canvasContextMenu && (
          <div
            ref={canvasMenuRef}
            className="context-menu fixed bg-gray-700 border border-gray-600 rounded shadow-lg z-[100] min-w-[140px] py-1 text-sm"
            style={{ left: canvasContextMenu.x, top: canvasContextMenu.y }}
          >
            <button
              className="context-menu-item w-full text-left px-3 py-1.5 text-gray-200 hover:bg-gray-600 transition-colors"
              onClick={() => { onCopyImage?.(); setCanvasContextMenu(null) }}
            >
              Copy Image
            </button>
          </div>
        )}
      </div>
    )
  }

  // --- Texture with no preview (data not found or decode failed) ---
  if (selectedAsset.type === 'texture' && !preview) {
    return (
      <div className="flex-1 flex flex-col">
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-gray-700 text-sm">
          <span className="text-gray-400">
            {(selectedAsset.metadata.width as number) || '?'}x{(selectedAsset.metadata.height as number) || '?'}
          </span>
          <span className="text-gray-600">|</span>
          <span className="text-gray-400">{(selectedAsset.metadata.formatName as string) || 'Unknown'}</span>
          {isReplaced && <span className="text-amber-400 text-xs">Modified</span>}
          <div className="flex-1" />
          <ActionButtons onExtract={onExtract} onReplace={onReplace} onRevert={onRevert} isReplaced={isReplaced} experimentalEnabled={experimentalEnabled} />
        </div>
        <div className="flex-1 flex items-center justify-center text-gray-500">
          <div className="text-center">
            <div className="text-3xl mb-2">{'\u{1F5BC}'}</div>
            <p className="font-mono text-sm">{selectedAsset.name}</p>
            <p className="text-xs mt-1 text-gray-600">Texture data not found in SHARED_DATA</p>
            <p className="text-xs mt-1 text-gray-600">Extract to view as DDS</p>
          </div>
        </div>
      </div>
    )
  }

  // --- Non-texture asset with raw data ---
  const data = assetData?.data ? new Uint8Array(assetData.data) : null
  const signature = data ? detectSignature(data) : null
  const isWav = signature === 'RIFF (WAV/AVI)' || assetData?.blobType === 7
  const isWwiseBank = signature === 'Wwise SoundBank' || selectedAsset.type === 'sound'

  // Toolbar info
  const typeLabel = selectedAsset.type === 'blob' && assetData
    ? (BLOB_TYPE_NAMES[assetData.blobType] || `Blob (type ${assetData.blobType})`)
    : selectedAsset.type === 'gpu' ? 'GPU Buffer'
    : selectedAsset.type === 'sound' ? 'SoundBank'
    : selectedAsset.type

  return (
    <div className="flex-1 flex flex-col">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-gray-700 text-sm min-w-0">
        <span className="text-gray-300 truncate font-mono text-xs" title={selectedAsset.name}>{selectedAsset.name}</span>
        <span className="text-gray-600">|</span>
        <span className="text-gray-400 shrink-0">{typeLabel}</span>
        {assetData && (
          <>
            <span className="text-gray-600">|</span>
            <span className="text-gray-400">{formatSize(assetData.totalSize)}</span>
          </>
        )}
        {signature && (
          <>
            <span className="text-gray-600">|</span>
            <span className="text-cyan-400 text-xs">{signature}</span>
          </>
        )}
        {isReplaced && <span className="text-amber-400 text-xs">Modified</span>}
        <div className="flex-1" />
        <ActionButtons onExtract={onExtract} onReplace={onReplace} onRevert={onRevert} isReplaced={isReplaced} experimentalEnabled={experimentalEnabled} />
      </div>

      {/* Content area */}
      <div className="flex-1 overflow-auto">
        {!data ? (
          <div className="flex items-center justify-center h-full text-gray-500">
            <div className="text-center max-w-sm">
              <div className="text-3xl mb-2">
                {selectedAsset.type === 'sound' ? '\u{1F50A}' : selectedAsset.type === 'gpu' ? '\u{1F4BE}' : '\u{1F4E6}'}
              </div>
              <p className="font-mono text-sm">{selectedAsset.name}</p>
              <p className="text-xs mt-2 text-gray-400">
                {(() => {
                  const blobType = selectedAsset.metadata?.blobType as number | undefined
                  const blobName = typeof blobType === 'number' ? BLOB_TYPE_NAMES[blobType] : null
                  const desc = typeof blobType === 'number'
                    ? BLOB_TYPE_DESC[blobType]
                    : ASSET_TYPE_DESC[selectedAsset.type]
                  return blobName
                    ? `This appears to be a ${blobName} asset.`
                    : `Asset type: ${typeLabel}.`
                })()}
              </p>
              {(() => {
                const blobType = selectedAsset.metadata?.blobType as number | undefined
                const desc = typeof blobType === 'number'
                  ? BLOB_TYPE_DESC[blobType]
                  : ASSET_TYPE_DESC[selectedAsset.type]
                return desc ? (
                  <p className="text-xs mt-1 text-gray-600">{desc}</p>
                ) : null
              })()}
              <p className="text-xs mt-2 text-gray-600">
                No preview available — asset data not found in SHARED_DATA.
              </p>
              <p className="text-xs mt-1 text-gray-700 italic">
                Format identification is experimental and may be inaccurate.
              </p>
            </div>
          </div>
        ) : isWav && !assetData?.truncated ? (
          <AudioPreview data={data} name={selectedAsset.name} />
        ) : isWwiseBank ? (
          <WwiseBankPreview data={data} assetName={selectedAsset.name} />
        ) : selectedAsset.type === 'gpu' ? (
          <div className="p-4 space-y-3">
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm max-w-sm">
              <span className="text-gray-500">Element Count</span>
              <span className="text-gray-300 font-mono">{selectedAsset.metadata.elementCount as number ?? '?'}</span>
              <span className="text-gray-500">Bytes/Element</span>
              <span className="text-gray-300 font-mono">{selectedAsset.metadata.bytesPerElement as number ?? '?'}</span>
              <span className="text-gray-500">Total Size</span>
              <span className="text-gray-300 font-mono">{formatSize(assetData.totalSize)}</span>
              {selectedAsset.metadata.materialName && (
                <>
                  <span className="text-gray-500">Material</span>
                  <span className="text-gray-300 font-mono text-xs">{selectedAsset.metadata.materialName as string}</span>
                </>
              )}
            </div>
            <div className="border-t border-gray-700 pt-3">
              <p className="text-xs text-gray-500 mb-2">Raw data:</p>
              <HexDump data={data} maxRows={32} />
            </div>
          </div>
        ) : (
          <BlobPreview
            data={data}
            assetData={assetData}
            selectedAsset={selectedAsset}
          />
        )}
      </div>
    </div>
  )
}
