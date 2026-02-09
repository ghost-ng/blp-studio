import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react'

interface AssetEntry {
  name: string
  type: 'texture' | 'blob' | 'gpu' | 'sound'
  metadata: Record<string, unknown>
}

interface AssetTreeProps {
  assets: AssetEntry[]
  selectedAsset: AssetEntry | null
  onSelectAsset: (asset: AssetEntry) => void
  replacedAssets?: Set<string>
  onOpenInDdsViewer?: (name: string) => void
  onExportAsImage?: (name: string, format: 'png' | 'jpg') => void
}

const TYPE_LABELS: Record<string, { label: string; icon: string }> = {
  texture: { label: 'Textures', icon: '\u{1F5BC}' },
  blob: { label: 'Blobs', icon: '\u{1F4E6}' },
  gpu: { label: 'GPU Buffers', icon: '\u{1F4BE}' },
  sound: { label: 'Sounds', icon: '\u{1F50A}' },
}

interface ContextMenuState {
  x: number
  y: number
  asset: AssetEntry
}

export function AssetTree({ assets, selectedAsset, onSelectAsset, replacedAssets, onOpenInDdsViewer, onExportAsImage }: AssetTreeProps) {
  const [filter, setFilter] = useState('')
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const grouped = useMemo(() => {
    const groups: Record<string, AssetEntry[]> = { texture: [], blob: [], gpu: [], sound: [] }
    const lowerFilter = filter.toLowerCase()
    for (const asset of assets) {
      if (lowerFilter && !asset.name.toLowerCase().includes(lowerFilter)) continue
      if (groups[asset.type]) {
        groups[asset.type].push(asset)
      }
    }
    return groups
  }, [assets, filter])

  const toggleGroup = (type: string) => {
    setCollapsed(prev => ({ ...prev, [type]: !prev[type] }))
  }

  const handleContextMenu = useCallback((e: React.MouseEvent, asset: AssetEntry) => {
    if (asset.type !== 'texture') return
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY, asset })
  }, [])

  // Close context menu on outside click or Escape
  useEffect(() => {
    if (!contextMenu) return
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setContextMenu(null)
      }
    }
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setContextMenu(null)
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKey)
    }
  }, [contextMenu])

  return (
    <div className="flex flex-col h-full">
      {/* Search/filter */}
      <div className="p-2 border-b border-gray-700">
        <input
          type="text"
          placeholder="Filter assets..."
          value={filter}
          onChange={e => setFilter(e.target.value)}
          className="w-full px-2 py-1.5 bg-gray-800 border border-gray-600 rounded text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-blue-500"
        />
      </div>

      {/* Tree */}
      <div className="flex-1 overflow-y-auto text-sm">
        {assets.length === 0 ? (
          <div className="p-4 text-gray-500 text-center">
            No file loaded
          </div>
        ) : (
          Object.entries(grouped).map(([type, items]) => {
            if (items.length === 0) return null
            const info = TYPE_LABELS[type] || { label: type, icon: '?' }
            const isCollapsed = collapsed[type]

            return (
              <div key={type}>
                {/* Group header */}
                <div
                  className="flex items-center gap-1 px-2 py-1.5 cursor-pointer hover:bg-gray-800 select-none font-medium text-gray-300"
                  onClick={() => toggleGroup(type)}
                >
                  <span className="text-xs w-4">{isCollapsed ? '\u25B6' : '\u25BC'}</span>
                  <span>{info.label}</span>
                  <span className="text-gray-500 ml-1">({items.length})</span>
                </div>

                {/* Items */}
                {!isCollapsed && items.map(asset => {
                  const isReplaced = replacedAssets?.has(asset.name)
                  return (
                    <div
                      key={asset.name}
                      className={`tree-item flex items-center px-6 py-1 cursor-pointer truncate ${
                        selectedAsset?.name === asset.name ? 'selected' : ''
                      }`}
                      onClick={() => onSelectAsset(asset)}
                      onContextMenu={(e) => handleContextMenu(e, asset)}
                      title={asset.name}
                    >
                      {isReplaced && <span className="text-amber-400 mr-1 text-xs flex-shrink-0">*</span>}
                      <span className={`truncate ${isReplaced ? 'text-amber-300' : 'text-gray-300'}`}>{asset.name}</span>
                    </div>
                  )
                })}
              </div>
            )
          })
        )}
      </div>

      {/* Context menu */}
      {contextMenu && (
        <div
          ref={menuRef}
          className="context-menu fixed bg-gray-700 border border-gray-600 rounded shadow-lg z-[100] min-w-[180px] py-1 text-sm"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          {onOpenInDdsViewer && (
            <button
              className="context-menu-item w-full text-left px-3 py-1.5 text-gray-200 hover:bg-gray-600 transition-colors"
              onClick={() => { onOpenInDdsViewer(contextMenu.asset.name); setContextMenu(null) }}
            >
              Open in DDS Viewer
            </button>
          )}
          {onExportAsImage && (
            <>
              <button
                className="context-menu-item w-full text-left px-3 py-1.5 text-gray-200 hover:bg-gray-600 transition-colors"
                onClick={() => { onExportAsImage(contextMenu.asset.name, 'png'); setContextMenu(null) }}
              >
                Export as PNG
              </button>
              <button
                className="context-menu-item w-full text-left px-3 py-1.5 text-gray-200 hover:bg-gray-600 transition-colors"
                onClick={() => { onExportAsImage(contextMenu.asset.name, 'jpg'); setContextMenu(null) }}
              >
                Export as JPG
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}
