import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react'

interface AssetEntry {
  name: string
  type: 'texture' | 'blob' | 'gpu' | 'sound'
  metadata: Record<string, unknown>
}

type ViewMode = 'list' | 'grid'

interface AssetTreeProps {
  assets: AssetEntry[]
  selectedAsset: AssetEntry | null
  selectedAssets: Set<string>
  onSelectAsset: (asset: AssetEntry) => void
  onSelectionChange: (selected: Set<string>) => void
  onExportSelected?: (names: string[], format: 'png' | 'jpg') => void
  replacedAssets?: Set<string>
  onOpenInDdsViewer?: (name: string) => void
  onExportAsImage?: (name: string, format: 'png' | 'jpg') => void
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const TYPE_LABELS: Record<string, { label: string; icon: string }> = {
  texture: { label: 'Textures', icon: '\u{1F5BC}' },
  blob: { label: 'Blobs', icon: '\u{1F4E6}' },
  gpu: { label: 'GPU Buffers', icon: '\u{1F4BE}' },
  sound: { label: 'Sounds', icon: '\u{1F50A}' },
}

const BLOB_TYPE_NAMES: Record<number, string> = {
  0: 'heightmap', 1: 'blend_hm', 2: 'idmap', 3: 'material_id',
  5: 'animation', 6: 'stateset', 7: 'audio', 9: 'blend_mesh',
  11: 'mesh', 12: 'skeleton', 13: 'collision',
}

interface ContextMenuState {
  x: number
  y: number
  asset: AssetEntry
}

// Module-level thumbnail cache: cacheKey -> Map<assetName, dataUrl>
const thumbnailCache = new Map<string, Map<string, string>>()

function makeThumbnailCacheKey(textureNames: string[]): string {
  return textureNames.slice(0, 5).join(',') + ':' + textureNames.length
}

// Convert RGBA pixels to a data URL via offscreen canvas
function rgbaToDataUrl(rgba: Uint8Array, w: number, h: number): string {
  const canvas = document.createElement('canvas')
  canvas.width = w; canvas.height = h
  const ctx = canvas.getContext('2d')!
  const imageData = new ImageData(new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, rgba.byteLength), w, h)
  ctx.putImageData(imageData, 0, 0)
  return canvas.toDataURL()
}

export function AssetTree({ assets, selectedAsset, selectedAssets, onSelectAsset, onSelectionChange, onExportSelected, replacedAssets, onOpenInDdsViewer, onExportAsImage }: AssetTreeProps) {
  const [filter, setFilter] = useState('')
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const lastClickedRef = useRef<string | null>(null)
  const [viewMode, setViewMode] = useState<ViewMode>('list')
  const [thumbnails, setThumbnails] = useState<Map<string, string>>(new Map())
  const [loadingThumbs, setLoadingThumbs] = useState(false)
  const thumbCacheKeyRef = useRef<string>('')

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

  // Flat list of visible (not collapsed) assets for shift-click range
  const flatVisibleList = useMemo(() => {
    const flat: AssetEntry[] = []
    for (const [type, items] of Object.entries(grouped)) {
      if (items.length === 0 || collapsed[type]) continue
      flat.push(...items)
    }
    return flat
  }, [grouped, collapsed])

  // Load thumbnails when switching to grid mode or when assets change
  useEffect(() => {
    if (viewMode !== 'grid') return
    const textureNames = grouped.texture.map(a => a.name)
    if (textureNames.length === 0) return

    // Cache key to avoid re-fetching
    const key = makeThumbnailCacheKey(textureNames)
    if (key === thumbCacheKeyRef.current && thumbnails.size > 0) return
    thumbCacheKeyRef.current = key

    // Check module-level cache first
    const cached = thumbnailCache.get(key)
    if (cached && cached.size > 0) {
      setThumbnails(cached)
      return
    }

    setLoadingThumbs(true)
    // Load in chunks of 20
    const loadChunks = async () => {
      const newThumbs = new Map<string, string>()
      for (let i = 0; i < textureNames.length; i += 20) {
        const chunk = textureNames.slice(i, i + 20)
        try {
          const results = await window.electronAPI.getThumbnails(chunk)
          for (const [name, data] of Object.entries(results)) {
            if (data && data.rgbaPixels) {
              newThumbs.set(name, rgbaToDataUrl(data.rgbaPixels, data.width, data.height))
            }
          }
          // Update progressively
          setThumbnails(new Map(newThumbs))
        } catch {
          // Continue with remaining chunks
        }
      }
      // Store in module-level cache
      thumbnailCache.set(key, new Map(newThumbs))
      setLoadingThumbs(false)
    }
    loadChunks()
  }, [viewMode, grouped.texture])

  // Restore thumbnails from cache when assets change (tab switch), or clear for new BLP
  useEffect(() => {
    const textureNames = assets.filter(a => a.type === 'texture').map(a => a.name)
    const key = makeThumbnailCacheKey(textureNames)
    const cached = thumbnailCache.get(key)
    if (cached && cached.size > 0) {
      setThumbnails(cached)
      thumbCacheKeyRef.current = key
    } else {
      setThumbnails(new Map())
      thumbCacheKeyRef.current = ''
    }
  }, [assets])

  const toggleGroup = (type: string) => {
    setCollapsed(prev => ({ ...prev, [type]: !prev[type] }))
  }

  const handleItemClick = useCallback((e: React.MouseEvent, asset: AssetEntry) => {
    if (e.ctrlKey || e.metaKey) {
      const next = new Set(selectedAssets)
      if (next.has(asset.name)) {
        next.delete(asset.name)
      } else {
        next.add(asset.name)
      }
      onSelectionChange(next)
      lastClickedRef.current = asset.name
    } else if (e.shiftKey && lastClickedRef.current) {
      const lastIdx = flatVisibleList.findIndex(a => a.name === lastClickedRef.current)
      const currIdx = flatVisibleList.findIndex(a => a.name === asset.name)
      if (lastIdx >= 0 && currIdx >= 0) {
        const start = Math.min(lastIdx, currIdx)
        const end = Math.max(lastIdx, currIdx)
        const next = new Set(selectedAssets)
        for (let i = start; i <= end; i++) {
          next.add(flatVisibleList[i].name)
        }
        onSelectionChange(next)
      }
    } else {
      onSelectionChange(new Set([asset.name]))
      lastClickedRef.current = asset.name
    }
    onSelectAsset(asset)
  }, [selectedAssets, flatVisibleList, onSelectAsset, onSelectionChange])

  const handleContextMenu = useCallback((e: React.MouseEvent, asset: AssetEntry) => {
    if (asset.type !== 'texture') return
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY, asset })
  }, [])

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

  // Arrow key navigation through flat visible list
  useEffect(() => {
    const handleArrowKey = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
      // Don't intercept if focus is on an input/textarea
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if (flatVisibleList.length === 0) return

      e.preventDefault()
      const currentIdx = selectedAsset
        ? flatVisibleList.findIndex(a => a.name === selectedAsset.name)
        : -1

      let nextIdx: number
      if (e.key === 'ArrowDown') {
        nextIdx = currentIdx < 0 ? 0 : Math.min(currentIdx + 1, flatVisibleList.length - 1)
      } else {
        nextIdx = currentIdx < 0 ? 0 : Math.max(currentIdx - 1, 0)
      }

      if (nextIdx === currentIdx && currentIdx >= 0) return

      const nextAsset = flatVisibleList[nextIdx]
      onSelectAsset(nextAsset)
      onSelectionChange(new Set([nextAsset.name]))
      lastClickedRef.current = nextAsset.name

      // Scroll the item into view
      const container = listRef.current
      if (container) {
        const el = container.querySelector(`[data-asset-name="${CSS.escape(nextAsset.name)}"]`) as HTMLElement | null
        el?.scrollIntoView({ block: 'nearest' })
      }
    }

    document.addEventListener('keydown', handleArrowKey)
    return () => document.removeEventListener('keydown', handleArrowKey)
  }, [flatVisibleList, selectedAsset, onSelectAsset, onSelectionChange])

  const selectedTextureNames = useMemo(() => {
    return [...selectedAssets].filter(name =>
      assets.find(a => a.name === name && a.type === 'texture')
    )
  }, [selectedAssets, assets])

  const renderListItem = (asset: AssetEntry) => {
    const isReplaced = replacedAssets?.has(asset.name)
    const isPrimary = selectedAsset?.name === asset.name
    const isMultiSelected = selectedAssets.has(asset.name)
    const rawSize = asset.metadata.rawSize as number | undefined
    const dims = asset.type === 'texture' && asset.metadata.width && asset.metadata.height
      ? `${asset.metadata.width}x${asset.metadata.height}` : null
    const blobLabel = asset.type === 'blob' && typeof asset.metadata.blobType === 'number'
      ? BLOB_TYPE_NAMES[asset.metadata.blobType] ?? `type_${asset.metadata.blobType}` : null
    return (
      <div
        key={asset.name}
        data-asset-name={asset.name}
        className={`tree-item flex items-center px-6 py-1 cursor-pointer truncate select-none ${
          isPrimary ? 'selected' : isMultiSelected ? 'multi-selected' : ''
        }`}
        onClick={(e) => handleItemClick(e, asset)}
        onContextMenu={(e) => handleContextMenu(e, asset)}
        title={asset.name}
      >
        {isReplaced && <span className="text-amber-400 mr-1 text-xs flex-shrink-0">*</span>}
        <span className={`truncate ${isReplaced ? 'text-amber-300' : 'text-gray-300'}`}>{asset.name}</span>
        {(dims || blobLabel || rawSize) && (
          <span className="ml-auto pl-2 text-[10px] text-gray-600 flex-shrink-0">
            {dims}{blobLabel}{rawSize ? ` ${formatSize(rawSize)}` : ''}
          </span>
        )}
      </div>
    )
  }

  const renderGridItem = (asset: AssetEntry) => {
    const isReplaced = replacedAssets?.has(asset.name)
    const isPrimary = selectedAsset?.name === asset.name
    const isMultiSelected = selectedAssets.has(asset.name)
    const thumbUrl = thumbnails.get(asset.name)

    return (
      <div
        key={asset.name}
        data-asset-name={asset.name}
        className={`flex flex-col items-center p-1 rounded cursor-pointer transition-colors select-none ${
          isPrimary ? 'bg-blue-500/25 ring-1 ring-blue-500' :
          isMultiSelected ? 'bg-blue-500/20 ring-1 ring-blue-400/40' :
          'hover:bg-gray-800'
        }`}
        onClick={(e) => handleItemClick(e, asset)}
        onContextMenu={(e) => handleContextMenu(e, asset)}
        title={asset.name}
      >
        <div className="w-16 h-16 rounded overflow-hidden checkerboard-bg flex items-center justify-center relative">
          {thumbUrl ? (
            <img src={thumbUrl} alt="" className="max-w-full max-h-full object-contain" style={{ imageRendering: 'pixelated' }} />
          ) : loadingThumbs ? (
            <svg className="w-5 h-5 text-gray-500 animate-spin" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          ) : (
            <div className="text-gray-600 text-xl">{'\u{1F5BC}'}</div>
          )}
          {isReplaced && (
            <div className="absolute top-0 right-0 w-2 h-2 bg-amber-400 rounded-full" />
          )}
        </div>
        <span className="text-[10px] text-gray-400 truncate w-full text-center mt-0.5 leading-tight">
          {asset.name.length > 20 ? asset.name.slice(0, 18) + '...' : asset.name}
        </span>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Search/filter + view toggle */}
      <div className="p-2 border-b border-gray-700">
        <div className="flex items-center gap-1.5">
          <input
            type="text"
            placeholder="Filter assets..."
            value={filter}
            onChange={e => setFilter(e.target.value)}
            className="flex-1 px-2 py-1.5 bg-gray-800 border border-gray-600 rounded text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-blue-500"
          />
          {/* View mode toggle */}
          <button
            onClick={() => setViewMode('list')}
            className={`p-1.5 rounded transition-colors ${viewMode === 'list' ? 'bg-gray-600 text-white' : 'text-gray-500 hover:text-gray-300'}`}
            title="List view"
          >
            <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 16 16">
              <rect x="0" y="1" width="16" height="2" rx="0.5" />
              <rect x="0" y="5" width="16" height="2" rx="0.5" />
              <rect x="0" y="9" width="16" height="2" rx="0.5" />
              <rect x="0" y="13" width="16" height="2" rx="0.5" />
            </svg>
          </button>
          <button
            onClick={() => setViewMode('grid')}
            className={`p-1.5 rounded transition-colors ${viewMode === 'grid' ? 'bg-gray-600 text-white' : 'text-gray-500 hover:text-gray-300'}`}
            title="Grid view"
          >
            <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 16 16">
              <rect x="0" y="0" width="7" height="7" rx="1" />
              <rect x="9" y="0" width="7" height="7" rx="1" />
              <rect x="0" y="9" width="7" height="7" rx="1" />
              <rect x="9" y="9" width="7" height="7" rx="1" />
            </svg>
          </button>
        </div>
      </div>

      {/* Selection bar */}
      {selectedAssets.size > 1 && (
        <div className="flex items-center gap-2 px-2 py-1 bg-blue-900/30 border-b border-gray-700 text-xs">
          <span className="text-blue-300">{selectedAssets.size} selected</span>
          <div className="flex-1" />
          {selectedTextureNames.length > 0 && onExportSelected && (
            <button
              onClick={() => onExportSelected(selectedTextureNames, 'png')}
              className="px-2 py-0.5 bg-blue-700 hover:bg-blue-600 rounded text-white transition-colors"
            >
              Export PNG
            </button>
          )}
          <button
            onClick={() => onSelectionChange(new Set())}
            className="text-gray-400 hover:text-gray-200 transition-colors"
          >
            Clear
          </button>
        </div>
      )}

      {/* Content */}
      <div ref={listRef} className="flex-1 overflow-y-auto text-sm">
        {assets.length === 0 ? (
          <div className="p-4 text-gray-500 text-center">
            No file loaded
          </div>
        ) : viewMode === 'grid' ? (
          // Grid view
          <div>
            {/* Textures as grid */}
            {grouped.texture.length > 0 && (
              <div>
                <div
                  className="flex items-center gap-1 px-2 py-1.5 cursor-pointer hover:bg-gray-800 select-none font-medium text-gray-300"
                  onClick={() => toggleGroup('texture')}
                >
                  <span className="text-xs w-4">{collapsed['texture'] ? '\u25B6' : '\u25BC'}</span>
                  <span>Textures</span>
                  <span className="text-gray-500 ml-1">({grouped.texture.length})</span>
                  {loadingThumbs && (
                    <span className="flex items-center gap-1 text-gray-500 text-xs ml-2">
                      <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      {thumbnails.size}/{grouped.texture.length}
                    </span>
                  )}
                </div>
                {!collapsed['texture'] && (
                  <div className="grid gap-1 p-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(76px, 1fr))' }}>
                    {grouped.texture.map(renderGridItem)}
                  </div>
                )}
              </div>
            )}
            {/* Non-texture types as list */}
            {(['blob', 'gpu', 'sound'] as const).map(type => {
              const items = grouped[type]
              if (items.length === 0) return null
              const info = TYPE_LABELS[type]
              return (
                <div key={type}>
                  <div
                    className="flex items-center gap-1 px-2 py-1.5 cursor-pointer hover:bg-gray-800 select-none font-medium text-gray-300"
                    onClick={() => toggleGroup(type)}
                  >
                    <span className="text-xs w-4">{collapsed[type] ? '\u25B6' : '\u25BC'}</span>
                    <span>{info.label}</span>
                    <span className="text-gray-500 ml-1">({items.length})</span>
                  </div>
                  {!collapsed[type] && items.map(renderListItem)}
                </div>
              )
            })}
          </div>
        ) : (
          // List view
          Object.entries(grouped).map(([type, items]) => {
            if (items.length === 0) return null
            const info = TYPE_LABELS[type] || { label: type, icon: '?' }
            const isCollapsed = collapsed[type]

            return (
              <div key={type}>
                <div
                  className="flex items-center gap-1 px-2 py-1.5 cursor-pointer hover:bg-gray-800 select-none font-medium text-gray-300"
                  onClick={() => toggleGroup(type)}
                >
                  <span className="text-xs w-4">{isCollapsed ? '\u25B6' : '\u25BC'}</span>
                  <span>{info.label}</span>
                  <span className="text-gray-500 ml-1">({items.length})</span>
                </div>
                {!isCollapsed && items.map(renderListItem)}
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
          {selectedTextureNames.length > 1 && onExportSelected && (
            <>
              <button
                className="context-menu-item w-full text-left px-3 py-1.5 text-gray-200 hover:bg-gray-600 transition-colors"
                onClick={() => { onExportSelected(selectedTextureNames, 'png'); setContextMenu(null) }}
              >
                Export {selectedTextureNames.length} Selected as PNG
              </button>
              <button
                className="context-menu-item w-full text-left px-3 py-1.5 text-gray-200 hover:bg-gray-600 transition-colors"
                onClick={() => { onExportSelected(selectedTextureNames, 'jpg'); setContextMenu(null) }}
              >
                Export {selectedTextureNames.length} Selected as JPG
              </button>
              <div className="border-t border-gray-600 my-0.5" />
            </>
          )}
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
