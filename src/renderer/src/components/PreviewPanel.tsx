import React, { useRef, useEffect, useState, useMemo, useCallback } from 'react'
import { flushSync } from 'react-dom'
import { ColorInspector, pickPixel, PickedColor } from './ColorInspector'
import { MagnifierLoupe } from './MagnifierLoupe'

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
  rgbaPixels: Uint8Array | null
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
  [[0x00, 0x00, 0x00, 0x14], 'Possible FBX fragment'],
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
    // Heightmap - check if data is float32 grid
    const totalFloats = Math.floor(data.length / 4)
    const sqrt = Math.round(Math.sqrt(totalFloats))
    if (sqrt * sqrt === totalFloats && sqrt > 1) {
      details['Grid Size'] = `${sqrt} x ${sqrt}`
      details['Format'] = 'Float32 heightmap'
    } else {
      // Try to detect header + payload
      if (data.length >= 16) {
        const w = view.getUint32(0, true)
        const h = view.getUint32(4, true)
        if (w > 0 && w <= 4096 && h > 0 && h <= 4096) {
          details['Possible Dims'] = `${w} x ${h}`
          const payloadFloats = Math.floor((data.length - 8) / 4)
          if (payloadFloats === w * h) details['Format'] = 'Header(8) + Float32 grid'
        }
      }
    }
    details['Total Values'] = totalFloats.toLocaleString()
    // Show sample height range from first few values
    if (data.length >= 16) {
      let min = Infinity, max = -Infinity
      const sampleCount = Math.min(totalFloats, 1000)
      for (let i = 0; i < sampleCount; i++) {
        const v = view.getFloat32(i * 4, true)
        if (isFinite(v)) { min = Math.min(min, v); max = Math.max(max, v) }
      }
      if (isFinite(min)) details['Height Range'] = `${min.toFixed(2)} .. ${max.toFixed(2)}`
    }
  } else if (blobType === 2) {
    // ID Map
    const sqrt = Math.round(Math.sqrt(data.length))
    if (sqrt * sqrt === data.length && sqrt > 1) {
      details['Grid Size'] = `${sqrt} x ${sqrt}`
    }
    const ids = new Set(data.slice(0, Math.min(data.length, 65536)))
    details['Unique IDs'] = ids.size.toString()
    details['ID Values'] = Array.from(ids).sort((a, b) => a - b).slice(0, 16).join(', ') + (ids.size > 16 ? '...' : '')
  } else if (blobType === 5) {
    // Animation
    if (data.length >= 24) {
      details['Header[0]'] = '0x' + view.getUint32(0, true).toString(16).toUpperCase()
      details['Header[1]'] = '0x' + view.getUint32(4, true).toString(16).toUpperCase()
      const v2 = view.getUint32(8, true)
      const v3 = view.getUint32(12, true)
      const v4 = view.getUint32(16, true)
      if (v2 > 0 && v2 < 1000) details['Track/Bone Count?'] = v2.toString()
      if (v3 > 0 && v3 < 100000) details['Frame Count?'] = v3.toString()
      // Check for float duration
      const dur = view.getFloat32(20, true)
      if (isFinite(dur) && dur > 0 && dur < 3600) details['Duration?'] = dur.toFixed(3) + 's'
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
    // Blend mesh
    if (data.length >= 16) {
      const v0 = view.getUint32(0, true)
      const v1 = view.getUint32(4, true)
      if (v0 > 0 && v0 < 1000000) details['Vertex Count?'] = v0.toLocaleString()
      if (v1 > 0 && v1 < 256) details['Blend Targets?'] = v1.toString()
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
    // Skeleton
    if (data.length >= 16) {
      const boneCount = view.getUint32(0, true)
      if (boneCount > 0 && boneCount < 1000) {
        details['Bone Count'] = boneCount.toString()
        // Try to find bone name strings in the data
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

// --- Audio preview (WAV/RIFF) ---
function AudioPreview({ data, name }: { data: Uint8Array; name: string }) {
  const audioUrl = useMemo(() => {
    const blob = new Blob([data], { type: 'audio/wav' })
    return URL.createObjectURL(blob)
  }, [data])

  useEffect(() => {
    return () => URL.revokeObjectURL(audioUrl)
  }, [audioUrl])

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center gap-2 text-sm text-gray-400">
        <span className="text-lg">{'\u{1F3B5}'}</span>
        <span className="font-mono">{name}</span>
      </div>
      <audio controls className="w-full" src={audioUrl} />
      <p className="text-xs text-gray-500">
        Size: {formatSize(data.length)}
      </p>
    </div>
  )
}

// --- Wwise SoundBank header preview ---
function WwiseBankPreview({ data, assetName }: { data: Uint8Array; assetName: string }) {
  // Parse BKHD section header from local data for display
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

  // Fetch full embedded file list via IPC (parses the full untruncated bank)
  const [embeddedFiles, setEmbeddedFiles] = useState<{ id: number; size: number }[] | null>(null)
  const [extracting, setExtracting] = useState(false)
  const [extractStatus, setExtractStatus] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    window.electronAPI.parseWwiseBank(assetName).then(info => {
      if (!cancelled && info) {
        setEmbeddedFiles(info.embeddedFiles)
      }
    })
    return () => { cancelled = true }
  }, [assetName])

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
      const result = await window.electronAPI.extractWwiseAudio(assetName, fileId)
      if (result) {
        setExtractStatus(`Extracted ${fileId}.wem (${formatSize(result.data.length)})`)
      }
    } catch (e) {
      setExtractStatus(`Error: ${e}`)
    }
    setExtracting(false)
  }, [assetName])

  return (
    <div className="p-4 space-y-3">
      <div className="text-sm">
        <span className="text-gray-400">Wwise SoundBank</span>
        <span className="text-gray-600 mx-2">|</span>
        <span className="text-gray-400">Version: {bankVersion}</span>
        <span className="text-gray-600 mx-2">|</span>
        <span className="text-gray-400">Bank ID: 0x{bankId.toString(16).toUpperCase()}</span>
      </div>

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

      {/* Embedded audio files */}
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
          <table className="text-xs font-mono w-full max-w-lg">
            <thead>
              <tr className="text-gray-500 border-b border-gray-700">
                <th className="text-left py-1 pr-4">File ID</th>
                <th className="text-right py-1 pr-4">Size</th>
                <th className="text-right py-1"></th>
              </tr>
            </thead>
            <tbody>
              {embeddedFiles.map(f => (
                <tr key={f.id} className="text-gray-300 hover:bg-gray-800/50">
                  <td className="py-0.5 pr-4 text-amber-400">{f.id}</td>
                  <td className="py-0.5 pr-4 text-right">{formatSize(f.size)}</td>
                  <td className="py-0.5 text-right">
                    <button
                      onClick={() => handleExtractSingle(f.id)}
                      disabled={extracting}
                      className="text-blue-400 hover:text-blue-300 disabled:text-gray-600"
                    >
                      Extract
                    </button>
                  </td>
                </tr>
              ))}
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
  const blobType = assetData.blobType
  const typeName = BLOB_TYPE_NAMES[blobType] || `Unknown (${blobType})`
  const ext = BLOB_TYPE_EXT[blobType] || '.bin'
  const details = useMemo(() => parseBlobDetails(data, blobType), [data, blobType])

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

  return (
    <div className="p-4 space-y-3">
      {selectedAsset.type === 'blob' && blobType >= 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-gray-400">Type:</span>
            <span className="text-cyan-400">{typeName}</span>
            <span className="text-gray-600">|</span>
            <span className="text-gray-400">{formatSize(assetData.totalSize)}</span>
            <span className="text-gray-600">|</span>
            <span className="text-gray-500 font-mono text-xs">{ext}</span>
          </div>

          {/* Format-specific details */}
          {details && (
            <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs max-w-sm pl-1">
              {Object.entries(details).map(([key, value]) => (
                <React.Fragment key={key}>
                  <span className="text-gray-500">{key}</span>
                  <span className="text-gray-300 font-mono">{value}</span>
                </React.Fragment>
              ))}
            </div>
          )}

          {/* Batch extract button */}
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
        </div>
      )}

      <HexDump data={data} maxRows={32} />
      {assetData.truncated && (
        <p className="text-xs text-gray-500">
          Showing first {formatSize(data.length)} of {formatSize(assetData.totalSize)}. Extract to view full file.
        </p>
      )}
    </div>
  )
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

export function PreviewPanel({ selectedAsset, preview, assetData, loading, onExtract, onReplace, onRevert, isReplaced, onCopyImage, experimentalEnabled }: PreviewPanelProps) {
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
    if (!preview || !preview.rgbaPixels || !canvasRef.current) return

    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    canvas.width = preview.width
    canvas.height = preview.height

    const imageData = new ImageData(
      new Uint8ClampedArray(preview.rgbaPixels.buffer, preview.rgbaPixels.byteOffset, preview.rgbaPixels.byteLength),
      preview.width,
      preview.height
    )
    ctx.putImageData(imageData, 0, 0)

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
  }, [preview])

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault()
    const delta = e.deltaY > 0 ? 0.9 : 1.1
    setZoom(prev => Math.max(0.1, Math.min(10, prev * delta)))
  }

  // Single click: pick color
  const handleCanvasClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (ctrlHeld || !canvasRef.current || !preview?.rgbaPixels) return
    const rect = canvasRef.current.getBoundingClientRect()
    const px = Math.floor((e.clientX - rect.left) / zoom)
    const py = Math.floor((e.clientY - rect.top) / zoom)
    if (px >= 0 && py >= 0 && px < preview.width && py < preview.height) {
      setPickedColor(pickPixel(preview.rgbaPixels, preview.width, px, py))
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
        <div className="text-center">
          <div className="animate-spin text-2xl mb-2">&#x23F3;</div>
          <p>Loading preview...</p>
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

  if (selectedAsset.type === 'texture' && preview && preview.rgbaPixels) {
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
          onWheel={handleWheel}
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
              pixels={preview.rgbaPixels}
              width={preview.width}
              height={preview.height}
              mouseX={hoverPixel.x}
              mouseY={hoverPixel.y}
              canvasRect={canvasRect}
              zoom={zoom}
              visible={true}
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
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-gray-700 text-sm">
        <span className="text-gray-400">{typeLabel}</span>
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
            <div className="text-center">
              <div className="text-3xl mb-2">
                {selectedAsset.type === 'sound' ? '\u{1F50A}' : selectedAsset.type === 'gpu' ? '\u{1F4BE}' : '\u{1F4E6}'}
              </div>
              <p className="font-mono text-sm">{selectedAsset.name}</p>
              <p className="text-xs mt-1">Asset data not found in SHARED_DATA</p>
            </div>
          </div>
        ) : isWav && !assetData?.truncated ? (
          <AudioPreview data={data} name={selectedAsset.name} />
        ) : isWwiseBank ? (
          <div className="flex flex-col h-full">
            <WwiseBankPreview data={data} assetName={selectedAsset.name} />
            <div className="border-t border-gray-700 p-3 flex-1 overflow-auto">
              <p className="text-xs text-gray-500 mb-2">Raw data:</p>
              <HexDump data={data} maxRows={24} />
            </div>
          </div>
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
