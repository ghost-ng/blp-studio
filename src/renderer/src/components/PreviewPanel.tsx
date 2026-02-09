import React, { useRef, useEffect, useState, useMemo, useCallback } from 'react'

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
  rgbaPixels: Uint8Array
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
  5: 'Animation',
  6: 'StateSet',
  7: 'Audio (WAV)',
  9: 'Blend Mesh',
  11: 'Mesh',
  12: 'Skeleton',
  13: 'Collision',
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
  if (data[0] === 0x8C) return 'Oodle Kraken (compressed)'
  return null
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
function WwiseBankPreview({ data }: { data: Uint8Array }) {
  // Parse BKHD section header
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  let bankVersion = 0
  let bankId = 0

  if (data.length >= 16) {
    // BKHD chunk: magic(4) + chunkSize(4) + bankVersion(4) + bankId(4)
    bankVersion = view.getUint32(8, true)
    bankId = view.getUint32(12, true)
  }

  // Scan for section names
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
    </div>
  )
}

function ActionButtons({ onExtract, onReplace, onRevert, isReplaced }: {
  onExtract: () => void
  onReplace?: () => void
  onRevert?: () => void
  isReplaced?: boolean
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
      {onReplace && (
        <button
          onClick={onReplace}
          className="px-2 py-0.5 bg-blue-700 hover:bg-blue-600 rounded text-xs transition-colors"
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

export function PreviewPanel({ selectedAsset, preview, assetData, loading, onExtract, onReplace, onRevert, isReplaced, onCopyImage }: PreviewPanelProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [zoom, setZoom] = useState(1)
  const [canvasContextMenu, setCanvasContextMenu] = useState<CanvasContextMenuState | null>(null)
  const canvasMenuRef = useRef<HTMLDivElement>(null)

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
    setZoom(1)
  }, [preview])

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault()
    const delta = e.deltaY > 0 ? 0.9 : 1.1
    setZoom(prev => Math.max(0.1, Math.min(10, prev * delta)))
  }

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
  if (selectedAsset.type === 'texture' && preview) {
    return (
      <div className="flex-1 flex flex-col">
        <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-850 border-b border-gray-700 text-sm">
          <span className="text-gray-400">{preview.width}x{preview.height}</span>
          <span className="text-gray-600">|</span>
          <span className="text-gray-400">{preview.dxgiFormatName}</span>
          <span className="text-gray-600">|</span>
          <span className="text-gray-400">Zoom: {Math.round(zoom * 100)}%</span>
          {isReplaced && <span className="text-amber-400 text-xs">Modified</span>}
          <div className="flex-1" />
          <ActionButtons onExtract={onExtract} onReplace={onReplace} onRevert={onRevert} isReplaced={isReplaced} />
        </div>
        <div
          className="flex-1 overflow-auto checkerboard-bg"
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
            <canvas
              ref={canvasRef}
              style={{
                width: preview.width * zoom,
                height: preview.height * zoom,
                flexShrink: 0,
                imageRendering: zoom > 2 ? 'pixelated' : 'auto',
              }}
            />
          </div>
        </div>
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
          <ActionButtons onExtract={onExtract} onReplace={onReplace} onRevert={onRevert} isReplaced={isReplaced} />
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
        <ActionButtons onExtract={onExtract} onReplace={onReplace} onRevert={onRevert} isReplaced={isReplaced} />
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
            <WwiseBankPreview data={data} />
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
          <div className="p-4 space-y-3">
            {selectedAsset.type === 'blob' && assetData.blobType >= 0 && (
              <div className="text-sm text-gray-400">
                Type: <span className="text-cyan-400">{BLOB_TYPE_NAMES[assetData.blobType] || `Unknown (${assetData.blobType})`}</span>
                <span className="text-gray-600 mx-2">|</span>
                Size: <span className="text-gray-300">{formatSize(assetData.totalSize)}</span>
              </div>
            )}
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
