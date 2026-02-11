import React, { useRef, useEffect } from 'react'

interface MagnifierLoupeProps {
  pixels: Uint8Array
  width: number
  height: number
  mouseX: number
  mouseY: number
  canvasRect: DOMRect
  zoom: number
  visible: boolean
}

const LOUPE_RADIUS = 5
const PIXEL_SIZE = 13
const LOUPE_SIZE = (LOUPE_RADIUS * 2 + 1) * PIXEL_SIZE // 143px

export function MagnifierLoupe({ pixels, width, height, mouseX, mouseY, canvasRect, zoom, visible }: MagnifierLoupeProps) {
  const loupeRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (!visible || !loupeRef.current) return
    const canvas = loupeRef.current
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    canvas.width = LOUPE_SIZE
    canvas.height = LOUPE_SIZE

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

        if (sx >= 0 && sy >= 0 && sx < width && sy < height) {
          const idx = (sy * width + sx) * 4
          const r = pixels[idx], g = pixels[idx + 1], b = pixels[idx + 2], a = pixels[idx + 3]
          ctx.fillStyle = `rgba(${r},${g},${b},${a / 255})`
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

  }, [visible, pixels, width, height, mouseX, mouseY])

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
    const idx = (mouseY * width + mouseX) * 4
    const r = pixels[idx], g = pixels[idx + 1], b = pixels[idx + 2], a = pixels[idx + 3]
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
