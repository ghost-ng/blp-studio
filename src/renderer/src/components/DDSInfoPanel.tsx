import React, { useMemo } from 'react'
import type { DDSData } from './DDSViewer'

interface DDSInfoPanelProps {
  dds: DDSData | null
  currentMip: number
  currentWidth: number
  currentHeight: number
  pixels?: Uint8Array
}

// ---------------------------------------------------------------------------
// DXGI format classification helpers
// ---------------------------------------------------------------------------

const SRGB_FORMATS = new Set([29, 72, 75, 78, 84, 96, 99])

// BC format ranges by DXGI format ID
// BC1: 71-72 (UNORM, UNORM_SRGB), also 70 (TYPELESS)
// BC2: 74-75, also 73
// BC3: 77-78, also 76
// BC4: 80-81, also 79
// BC5: 83-84, also 82
// BC6H: 95-96, also 94
// BC7: 98-99, also 97

interface BlockFormatInfo {
  name: string
  blockSize: number  // bytes per 4x4 block
  bpp: number        // bits per pixel
}

function getBlockFormatInfo(dxgiFormat: number): BlockFormatInfo | null {
  if (dxgiFormat >= 70 && dxgiFormat <= 72) return { name: 'BC1', blockSize: 8, bpp: 4 }
  if (dxgiFormat >= 73 && dxgiFormat <= 75) return { name: 'BC2', blockSize: 16, bpp: 8 }
  if (dxgiFormat >= 76 && dxgiFormat <= 78) return { name: 'BC3', blockSize: 16, bpp: 8 }
  if (dxgiFormat >= 79 && dxgiFormat <= 81) return { name: 'BC4', blockSize: 8, bpp: 4 }
  if (dxgiFormat >= 82 && dxgiFormat <= 84) return { name: 'BC5', blockSize: 16, bpp: 8 }
  if (dxgiFormat >= 94 && dxgiFormat <= 96) return { name: 'BC6H', blockSize: 16, bpp: 8 }
  if (dxgiFormat >= 97 && dxgiFormat <= 99) return { name: 'BC7', blockSize: 16, bpp: 8 }
  return null
}

function getUncompressedBpp(dxgiFormat: number): number {
  // Common uncompressed formats
  // RGBA32: 128bpp (formats 1-3)
  if (dxgiFormat >= 1 && dxgiFormat <= 3) return 128
  // RGBA16: 64bpp (formats 10-13)
  if (dxgiFormat >= 10 && dxgiFormat <= 13) return 64
  // RGBA8: 32bpp (formats 27-32)
  if (dxgiFormat >= 27 && dxgiFormat <= 32) return 32
  // RG32: 64bpp (formats 15-18)
  if (dxgiFormat >= 15 && dxgiFormat <= 18) return 64
  // RG16: 32bpp (formats 33-38)
  if (dxgiFormat >= 33 && dxgiFormat <= 38) return 32
  // RG8: 16bpp (formats 48-51)
  if (dxgiFormat >= 48 && dxgiFormat <= 51) return 16
  // R32: 32bpp (formats 39-43)
  if (dxgiFormat >= 39 && dxgiFormat <= 43) return 32
  // R16: 16bpp (formats 54-57)
  if (dxgiFormat >= 54 && dxgiFormat <= 57) return 16
  // R8: 8bpp (formats 61-63)
  if (dxgiFormat >= 61 && dxgiFormat <= 63) return 8
  // B8G8R8A8: 32bpp (formats 87-92)
  if (dxgiFormat >= 87 && dxgiFormat <= 92) return 32
  // Default fallback
  return 32
}

function isNormalMapFormat(dxgiFormat: number): boolean {
  return dxgiFormat >= 82 && dxgiFormat <= 84 // BC5
}

function hasAlphaChannel(dxgiFormat: number): boolean {
  // BC3 and BC7 have dedicated alpha channels
  return (dxgiFormat >= 76 && dxgiFormat <= 78) || (dxgiFormat >= 97 && dxgiFormat <= 99)
}

// ---------------------------------------------------------------------------
// Mip size calculation
// ---------------------------------------------------------------------------

function calcMipSize(width: number, height: number, dxgiFormat: number): number {
  const blockInfo = getBlockFormatInfo(dxgiFormat)
  if (blockInfo) {
    const blocksW = Math.max(1, Math.ceil(width / 4))
    const blocksH = Math.max(1, Math.ceil(height / 4))
    return blocksW * blocksH * blockInfo.blockSize
  }
  const bpp = getUncompressedBpp(dxgiFormat)
  return width * height * (bpp / 8)
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

// ---------------------------------------------------------------------------
// Alpha and color analysis (computed from rgbaPixels)
// ---------------------------------------------------------------------------

interface AlphaAnalysis {
  status: 'opaque' | 'transparent' | 'mixed'
  label: string
  warnUnusedAlpha: boolean
}

function analyzeAlpha(pixels: Uint8Array, dxgiFormat: number): AlphaAnalysis {
  if (!pixels || pixels.length < 4) {
    return { status: 'opaque', label: 'No data', warnUnusedAlpha: false }
  }

  let allOpaque = true
  let allTransparent = true
  const totalPixels = (pixels.length / 4) | 0
  const sampleCount = Math.min(totalPixels, 2048)
  const step = Math.max(1, (totalPixels / sampleCount) | 0)

  for (let p = 0; p < totalPixels; p += step) {
    const a = pixels[p * 4 + 3]
    if (a !== 255) allOpaque = false
    if (a !== 0) allTransparent = false
    if (!allOpaque && !allTransparent) break
  }

  let status: AlphaAnalysis['status']
  let label: string
  if (allOpaque) {
    status = 'opaque'
    label = 'Fully opaque'
  } else if (allTransparent) {
    status = 'transparent'
    label = 'Fully transparent'
  } else {
    status = 'mixed'
    label = 'Has transparency'
  }

  // Warn if BC3/BC7 alpha channel is unused (fully opaque)
  const warnUnusedAlpha = allOpaque && hasAlphaChannel(dxgiFormat)

  return { status, label, warnUnusedAlpha }
}

interface ColorRange {
  rMin: number; rMax: number
  gMin: number; gMax: number
  bMin: number; bMax: number
}

function analyzeColorRange(pixels: Uint8Array): ColorRange {
  const result: ColorRange = {
    rMin: 255, rMax: 0,
    gMin: 255, gMax: 0,
    bMin: 255, bMax: 0,
  }

  if (!pixels || pixels.length < 4) return result

  // Sample up to ~2048 pixels evenly distributed across the image
  const totalPixels = (pixels.length / 4) | 0
  const sampleCount = Math.min(totalPixels, 2048)
  const step = Math.max(1, (totalPixels / sampleCount) | 0)

  for (let p = 0; p < totalPixels; p += step) {
    const i = p * 4
    const r = pixels[i]
    const g = pixels[i + 1]
    const b = pixels[i + 2]
    if (r < result.rMin) result.rMin = r
    if (r > result.rMax) result.rMax = r
    if (g < result.gMin) result.gMin = g
    if (g > result.gMax) result.gMax = g
    if (b < result.bMin) result.bMin = b
    if (b > result.bMax) result.bMax = b
  }

  return result
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-xs uppercase tracking-wide text-gray-400 font-medium pt-3 pb-1.5 mb-1.5 border-b border-gray-700">
      {children}
    </div>
  )
}

function PropRow({ label, value, mono = true }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex justify-between items-start py-0.5">
      <span className="text-gray-400 text-xs shrink-0">{label}</span>
      <span className={`text-gray-200 text-xs text-right ml-2 ${mono ? 'font-mono' : ''}`}>
        {value}
      </span>
    </div>
  )
}

function Badge({ color, children }: { color: 'green' | 'blue' | 'purple' | 'yellow' | 'gray'; children: React.ReactNode }) {
  const colorClasses: Record<string, string> = {
    green: 'bg-green-800 text-green-200',
    blue: 'bg-blue-800 text-blue-200',
    purple: 'bg-purple-800 text-purple-200',
    yellow: 'bg-yellow-800 text-yellow-200',
    gray: 'bg-gray-700 text-gray-300',
  }
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs ${colorClasses[color]}`}>
      {children}
    </span>
  )
}

function ColorBar({ label, min, max, color }: { label: string; min: number; max: number; color: string }) {
  const leftPct = (min / 255) * 100
  const widthPct = Math.max(1, ((max - min) / 255) * 100)

  return (
    <div className="flex items-center gap-2 py-0.5">
      <span className="text-gray-400 text-xs w-3 font-mono">{label}</span>
      <div className="flex-1 h-2 bg-gray-800 rounded-sm relative overflow-hidden">
        <div
          className="absolute top-0 h-full rounded-sm"
          style={{
            left: `${leftPct}%`,
            width: `${widthPct}%`,
            backgroundColor: color,
            opacity: 0.7,
          }}
        />
      </div>
      <span className="text-gray-300 text-xs font-mono w-16 text-right">{min}-{max}</span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function DDSInfoPanel({ dds, currentMip, currentWidth, currentHeight, pixels }: DDSInfoPanelProps) {
  // Use explicit pixels prop (from DDSViewer's currentPixels state) when available,
  // falling back to dds.rgbaPixels. This ensures we analyze the same data the canvas displays.
  const pixelData = pixels ?? dds?.rgbaPixels ?? null

  // Compute analysis results (memoized for performance)
  const alphaAnalysis = useMemo(() => {
    if (!dds || !pixelData) return null
    return analyzeAlpha(pixelData, dds.dxgiFormat)
  }, [pixelData, dds?.dxgiFormat])

  const colorRange = useMemo(() => {
    if (!pixelData) return null
    return analyzeColorRange(pixelData)
  }, [pixelData])

  const mipTable = useMemo(() => {
    if (!dds) return []
    const rows: { level: number; width: number; height: number; size: number }[] = []
    for (let i = 0; i < dds.mips; i++) {
      const mw = Math.max(1, dds.width >> i)
      const mh = Math.max(1, dds.height >> i)
      rows.push({ level: i, width: mw, height: mh, size: calcMipSize(mw, mh, dds.dxgiFormat) })
    }
    return rows
  }, [dds?.width, dds?.height, dds?.mips, dds?.dxgiFormat])

  const totalDataSize = useMemo(() => {
    return mipTable.reduce((sum, row) => sum + row.size, 0)
  }, [mipTable])

  if (!dds) {
    return (
      <div className="w-64 bg-gray-900 border-l border-gray-700 p-3 text-gray-500 text-sm">
        <p>No DDS loaded</p>
      </div>
    )
  }

  const blockInfo = getBlockFormatInfo(dds.dxgiFormat)
  const isSrgb = SRGB_FORMATS.has(dds.dxgiFormat)
  const isNormal = isNormalMapFormat(dds.dxgiFormat)

  let compressionLabel: string
  if (blockInfo) {
    compressionLabel = `${blockInfo.name} (${blockInfo.bpp}bpp)`
  } else {
    const bpp = getUncompressedBpp(dds.dxgiFormat)
    compressionLabel = `Uncompressed (${bpp}bpp)`
  }

  return (
    <div className="w-64 bg-gray-900 border-l border-gray-700 overflow-y-auto h-full shrink-0">
      <div className="p-3">
        {/* ── File Info ── */}
        <SectionHeader>File Info</SectionHeader>
        <PropRow
          label="Filename"
          value={
            <span className="truncate max-w-[140px] block" title={dds.filename}>
              {dds.filename}
            </span>
          }
        />
        <PropRow label="File size" value={formatBytes(dds.fileSize)} />
        <PropRow label="Header" value={`${dds.headerSize} B`} />
        <div className="py-0.5">
          <span className="text-gray-400 text-xs block">Path</span>
          <span className="text-gray-300 text-xs font-mono break-all block mt-0.5 leading-relaxed">
            {dds.filepath}
          </span>
        </div>

        {/* ── Format Details ── */}
        <SectionHeader>Format Details</SectionHeader>
        <PropRow label="Format" value={dds.dxgiFormatName} />
        <PropRow label="DXGI ID" value={dds.dxgiFormat} />
        <div className="flex justify-between items-center py-0.5">
          <span className="text-gray-400 text-xs">Color space</span>
          {isSrgb ? <Badge color="green">sRGB</Badge> : <Badge color="blue">Linear</Badge>}
        </div>
        <PropRow label="Compression" value={compressionLabel} />
        {isNormal && (
          <div className="flex justify-between items-center py-0.5">
            <span className="text-gray-400 text-xs">Detected as</span>
            <Badge color="purple">Normal Map</Badge>
          </div>
        )}

        {/* ── Dimensions ── */}
        <SectionHeader>Dimensions</SectionHeader>
        <PropRow label="Original" value={`${dds.width} x ${dds.height}`} />
        <PropRow
          label="Current"
          value={`${currentWidth} x ${currentHeight} (mip ${currentMip})`}
        />

        {/* ── Mipmap Breakdown ── */}
        <SectionHeader>Mipmap Breakdown</SectionHeader>
        <table className="w-full text-xs font-mono">
          <thead>
            <tr className="text-gray-500">
              <th className="text-left font-normal py-0.5 pr-2">Lvl</th>
              <th className="text-left font-normal py-0.5 pr-2">Size</th>
              <th className="text-right font-normal py-0.5">Bytes</th>
            </tr>
          </thead>
          <tbody>
            {mipTable.map((row) => (
              <tr
                key={row.level}
                className={
                  row.level === currentMip
                    ? 'bg-blue-900/40 text-blue-200'
                    : 'text-gray-300'
                }
              >
                <td className="py-0.5 pr-2">{row.level}</td>
                <td className="py-0.5 pr-2">
                  {row.width}x{row.height}
                </td>
                <td className="py-0.5 text-right">{formatBytes(row.size)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-gray-700 text-gray-400">
              <td colSpan={2} className="py-1 text-xs">Total</td>
              <td className="py-1 text-right text-xs">{formatBytes(totalDataSize)}</td>
            </tr>
          </tfoot>
        </table>

        {/* ── Alpha Analysis ── */}
        <SectionHeader>Alpha Analysis</SectionHeader>
        {alphaAnalysis && (
          <>
            <div className="flex justify-between items-center py-0.5">
              <span className="text-gray-400 text-xs">Alpha</span>
              <Badge
                color={
                  alphaAnalysis.status === 'opaque' ? 'green'
                    : alphaAnalysis.status === 'transparent' ? 'gray'
                    : 'blue'
                }
              >
                {alphaAnalysis.label}
              </Badge>
            </div>
            {alphaAnalysis.warnUnusedAlpha && (
              <div className="mt-1.5 p-2 rounded bg-yellow-900/30 border border-yellow-800/50">
                <span className="text-yellow-300 text-xs leading-relaxed">
                  Alpha channel unused &mdash; BC1 would be more efficient
                </span>
              </div>
            )}
          </>
        )}

        {/* ── Color Range ── */}
        <SectionHeader>Color Range</SectionHeader>
        {colorRange && (
          <div className="space-y-0.5">
            <ColorBar label="R" min={colorRange.rMin} max={colorRange.rMax} color="#ef4444" />
            <ColorBar label="G" min={colorRange.gMin} max={colorRange.gMax} color="#22c55e" />
            <ColorBar label="B" min={colorRange.bMin} max={colorRange.bMax} color="#3b82f6" />
          </div>
        )}
      </div>
    </div>
  )
}
