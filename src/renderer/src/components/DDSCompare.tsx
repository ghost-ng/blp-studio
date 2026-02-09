import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react'
import { DDSData } from './DDSViewer'

type ViewMode = 'side-by-side' | 'difference' | 'ab-toggle'

interface DDSCompareProps {
  leftDds: DDSData
  onClose: () => void
  onNotify: (type: 'success' | 'error', title: string, message?: string) => void
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

const CHECKERBOARD_BG: React.CSSProperties = {
  backgroundImage:
    'url("data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%20width%3D%2216%22%20height%3D%2216%22%3E%3Crect%20width%3D%228%22%20height%3D%228%22%20fill%3D%22%23444%22/%3E%3Crect%20x%3D%228%22%20y%3D%228%22%20width%3D%228%22%20height%3D%228%22%20fill%3D%22%23444%22/%3E%3Crect%20x%3D%228%22%20width%3D%228%22%20height%3D%228%22%20fill%3D%22%23333%22/%3E%3Crect%20y%3D%228%22%20width%3D%228%22%20height%3D%228%22%20fill%3D%22%23333%22/%3E%3C/svg%3E")',
}

export function DDSCompare({ leftDds, onClose, onNotify }: DDSCompareProps) {
  const leftCanvasRef = useRef<HTMLCanvasElement>(null)
  const rightCanvasRef = useRef<HTMLCanvasElement>(null)
  const diffCanvasRef = useRef<HTMLCanvasElement>(null)

  const [rightDds, setRightDds] = useState<DDSData | null>(null)
  const [viewMode, setViewMode] = useState<ViewMode>('side-by-side')
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [isPanning, setIsPanning] = useState(false)
  const [panStart, setPanStart] = useState({ x: 0, y: 0 })
  const [abShowLeft, setAbShowLeft] = useState(true)
  const [loadingRight, setLoadingRight] = useState(false)

  // Keyboard shortcut: Space toggles A/B in ab-toggle mode
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.code === 'Space' && viewMode === 'ab-toggle' && rightDds) {
        e.preventDefault()
        setAbShowLeft(prev => !prev)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [viewMode, rightDds])

  const dimensionMismatch = rightDds !== null && (
    leftDds.width !== rightDds.width || leftDds.height !== rightDds.height
  )

  // Compute difference pixels
  const diffPixels = useMemo(() => {
    if (!rightDds) return null
    if (leftDds.width !== rightDds.width || leftDds.height !== rightDds.height) return null

    const left = leftDds.rgbaPixels
    const right = rightDds.rgbaPixels
    const len = Math.min(left.length, right.length)
    const diff = new Uint8Array(len)

    for (let i = 0; i < len; i += 4) {
      const dr = Math.abs(left[i] - right[i])
      const dg = Math.abs(left[i + 1] - right[i + 1])
      const db = Math.abs(left[i + 2] - right[i + 2])
      const intensity = Math.min(255, (dr + dg + db) * 4)
      diff[i] = intensity
      diff[i + 1] = intensity
      diff[i + 2] = intensity
      diff[i + 3] = 255
    }

    return diff
  }, [leftDds, rightDds])

  // Draw left canvas
  useEffect(() => {
    if (!leftCanvasRef.current) return
    const canvas = leftCanvasRef.current
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    canvas.width = leftDds.width
    canvas.height = leftDds.height

    const imageData = new ImageData(
      new Uint8ClampedArray(
        leftDds.rgbaPixels.buffer,
        leftDds.rgbaPixels.byteOffset,
        leftDds.rgbaPixels.byteLength
      ),
      leftDds.width,
      leftDds.height
    )
    ctx.putImageData(imageData, 0, 0)
  }, [leftDds, viewMode, abShowLeft])

  // Draw right canvas
  useEffect(() => {
    if (!rightCanvasRef.current || !rightDds) return
    const canvas = rightCanvasRef.current
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    canvas.width = rightDds.width
    canvas.height = rightDds.height

    const imageData = new ImageData(
      new Uint8ClampedArray(
        rightDds.rgbaPixels.buffer,
        rightDds.rgbaPixels.byteOffset,
        rightDds.rgbaPixels.byteLength
      ),
      rightDds.width,
      rightDds.height
    )
    ctx.putImageData(imageData, 0, 0)
  }, [rightDds, viewMode, abShowLeft])

  // Draw difference canvas
  useEffect(() => {
    if (!diffCanvasRef.current || !diffPixels) return
    const canvas = diffCanvasRef.current
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    canvas.width = leftDds.width
    canvas.height = leftDds.height

    const imageData = new ImageData(
      new Uint8ClampedArray(diffPixels.buffer, diffPixels.byteOffset, diffPixels.byteLength),
      leftDds.width,
      leftDds.height
    )
    ctx.putImageData(imageData, 0, 0)
  }, [diffPixels, leftDds.width, leftDds.height])

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault()
    const delta = e.deltaY > 0 ? 0.9 : 1.1
    setZoom(prev => Math.max(0.1, Math.min(20, prev * delta)))
  }, [])

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button === 1 || (e.button === 0 && e.altKey)) {
      e.preventDefault()
      setIsPanning(true)
      setPanStart({ x: e.clientX - pan.x, y: e.clientY - pan.y })
    }
  }, [pan])

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isPanning) return
    setPan({
      x: e.clientX - panStart.x,
      y: e.clientY - panStart.y,
    })
  }, [isPanning, panStart])

  const handleMouseUp = useCallback(() => {
    setIsPanning(false)
  }, [])

  const handleOpenComparison = useCallback(async () => {
    setLoadingRight(true)
    try {
      const result = await (window as any).electronAPI.openDDS() as DDSData | { error: string } | null
      if (!result) {
        setLoadingRight(false)
        return
      }
      if ('error' in result) {
        onNotify('error', 'Failed to load DDS', result.error)
        setLoadingRight(false)
        return
      }
      setRightDds(result)
      onNotify('success', 'Comparison loaded', result.filename)
    } catch (e) {
      onNotify('error', 'Failed to load DDS', String(e))
    } finally {
      setLoadingRight(false)
    }
  }, [onNotify])

  const handleResetView = useCallback(() => {
    setZoom(1)
    setPan({ x: 0, y: 0 })
  }, [])

  const canvasTransform: React.CSSProperties = {
    transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
    transformOrigin: 'center',
    imageRendering: zoom > 2 ? 'pixelated' : 'auto',
  }

  const modeButtonClass = (mode: ViewMode) =>
    `px-2 py-0.5 rounded text-xs transition-colors ${
      viewMode === mode
        ? 'bg-gray-600 text-white'
        : 'text-gray-400 hover:text-gray-200 hover:bg-gray-700'
    }`

  function InfoBar({ dds, label }: { dds: DDSData; label: string }) {
    return (
      <div className="px-2 py-1 text-xs text-gray-400 bg-gray-800 border-t border-gray-700 shrink-0">
        <span className="text-gray-500 mr-1">{label}:</span>
        <span className="text-gray-300 mr-2" title={dds.filename}>{dds.filename}</span>
        <span className="text-gray-600 mr-1">|</span>
        <span>{dds.width}x{dds.height}</span>
        <span className="text-gray-600 mx-1">|</span>
        <span>{dds.dxgiFormatName}</span>
        <span className="text-gray-600 mx-1">|</span>
        <span>{formatSize(dds.fileSize)}</span>
        <span className="text-gray-600 mx-1">|</span>
        <span>{dds.mips} mip{dds.mips !== 1 ? 's' : ''}</span>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-800 border-b border-gray-700 text-sm shrink-0">
        <span className="text-gray-300 font-medium">Compare</span>
        <span className="text-gray-600">|</span>

        {/* View mode toggles */}
        <div className="flex items-center gap-1">
          <span className="text-gray-500 text-xs mr-1">Mode:</span>
          <button
            onClick={() => setViewMode('side-by-side')}
            className={modeButtonClass('side-by-side')}
          >
            Side by Side
          </button>
          <button
            onClick={() => setViewMode('difference')}
            className={modeButtonClass('difference')}
            disabled={!rightDds || dimensionMismatch}
            title={dimensionMismatch ? 'Requires matching dimensions' : undefined}
          >
            Difference
          </button>
          <button
            onClick={() => setViewMode('ab-toggle')}
            className={modeButtonClass('ab-toggle')}
            disabled={!rightDds}
          >
            A/B Toggle
          </button>
        </div>

        <span className="text-gray-600">|</span>
        <span className="text-gray-400 text-xs">Zoom: {Math.round(zoom * 100)}%</span>
        <button
          onClick={handleResetView}
          className="text-gray-400 hover:text-gray-200 text-xs px-1"
        >
          Reset
        </button>

        <div className="flex-1" />

        {!rightDds && (
          <button
            onClick={handleOpenComparison}
            disabled={loadingRight}
            className="px-2 py-0.5 bg-blue-700 hover:bg-blue-600 disabled:bg-gray-700 disabled:text-gray-500 rounded text-xs transition-colors"
          >
            {loadingRight ? 'Loading...' : 'Open comparison DDS...'}
          </button>
        )}
        {rightDds && (
          <button
            onClick={handleOpenComparison}
            disabled={loadingRight}
            className="px-2 py-0.5 bg-gray-700 hover:bg-gray-600 rounded text-xs transition-colors"
          >
            Change comparison...
          </button>
        )}

        <button
          onClick={onClose}
          className="px-2 py-0.5 bg-gray-700 hover:bg-gray-600 rounded text-xs transition-colors"
        >
          Close
        </button>
      </div>

      {/* Dimension mismatch warning */}
      {dimensionMismatch && (
        <div className="px-3 py-1.5 bg-yellow-900/60 border-b border-yellow-700 text-xs text-yellow-300 shrink-0 flex items-center gap-2">
          <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M12 2L2 20h20L12 2z" />
          </svg>
          <span>
            Dimension mismatch: left is {leftDds.width}x{leftDds.height}, right is {rightDds!.width}x{rightDds!.height}.
            Difference mode is unavailable.
          </span>
        </div>
      )}

      {/* Canvas area */}
      <div
        className="flex-1 flex overflow-hidden"
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        style={{ cursor: isPanning ? 'grabbing' : 'default' }}
      >
        {/* Side by Side mode */}
        {viewMode === 'side-by-side' && (
          <>
            {/* Left pane */}
            <div className="flex-1 flex flex-col border-r border-gray-700 min-w-0">
              <div
                className="flex-1 overflow-hidden flex items-center justify-center"
                style={CHECKERBOARD_BG}
              >
                <canvas ref={leftCanvasRef} style={canvasTransform} />
              </div>
              <InfoBar dds={leftDds} label="A" />
            </div>

            {/* Right pane */}
            <div className="flex-1 flex flex-col min-w-0">
              {rightDds ? (
                <>
                  <div
                    className="flex-1 overflow-hidden flex items-center justify-center"
                    style={CHECKERBOARD_BG}
                  >
                    <canvas ref={rightCanvasRef} style={canvasTransform} />
                  </div>
                  <InfoBar dds={rightDds} label="B" />
                </>
              ) : (
                <div className="flex-1 flex items-center justify-center bg-gray-900 text-gray-500">
                  <div className="text-center">
                    <p className="text-sm mb-2">No comparison texture loaded</p>
                    <button
                      onClick={handleOpenComparison}
                      disabled={loadingRight}
                      className="px-3 py-1.5 bg-blue-700 hover:bg-blue-600 disabled:bg-gray-700 rounded text-sm transition-colors text-white"
                    >
                      {loadingRight ? 'Loading...' : 'Open comparison DDS...'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </>
        )}

        {/* Difference mode */}
        {viewMode === 'difference' && (
          <div className="flex-1 flex flex-col min-w-0">
            <div
              className="flex-1 overflow-hidden flex items-center justify-center"
              style={{ backgroundColor: '#000' }}
            >
              {diffPixels ? (
                <canvas ref={diffCanvasRef} style={canvasTransform} />
              ) : (
                <span className="text-gray-500 text-sm">
                  {dimensionMismatch
                    ? 'Cannot compute difference: dimensions do not match'
                    : 'Load a comparison texture to see differences'}
                </span>
              )}
            </div>
            <div className="px-2 py-1 text-xs text-gray-400 bg-gray-800 border-t border-gray-700 shrink-0">
              <span className="text-gray-500 mr-1">Difference:</span>
              <span>Per-pixel abs(A-B) amplified 4x as grayscale. Brighter = more different.</span>
            </div>
          </div>
        )}

        {/* A/B Toggle mode */}
        {viewMode === 'ab-toggle' && (
          <div className="flex-1 flex flex-col min-w-0">
            <div
              className="flex-1 overflow-hidden flex items-center justify-center"
              style={CHECKERBOARD_BG}
            >
              {abShowLeft ? (
                <canvas ref={leftCanvasRef} style={canvasTransform} />
              ) : rightDds ? (
                <canvas ref={rightCanvasRef} style={canvasTransform} />
              ) : (
                <span className="text-gray-500 text-sm">Load a comparison texture first</span>
              )}
            </div>
            <div className="px-2 py-1 text-xs bg-gray-800 border-t border-gray-700 shrink-0 flex items-center gap-2">
              <button
                onClick={() => setAbShowLeft(true)}
                className={`px-2 py-0.5 rounded transition-colors ${
                  abShowLeft ? 'bg-gray-600 text-white' : 'text-gray-400 hover:text-gray-200 hover:bg-gray-700'
                }`}
              >
                A: {leftDds.filename}
              </button>
              <button
                onClick={() => setAbShowLeft(false)}
                disabled={!rightDds}
                className={`px-2 py-0.5 rounded transition-colors ${
                  !abShowLeft ? 'bg-gray-600 text-white' : 'text-gray-400 hover:text-gray-200 hover:bg-gray-700'
                } disabled:text-gray-600`}
              >
                B: {rightDds ? rightDds.filename : '(none)'}
              </button>
              <span className="text-gray-500 ml-2">Click a button or press Space to toggle</span>
            </div>
          </div>
        )}
      </div>

      {/* Bottom info bar */}
      <div className="h-6 bg-gray-800 border-t border-gray-700 flex items-center px-3 text-xs text-gray-400 shrink-0">
        <span className="truncate" title={leftDds.filepath}>A: {leftDds.filepath}</span>
        {rightDds && (
          <>
            <span className="mx-2 text-gray-600">|</span>
            <span className="truncate" title={rightDds.filepath}>B: {rightDds.filepath}</span>
          </>
        )}
        <div className="flex-1" />
        <span className="text-gray-500">Alt+drag or middle-click to pan</span>
      </div>
    </div>
  )
}
