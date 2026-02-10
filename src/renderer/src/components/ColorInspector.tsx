import React from 'react'

export interface PickedColor {
  x: number
  y: number
  r: number
  g: number
  b: number
  a: number
}

interface ColorInspectorProps {
  color: PickedColor | null
  onClose?: () => void
}

function toHex(n: number): string {
  return n.toString(16).padStart(2, '0').toUpperCase()
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return [0, 0, Math.round(l * 100)]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h = 0
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6
  else if (max === g) h = ((b - r) / d + 2) / 6
  else h = ((r - g) / d + 4) / 6
  return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)]
}

export function ColorInspector({ color, onClose }: ColorInspectorProps) {
  if (!color) return null

  const hex = `#${toHex(color.r)}${toHex(color.g)}${toHex(color.b)}`
  const [h, s, l] = rgbToHsl(color.r, color.g, color.b)
  const rgbaCss = `rgba(${color.r}, ${color.g}, ${color.b}, ${(color.a / 255).toFixed(2)})`

  return (
    <div className="flex items-center gap-3 px-3 py-1.5 bg-gray-800 border-t border-gray-700 text-xs shrink-0">
      {/* Color swatch */}
      <div className="flex items-center gap-2">
        <div
          className="w-6 h-6 rounded border border-gray-600 shrink-0"
          style={{ backgroundColor: rgbaCss }}
        />
        <span className="font-mono text-gray-200 font-medium">{hex}</span>
      </div>

      <span className="text-gray-600">|</span>

      {/* RGBA values */}
      <div className="flex items-center gap-1.5">
        <span className="text-red-400 font-mono">R:{color.r}</span>
        <span className="text-green-400 font-mono">G:{color.g}</span>
        <span className="text-blue-400 font-mono">B:{color.b}</span>
        <span className="text-gray-400 font-mono">A:{color.a}</span>
      </div>

      <span className="text-gray-600">|</span>

      {/* HSL */}
      <span className="text-gray-400 font-mono">H:{h} S:{s}% L:{l}%</span>

      <span className="text-gray-600">|</span>

      {/* Position */}
      <span className="text-gray-500 font-mono">({color.x}, {color.y})</span>

      <div className="flex-1" />

      {onClose && (
        <button
          onClick={onClose}
          className="text-gray-500 hover:text-gray-300 transition-colors"
          title="Dismiss"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
  )
}

/** Read a pixel from RGBA pixel data at the given coordinates */
export function pickPixel(
  pixels: Uint8Array,
  width: number,
  x: number,
  y: number
): PickedColor | null {
  if (x < 0 || y < 0 || x >= width) return null
  const height = (pixels.length / 4 / width) | 0
  if (y >= height) return null
  const i = (y * width + x) * 4
  if (i + 3 >= pixels.length) return null
  return { x, y, r: pixels[i], g: pixels[i + 1], b: pixels[i + 2], a: pixels[i + 3] }
}
