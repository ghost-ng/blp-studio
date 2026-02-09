import React, { useRef, useEffect, useState, useCallback } from 'react'
import { DDSInfoPanel } from './DDSInfoPanel'

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
  const [zoom, setZoom] = useState(1)
  const [channel, setChannel] = useState<Channel>('rgba')
  const [background, setBackground] = useState<Background>('checkerboard')
  const [mipLevel, setMipLevel] = useState(0)
  const [currentPixels, setCurrentPixels] = useState<Uint8Array>(dds.rgbaPixels)
  const [currentWidth, setCurrentWidth] = useState(dds.width)
  const [currentHeight, setCurrentHeight] = useState(dds.height)
  const [loadingMip, setLoadingMip] = useState(false)
  const [showInfo, setShowInfo] = useState(true)
  const [showGrid, setShowGrid] = useState(false)

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
  const gridOpacity = zoom >= 8 ? 0.3 : zoom >= 4 ? 0.2 : zoom >= 2 ? 0.12 : 0.06
  const showGridOverlay = showGrid && zoom >= 1

  return (
    <div className="flex flex-col h-full">
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
        <span className="text-gray-400">Zoom: {Math.round(zoom * 100)}%</span>
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
          const container = canvasRef.current?.parentElement
          if (container && currentWidth > 0) {
            setZoom(Math.min(container.clientWidth / currentWidth, container.clientHeight / currentHeight) * 0.95)
          }
        }} className="text-gray-400 hover:text-gray-200 px-1">Fit</button>

        <span className="text-gray-600">|</span>

        {/* Grid toggle */}
        <button
          onClick={() => setShowGrid(prev => !prev)}
          className={`px-1.5 py-0.5 rounded transition-colors ${
            showGrid ? 'bg-gray-600 text-white' : 'text-gray-400 hover:text-gray-200 hover:bg-gray-700'
          }`}
          title="Pixel grid (visible at 4x+ zoom)"
        >
          Grid
        </button>

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

        {/* Compare button */}
        {onCompare && (
          <button
            onClick={onCompare}
            className="px-2 py-0.5 bg-gray-700 hover:bg-gray-600 rounded transition-colors text-gray-200"
          >
            Compare
          </button>
        )}

        {/* Batch export button */}
        {onBatchExport && (
          <button
            onClick={onBatchExport}
            className="px-2 py-0.5 bg-gray-700 hover:bg-gray-600 rounded transition-colors text-gray-200"
          >
            Batch
          </button>
        )}

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
        <div
          className={`flex-1 overflow-auto${background === 'checkerboard' ? ' checkerboard-bg' : ''}`}
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
                style={{
                  display: 'block',
                  width: currentWidth * zoom,
                  height: currentHeight * zoom,
                  imageRendering: zoom > 2 ? 'pixelated' : 'auto',
                }}
              />
              {showGridOverlay && (
                <div style={{
                  position: 'absolute',
                  inset: 0,
                  backgroundSize: `${zoom}px ${zoom}px`,
                  backgroundImage: `linear-gradient(to right, rgba(255,255,255,${gridOpacity}) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,${gridOpacity}) 1px, transparent 1px)`,
                  pointerEvents: 'none',
                  imageRendering: 'pixelated',
                }} />
              )}
            </div>
          </div>
        </div>

        {/* Info sidebar */}
        {showInfo && (
          <DDSInfoPanel
            dds={dds}
            currentMip={mipLevel}
            currentWidth={currentWidth}
            currentHeight={currentHeight}
          />
        )}
      </div>

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
