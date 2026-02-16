import React, { useState } from 'react'

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

interface PropertiesPanelProps {
  asset: AssetEntry | null
  preview: TexturePreview | null
}

function PropertyRow({ label, value }: { label: string; value: string | number | undefined }) {
  if (value === undefined || value === null || value === '') return null
  return (
    <div className="flex justify-between py-1 border-b border-gray-800">
      <span className="text-gray-400 text-xs">{label}</span>
      <span className="text-gray-200 text-xs font-mono text-right ml-2 truncate max-w-[140px]" title={String(value)}>
        {String(value)}
      </span>
    </div>
  )
}

// Fields to exclude from the generic metadata loop (shown explicitly above)
const HIDDEN_META_KEYS = new Set(['sourcePath', 'sourceBlp', 'width', 'height', 'mips', 'format', 'formatName'])

// Blob types that have visual previews (match isBlobPreviewable in PreviewPanel)
const PREVIEWABLE_BLOB_TYPES = new Set([0, 1, 2, 5, 7, 9, 12])

export function PropertiesPanel({ asset, preview }: PropertiesPanelProps) {
  // Collapse by default for previewable blobs (animations, skeletons, etc.)
  const blobType = asset?.metadata?.blobType as number | undefined
  const hasPreview = asset?.type === 'blob' && blobType !== undefined && PREVIEWABLE_BLOB_TYPES.has(blobType)
  const [expanded, setExpanded] = useState(false)

  if (!asset) {
    return (
      <div className="p-3 text-gray-500 text-sm">
        <p className="font-medium text-gray-400 mb-2">Properties</p>
        <p>No asset selected</p>
      </div>
    )
  }

  const meta = asset.metadata || {}
  const sourcePath = meta.sourcePath as string | undefined
  const sourceBlp = meta.sourceBlp as string | undefined
  const showDetails = hasPreview ? expanded : true

  return (
    <div className="p-3 overflow-y-auto h-full">
      <div className="flex items-center justify-between mb-3">
        <p className="font-medium text-gray-300 text-sm">Properties</p>
        {hasPreview && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="px-2 py-0.5 bg-gray-700 hover:bg-gray-600 rounded text-xs text-gray-300 transition-colors"
          >
            {expanded ? 'Hide' : 'Show'}
          </button>
        )}
      </div>

      {showDetails && (
        <>
          <div className="space-y-0">
            <PropertyRow label="Name" value={asset.name} />
            <PropertyRow label="Type" value={asset.type} />

            {/* Game reference URI for textures */}
            {asset.type === 'texture' && (
              <div className="flex justify-between py-1 border-b border-gray-800">
                <span className="text-gray-400 text-xs">Game URI</span>
                <span className="text-blue-300 text-xs font-mono text-right ml-2 truncate max-w-[140px]" title={`blp:${asset.name}`}>
                  blp:{asset.name}
                </span>
              </div>
            )}

            {preview && (
              <>
                <PropertyRow label="Width" value={preview.width} />
                <PropertyRow label="Height" value={preview.height} />
                <PropertyRow label="Mips" value={preview.mips} />
                <PropertyRow label="Format" value={preview.dxgiFormatName} />
                <PropertyRow label="Format ID" value={preview.dxgiFormat} />
              </>
            )}

            {/* Show all metadata fields except hidden ones */}
            {Object.entries(meta).map(([key, value]) => {
              if (key.startsWith('_')) return null
              if (HIDDEN_META_KEYS.has(key)) return null
              if (value === null || value === undefined || value === '' || value === 0) return null
              if (typeof value === 'object') return null
              return <PropertyRow key={key} label={key} value={value as string | number} />
            })}
          </div>

          {/* Source info section */}
          {(sourcePath || sourceBlp) && (
            <div className="mt-4">
              <p className="font-medium text-gray-400 mb-2 text-xs uppercase tracking-wide">Source</p>
              <div className="space-y-0">
                {sourceBlp && <PropertyRow label="BLP File" value={sourceBlp} />}
                {sourcePath && (
                  <div className="py-1 border-b border-gray-800">
                    <span className="text-gray-400 text-xs block">SHARED_DATA Path</span>
                    <span className="text-gray-300 text-xs font-mono break-all mt-0.5 block" title={sourcePath}>
                      {sourcePath}
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
