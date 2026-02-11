import React, { useRef, useEffect, useState, useCallback } from 'react'
import { flushSync } from 'react-dom'
import { DDSInfoPanel } from './DDSInfoPanel'
import { ColorInspector, pickPixel, PickedColor } from './ColorInspector'
import { MagnifierLoupe } from './MagnifierLoupe'

export interface DDSData {
  filepath: string
  filename: string
  width: number
  height: number
  mips: number
  dxgiFormat: number
  dxgiFormatName: string
  fileSize: number
  headerSize: number
  rgbaPixels: Uint8Array
}

type Channel = 'rgba' | 'r' | 'g' | 'b' | 'a'
type Background = 'checkerboard' | 'black' | 'white'

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

interface DDSViewerProps {
  dds: DDSData
  onClose: () => void
  onNotify: (type: 'success' | 'error', title: string, message?: string) => void
  onCompare?: () => void
  onBatchExport?: () => void
}

export function DDSViewer({ dds, onClose, onNotify, onCompare, onBatchExport }: DDSViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [zoom, setZoom] = useState(1)
  const [channel, setChannel] = useState<Channel>('rgba')
  const [background, setBackground] = useState<Background>('checkerboard')
  const [mipLevel, setMipLevel] = useState(0)
  const [currentPixels, setCurrentPixels] = useState<Uint8Array>(dds.rgbaPixels)
  const [currentWidth, setCurrentWidth] = useState(dds.width)
  const [currentHeight, setCurrentHeight] = useState(dds.height)
  const [loadingMip, setLoadingMip] = useState(false)
  const [showInfo, setShowInfo] = useState(true)
  const [gridSize, setGridSize] = useState(0)
  const [pickedColor, setPickedColor] = useState<PickedColor | null>(null)
  const [ctrlHeld, setCtrlHeld] = useState(false)
  const [hoverPixel, setHoverPixel] = useState<{ x: number; y: number } | null>(null)
  const [canvasRectState, setCanvasRectState] = useState<DOMRect | null>(null)
  const lastHoverRef = useRef<{ x: number; y: number } | null>(null)
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null)
  const [dragCurrent, setDragCurrent] = useState<{ x: number; y: number } | null>(null)

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
    if (!canvasRef.current || !currentPixels) return
    const rect = canvasRef.current.getBoundingClientRect()
    const px = Math.floor((e.clientX - rect.left) / zoom)
    const py = Math.floor((e.clientY - rect.top) / zoom)
    if (px >= 0 && py >= 0 && px < currentWidth && py < currentHeight) {
      if (!lastHoverRef.current || lastHoverRef.current.x !== px || lastHoverRef.current.y !== py) {
        const next = { x: px, y: py }
        lastHoverRef.current = next
        setHoverPixel(next)
        setCanvasRectState(rect)
      }
    } else {
      if (lastHoverRef.current) { lastHoverRef.current = null; setHoverPixel(null) }
    }
    if (dragStart) setDragCurrent({ x: Math.max(0, Math.min(currentWidth - 1, px)), y: Math.max(0, Math.min(currentHeight - 1, py)) })
  }, [currentPixels, currentWidth, currentHeight, zoom, dragStart])

  const handleCanvasMouseLeave = useCallback(() => {
    lastHoverRef.current = null
    setHoverPixel(null)
  }, [])

  // Reset state when dds changes
  useEffect(() => {
    setMipLevel(0)
    setCurrentPixels(dds.rgbaPixels)
    setCurrentWidth(dds.width)
    setCurrentHeight(dds.height)
    setZoom(1)
  }, [dds])

  // Draw canvas
  useEffect(() => {
    if (!canvasRef.current || !currentPixels) return

    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    canvas.width = currentWidth
    canvas.height = currentHeight

    // Apply channel filter
    let pixels = currentPixels
    if (channel !== 'rgba') {
      pixels = new Uint8Array(currentPixels.length)
      for (let i = 0; i < currentPixels.length; i += 4) {
        switch (channel) {
          case 'r':
            pixels[i] = currentPixels[i]; pixels[i+1] = currentPixels[i]; pixels[i+2] = currentPixels[i]; pixels[i+3] = 255
            break
          case 'g':
            pixels[i] = currentPixels[i+1]; pixels[i+1] = currentPixels[i+1]; pixels[i+2] = currentPixels[i+1]; pixels[i+3] = 255
            break
          case 'b':
            pixels[i] = currentPixels[i+2]; pixels[i+1] = currentPixels[i+2]; pixels[i+2] = currentPixels[i+2]; pixels[i+3] = 255
            break
          case 'a':
            pixels[i] = currentPixels[i+3]; pixels[i+1] = currentPixels[i+3]; pixels[i+2] = currentPixels[i+3]; pixels[i+3] = 255
            break
        }
      }
    }

    const imageData = new ImageData(
      new Uint8ClampedArray(pixels.buffer, pixels.byteOffset, pixels.byteLength),
      currentWidth,
      currentHeight
    )
    ctx.putImageData(imageData, 0, 0)
  }, [currentPixels, currentWidth, currentHeight, channel])

  // Load mip level
  const handleMipChange = useCallback(async (level: number) => {
    if (level === 0) {
      setMipLevel(0)
      setCurrentPixels(dds.rgbaPixels)
      setCurrentWidth(dds.width)
      setCurrentHeight(dds.height)
      return
    }

    setLoadingMip(true)
    try {
      const result = await window.electronAPI.getDdsMip(dds.filepath, level) as {
        width: number; height: number; mipLevel: number; rgbaPixels: Uint8Array
      } | null
      if (result) {
        setMipLevel(level)
        setCurrentPixels(result.rgbaPixels)
        setCurrentWidth(result.width)
        setCurrentHeight(result.height)
      }
    } finally {
      setLoadingMip(false)
    }
  }, [dds])

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault()
    const delta = e.deltaY > 0 ? 0.9 : 1.1
    setZoom(prev => Math.max(0.1, Math.min(20, prev * delta)))
  }

  const handleCanvasMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (ctrlHeld || !canvasRef.current || !currentPixels) return
    e.preventDefault()
    const rect = canvasRef.current.getBoundingClientRect()
    const px = Math.floor((e.clientX - rect.left) / zoom)
    const py = Math.floor((e.clientY - rect.top) / zoom)
    if (px >= 0 && py >= 0 && px < currentWidth && py < currentHeight) {
      setDragStart({ x: px, y: py })
      setDragCurrent({ x: px, y: py })
    }
  }, [ctrlHeld, currentPixels, currentWidth, currentHeight, zoom])

  const handleCanvasMouseUp = useCallback(() => {
    if (!dragStart || !dragCurrent) { setDragStart(null); setDragCurrent(null); return }
    const dx = Math.abs(dragCurrent.x - dragStart.x)
    const dy = Math.abs(dragCurrent.y - dragStart.y)

    if (dx > 3 || dy > 3) {
      const container = scrollRef.current
      const canvas = canvasRef.current
      if (container && canvas) {
        const selW = Math.max(dx, 1)
        const selH = Math.max(dy, 1)
        const selX = Math.min(dragStart.x, dragCurrent.x)
        const selY = Math.min(dragStart.y, dragCurrent.y)
        const newZoom = Math.min(container.clientWidth / selW, container.clientHeight / selH) * 0.9

        // Force React to render the new zoom synchronously so DOM is updated
        flushSync(() => {
          setZoom(newZoom)
          setDragStart(null)
          setDragCurrent(null)
        })

        // Now the canvas has its new size - measure its actual position in the scroll container
        const containerRect = container.getBoundingClientRect()
        const canvasRect = canvas.getBoundingClientRect()
        // Canvas position in scroll-content coordinates
        const canvasInScrollX = canvasRect.left - containerRect.left + container.scrollLeft
        const canvasInScrollY = canvasRect.top - containerRect.top + container.scrollTop
        // Selection center in scroll-content coordinates
        const selCenterX = canvasInScrollX + (selX + selW / 2) * newZoom
        const selCenterY = canvasInScrollY + (selY + selH / 2) * newZoom
        // Scroll to center the selection in the viewport
        container.scrollLeft = selCenterX - container.clientWidth / 2
        container.scrollTop = selCenterY - container.clientHeight / 2
        return
      }
    } else {
      setPickedColor(pickPixel(currentPixels, currentWidth, dragStart.x, dragStart.y))
    }

    setDragStart(null)
    setDragCurrent(null)
  }, [dragStart, dragCurrent, currentPixels, currentWidth])

  // Cancel drag if mouse released outside canvas
  useEffect(() => {
    if (!dragStart) return
    const cancel = () => { setDragStart(null); setDragCurrent(null) }
    window.addEventListener('mouseup', cancel)
    return () => window.removeEventListener('mouseup', cancel)
  }, [dragStart])

  const handleExport = useCallback(async (format: 'png' | 'jpg') => {
    try {
      const result = await window.electronAPI.exportDds(
        new Uint8Array(currentPixels), currentWidth, currentHeight, format, format === 'jpg' ? 90 : undefined
      ) as { filepath: string; size: number } | { error: string } | null
      if (!result) return
      if ('error' in result) {
        onNotify('error', 'Export failed', result.error)
      } else {
        onNotify('success', `Exported ${format.toUpperCase()}`, `${formatSize(result.size)} saved`)
      }
    } catch (e) {
      onNotify('error', 'Export failed', String(e))
    }
  }, [currentPixels, currentWidth, currentHeight, onNotify])

  const bgStyle: Record<Background, React.CSSProperties> = {
    checkerboard: {},
    black: { backgroundColor: '#000' },
    white: { backgroundColor: '#fff' },
  }

  // Grid overlay style for pixel grid
  const effectiveGridPx = gridSize * zoom
  const gridOpacity = effectiveGridPx >= 32 ? 0.5 : effectiveGridPx >= 16 ? 0.4 : effectiveGridPx >= 8 ? 0.35 : 0.3
  const showGridOverlay = gridSize > 0 && effectiveGridPx >= 4

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-800 border-b border-gray-700 text-sm shrink-0">
        <span className="text-gray-300 font-medium truncate max-w-[200px]" title={dds.filename}>
          {dds.filename}
        </span>
        <span className="text-gray-600">|</span>
        <span className="text-gray-400">{dds.width}x{dds.height}</span>
        <span className="text-gray-600">|</span>
        <span className="text-gray-400">{dds.dxgiFormatName}</span>
        <span className="text-gray-600">|</span>
        <span className="text-gray-400">{dds.mips} mip{dds.mips > 1 ? 's' : ''}</span>
        <span className="text-gray-600">|</span>
        <span className="text-gray-400">{formatSize(dds.fileSize)}</span>
        <span className="text-gray-600">|</span>
        <span className="text-gray-400 cursor-pointer hover:text-gray-200 transition-colors" onClick={() => setZoom(1)} title="Reset zoom to 100%">Zoom: {Math.round(zoom * 100)}%</span>
        {Math.round(zoom * 100) !== 100 && (
          <button
            onClick={() => setZoom(1)}
            className="ml-1 text-gray-500 hover:text-gray-200 transition-colors"
            title="Reset zoom to 100%"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
        )}
        <div className="flex-1" />
        <button onClick={onClose} className="px-2 py-0.5 bg-gray-700 hover:bg-gray-600 rounded text-xs transition-colors">
          Close
        </button>
      </div>

      {/* Controls bar */}
      <div className="flex items-center gap-3 px-3 py-1.5 bg-gray-850 border-b border-gray-700 text-xs shrink-0">
        {/* Channel selector */}
        <div className="flex items-center gap-1">
          <span className="text-gray-500 mr-1">Channel:</span>
          {(['rgba', 'r', 'g', 'b', 'a'] as Channel[]).map(ch => (
            <button
              key={ch}
              onClick={() => setChannel(ch)}
              className={`px-1.5 py-0.5 rounded font-mono uppercase transition-colors ${
                channel === ch
                  ? ch === 'r' ? 'bg-red-700 text-white'
                    : ch === 'g' ? 'bg-green-700 text-white'
                    : ch === 'b' ? 'bg-blue-700 text-white'
                    : ch === 'a' ? 'bg-gray-500 text-white'
                    : 'bg-gray-600 text-white'
                  : 'text-gray-400 hover:text-gray-200 hover:bg-gray-700'
              }`}
            >
              {ch}
            </button>
          ))}
        </div>

        <span className="text-gray-600">|</span>

        {/* Background */}
        <div className="flex items-center gap-1">
          <span className="text-gray-500 mr-1">BG:</span>
          {(['checkerboard', 'black', 'white'] as Background[]).map(bg => (
            <button
              key={bg}
              onClick={() => setBackground(bg)}
              className={`px-1.5 py-0.5 rounded transition-colors ${
                background === bg ? 'bg-gray-600 text-white' : 'text-gray-400 hover:text-gray-200 hover:bg-gray-700'
              }`}
            >
              {bg === 'checkerboard' ? '\u2588\u2591' : bg}
            </button>
          ))}
        </div>

        <span className="text-gray-600">|</span>

        {/* Mipmap selector */}
        {dds.mips > 1 && (
          <div className="flex items-center gap-1">
            <span className="text-gray-500 mr-1">Mip:</span>
            <select
              value={mipLevel}
              onChange={e => handleMipChange(Number(e.target.value))}
              disabled={loadingMip}
              className="bg-gray-700 border border-gray-600 rounded px-1 py-0.5 text-gray-200 text-xs"
            >
              {Array.from({ length: dds.mips }, (_, i) => {
                const mw = Math.max(1, dds.width >> i)
                const mh = Math.max(1, dds.height >> i)
                return (
                  <option key={i} value={i}>
                    {i}: {mw}x{mh}
                  </option>
                )
              })}
            </select>
            <span className="text-gray-600">|</span>
          </div>
        )}

        {/* Zoom controls */}
        <button onClick={() => setZoom(1)} className="text-gray-400 hover:text-gray-200 px-1">1:1</button>
        <button onClick={() => {
          if (scrollRef.current && currentWidth > 0) {
            setZoom(Math.min(scrollRef.current.clientWidth / currentWidth, scrollRef.current.clientHeight / currentHeight) * 0.95)
          }
        }} className="text-gray-400 hover:text-gray-200 px-1">Fit</button>

        <span className="text-gray-600">|</span>

        {/* Grid size */}
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

        {/* Info panel toggle */}
        <button
          onClick={() => setShowInfo(prev => !prev)}
          className={`px-1.5 py-0.5 rounded transition-colors ${
            showInfo ? 'bg-gray-600 text-white' : 'text-gray-400 hover:text-gray-200 hover:bg-gray-700'
          }`}
          title="Toggle info panel"
        >
          Info
        </button>

        <div className="flex-1" />

        {/* Compare button - for later use */}
        {/* {onCompare && (
          <button
            onClick={onCompare}
            className="px-2 py-0.5 bg-gray-700 hover:bg-gray-600 rounded transition-colors text-gray-200"
          >
            Compare
          </button>
        )} */}

        {/* Batch export button - for later use */}
        {/* {onBatchExport && (
          <button
            onClick={onBatchExport}
            className="px-2 py-0.5 bg-gray-700 hover:bg-gray-600 rounded transition-colors text-gray-200"
          >
            Batch
          </button>
        )} */}

        {/* Export buttons */}
        <button
          onClick={() => handleExport('png')}
          className="px-2 py-0.5 bg-blue-700 hover:bg-blue-600 rounded transition-colors text-white"
        >
          Export PNG
        </button>
        <button
          onClick={() => handleExport('jpg')}
          className="px-2 py-0.5 bg-blue-700 hover:bg-blue-600 rounded transition-colors text-white"
        >
          Export JPG
        </button>
      </div>

      {/* Canvas + Info Panel */}
      <div className="flex-1 flex overflow-hidden">
        <div className="flex-1 flex flex-col min-h-0">
          <div
            ref={scrollRef}
            className={`flex-1 overflow-auto relative${background === 'checkerboard' ? ' checkerboard-bg' : ''}`}
            style={background !== 'checkerboard' ? bgStyle[background] : undefined}
            onWheel={handleWheel}
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
                  onMouseDown={handleCanvasMouseDown}
                  onMouseMove={handleCanvasMouseMove}
                  onMouseUp={handleCanvasMouseUp}
                  onMouseLeave={handleCanvasMouseLeave}
                  style={{
                    display: 'block',
                    width: currentWidth * zoom,
                    height: currentHeight * zoom,
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
                {dragStart && dragCurrent && (Math.abs(dragCurrent.x - dragStart.x) > 1 || Math.abs(dragCurrent.y - dragStart.y) > 1) && (
                  <div style={{
                    position: 'absolute',
                    left: Math.min(dragStart.x, dragCurrent.x) * zoom,
                    top: Math.min(dragStart.y, dragCurrent.y) * zoom,
                    width: Math.abs(dragCurrent.x - dragStart.x) * zoom,
                    height: Math.abs(dragCurrent.y - dragStart.y) * zoom,
                    border: '1.5px solid rgba(59, 130, 246, 0.8)',
                    backgroundColor: 'rgba(59, 130, 246, 0.1)',
                    pointerEvents: 'none',
                  }} />
                )}
              </div>
            </div>
            {/* Magnifier loupe */}
            {ctrlHeld && hoverPixel && canvasRectState && (
              <MagnifierLoupe
                pixels={currentPixels}
                width={currentWidth}
                height={currentHeight}
                mouseX={hoverPixel.x}
                mouseY={hoverPixel.y}
                canvasRect={canvasRectState}
                zoom={zoom}
                visible={true}
              />
            )}
          </div>
        </div>

        {/* Info sidebar */}
        {showInfo && (
          <DDSInfoPanel
            dds={dds}
            currentMip={mipLevel}
            currentWidth={currentWidth}
            currentHeight={currentHeight}
            pixels={currentPixels}
          />
        )}
      </div>

      {/* Color inspector bar */}
      <ColorInspector color={pickedColor} hoverPixel={hoverPixel} />

      {/* Info bar */}
      <div className="h-6 bg-gray-800 border-t border-gray-700 flex items-center px-3 text-xs text-gray-400 shrink-0">
        <span>{dds.filepath}</span>
        <div className="flex-1" />
        <span>Header: {dds.headerSize}B</span>
        <span className="mx-2">|</span>
        <span>DXGI: {dds.dxgiFormat}</span>
        <span className="mx-2">|</span>
        <span>Viewing: {currentWidth}x{currentHeight} (mip {mipLevel})</span>
      </div>
    </div>
  )
}
