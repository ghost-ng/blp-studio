import React, { useRef, useEffect } from 'react'

interface MagnifierLoupeProps {
  pixels: Uint8Array | null
  width: number
  height: number
  mouseX: number
  mouseY: number
  canvasRect: DOMRect
  zoom: number
  visible: boolean
  sourceCanvas?: HTMLCanvasElement | null
}

const LOUPE_RADIUS = 5
const PIXEL_SIZE = 13
const LOUPE_SIZE = (LOUPE_RADIUS * 2 + 1) * PIXEL_SIZE // 143px

export function MagnifierLoupe({ pixels, width, height, mouseX, mouseY, canvasRect, zoom, visible, sourceCanvas }: MagnifierLoupeProps) {
  const loupeRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (!visible || !loupeRef.current) return
    if (!pixels && !sourceCanvas) return
    const canvas = loupeRef.current
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    canvas.width = LOUPE_SIZE
    canvas.height = LOUPE_SIZE

    // Read region from source canvas when no direct pixel array (bitmap mode)
    let regionData: ImageData | null = null
    if (!pixels && sourceCanvas) {
      const srcCtx = sourceCanvas.getContext('2d')
      if (srcCtx) {
        const rx = Math.max(0, mouseX - LOUPE_RADIUS)
        const ry = Math.max(0, mouseY - LOUPE_RADIUS)
        const rw = Math.min(width - rx, LOUPE_RADIUS * 2 + 1 + Math.min(0, mouseX - LOUPE_RADIUS))
        const rh = Math.min(height - ry, LOUPE_RADIUS * 2 + 1 + Math.min(0, mouseY - LOUPE_RADIUS))
        if (rw > 0 && rh > 0) {
          regionData = srcCtx.getImageData(rx, ry, rw, rh)
        }
      }
    }

    // Helper to read a pixel from either direct array or canvas region
    const readPixel = (sx: number, sy: number): [number, number, number, number] | null => {
      if (sx < 0 || sy < 0 || sx >= width || sy >= height) return null
      if (pixels) {
        const idx = (sy * width + sx) * 4
        return [pixels[idx], pixels[idx + 1], pixels[idx + 2], pixels[idx + 3]]
      }
      if (regionData) {
        const rx = Math.max(0, mouseX - LOUPE_RADIUS)
        const ry = Math.max(0, mouseY - LOUPE_RADIUS)
        const lx = sx - rx
        const ly = sy - ry
        if (lx < 0 || ly < 0 || lx >= regionData.width || ly >= regionData.height) return null
        const idx = (ly * regionData.width + lx) * 4
        return [regionData.data[idx], regionData.data[idx + 1], regionData.data[idx + 2], regionData.data[idx + 3]]
      }
      return null
    }

    // Draw checkerboard background for transparency
    for (let dy = -LOUPE_RADIUS; dy <= LOUPE_RADIUS; dy++) {
      for (let dx = -LOUPE_RADIUS; dx <= LOUPE_RADIUS; dx++) {
        const px = (dx + LOUPE_RADIUS) * PIXEL_SIZE
        const py = (dy + LOUPE_RADIUS) * PIXEL_SIZE
        const sx = mouseX + dx
        const sy = mouseY + dy

        // Checkerboard for out-of-bounds or transparent areas
        const checkSize = PIXEL_SIZE / 2
        for (let cy = 0; cy < 2; cy++) {
          for (let cx = 0; cx < 2; cx++) {
            ctx.fillStyle = (cx + cy) % 2 === 0 ? '#404040' : '#303030'
            ctx.fillRect(px + cx * checkSize, py + cy * checkSize, checkSize, checkSize)
          }
        }

        const pixel = readPixel(sx, sy)
        if (pixel) {
          ctx.fillStyle = `rgba(${pixel[0]},${pixel[1]},${pixel[2]},${pixel[3] / 255})`
          ctx.fillRect(px, py, PIXEL_SIZE, PIXEL_SIZE)
        }
      }
    }

    // Draw grid lines
    ctx.strokeStyle = 'rgba(255,255,255,0.08)'
    ctx.lineWidth = 1
    for (let i = 0; i <= LOUPE_RADIUS * 2 + 1; i++) {
      const p = i * PIXEL_SIZE + 0.5
      ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, LOUPE_SIZE); ctx.stroke()
      ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(LOUPE_SIZE, p); ctx.stroke()
    }

    // Center pixel crosshair
    const c = LOUPE_RADIUS * PIXEL_SIZE
    ctx.strokeStyle = 'rgba(255,255,255,0.9)'
    ctx.lineWidth = 1.5
    ctx.strokeRect(c + 0.75, c + 0.75, PIXEL_SIZE - 1.5, PIXEL_SIZE - 1.5)
    ctx.strokeStyle = 'rgba(0,0,0,0.6)'
    ctx.lineWidth = 1
    ctx.strokeRect(c + 2, c + 2, PIXEL_SIZE - 4, PIXEL_SIZE - 4)

  }, [visible, pixels, sourceCanvas, width, height, mouseX, mouseY])

  if (!visible) return null

  // Position loupe near cursor in screen space
  const screenX = canvasRect.left + (mouseX + 0.5) * zoom
  const screenY = canvasRect.top + (mouseY + 0.5) * zoom
  const OFFSET = 24

  let left = screenX + OFFSET
  let top = screenY - LOUPE_SIZE - OFFSET
  if (left + LOUPE_SIZE + 8 > window.innerWidth) left = screenX - LOUPE_SIZE - OFFSET
  if (top < 8) top = screenY + OFFSET

  // Read center pixel for label
  let colorLabel = ''
  if (mouseX >= 0 && mouseY >= 0 && mouseX < width && mouseY < height) {
    let r = 0, g = 0, b = 0, a = 0
    if (pixels) {
      const idx = (mouseY * width + mouseX) * 4
      r = pixels[idx]; g = pixels[idx + 1]; b = pixels[idx + 2]; a = pixels[idx + 3]
    } else if (sourceCanvas) {
      const srcCtx = sourceCanvas.getContext('2d')
      if (srcCtx) {
        const d = srcCtx.getImageData(mouseX, mouseY, 1, 1).data
        r = d[0]; g = d[1]; b = d[2]; a = d[3]
      }
    }
    const hex = `#${r.toString(16).padStart(2, '0').toUpperCase()}${g.toString(16).padStart(2, '0').toUpperCase()}${b.toString(16).padStart(2, '0').toUpperCase()}`
    colorLabel = `${hex}  A:${a}`
  }

  return (
    <div
      className="fixed z-50 pointer-events-none"
      style={{ left, top }}
    >
      <canvas
        ref={loupeRef}
        className="border-2 border-gray-500 rounded-lg shadow-xl"
        style={{ width: LOUPE_SIZE, height: LOUPE_SIZE, imageRendering: 'pixelated' }}
      />
      <div className="mt-1 bg-gray-900/95 rounded px-2 py-0.5 text-xs font-mono text-center">
        <span className="text-gray-300">({mouseX}, {mouseY})</span>
        {colorLabel && <span className="text-gray-500 ml-2">{colorLabel}</span>}
      </div>
    </div>
  )
}
