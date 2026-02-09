import React, { useState, useEffect, useCallback } from 'react'

export interface BatchDDSDialogProps {
  open: boolean
  onClose: () => void
  onNotify: (type: 'success' | 'error', title: string, message?: string) => void
}

interface BatchProgress {
  current: number
  total: number
  name: string
}

interface BatchResult {
  success: number
  failed: number
  errors: string[]
}

type OutputFormat = 'png' | 'jpg'

export function BatchDDSDialog({ open, onClose, onNotify }: BatchDDSDialogProps) {
  const [sourceDir, setSourceDir] = useState<string | null>(null)
  const [outputDir, setOutputDir] = useState<string | null>(null)
  const [format, setFormat] = useState<OutputFormat>('png')
  const [quality, setQuality] = useState(90)
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<BatchProgress | null>(null)
  const [result, setResult] = useState<BatchResult | null>(null)

  // Listen to progress events from main process
  useEffect(() => {
    if (!open) return
    const cleanup = window.electronAPI.onProgress((info) => {
      if (info) {
        setProgress({ current: info.current, total: info.total, name: info.name })
      } else {
        setProgress(null)
      }
    })
    return cleanup
  }, [open])

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      setRunning(false)
      setProgress(null)
      setResult(null)
    }
  }, [open])

  const handleSelectSource = useCallback(async () => {
    const dir = await window.electronAPI.selectDirectory()
    if (dir) setSourceDir(dir)
  }, [])

  const handleSelectOutput = useCallback(async () => {
    const dir = await window.electronAPI.selectDirectory()
    if (dir) setOutputDir(dir)
  }, [])

  const handleConvert = useCallback(async () => {
    if (!sourceDir || !outputDir) return

    setRunning(true)
    setResult(null)
    setProgress(null)

    try {
      const res = await window.electronAPI.batchExportDds(
        sourceDir,
        outputDir,
        format,
        format === 'jpg' ? quality : undefined
      ) as BatchResult
      setResult(res)
      if (res.failed === 0) {
        onNotify('success', 'Batch export complete', `${res.success} file${res.success !== 1 ? 's' : ''} converted`)
      } else {
        onNotify('error', 'Batch export finished with errors', `${res.success} succeeded, ${res.failed} failed`)
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      onNotify('error', 'Batch export failed', msg)
      setResult({ success: 0, failed: 0, errors: [msg] })
    } finally {
      setRunning(false)
      setProgress(null)
    }
  }, [sourceDir, outputDir, format, quality, onNotify])

  if (!open) return null

  const canConvert = sourceDir && outputDir && !running
  const pct = progress && progress.total > 0
    ? Math.round((progress.current / progress.total) * 100)
    : 0

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/80 backdrop-blur-sm">
      <div className="bg-gray-800 border border-gray-700 rounded-lg shadow-2xl w-full max-w-lg mx-4">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-700">
          <h2 className="text-sm font-semibold text-gray-100">Batch DDS Export</h2>
          <button
            onClick={onClose}
            disabled={running}
            className="text-gray-400 hover:text-gray-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-4">
          {/* Source folder */}
          <div>
            <label className="block text-xs text-gray-400 mb-1">Source Folder (DDS files)</label>
            <div className="flex items-center gap-2">
              <button
                onClick={handleSelectSource}
                disabled={running}
                className="shrink-0 px-3 py-1.5 text-xs bg-gray-700 hover:bg-gray-600 disabled:opacity-40 disabled:cursor-not-allowed rounded border border-gray-600 text-gray-200 transition-colors"
              >
                Browse...
              </button>
              <span className="text-xs text-gray-300 truncate min-w-0" title={sourceDir || ''}>
                {sourceDir || 'No folder selected'}
              </span>
            </div>
          </div>

          {/* Output folder */}
          <div>
            <label className="block text-xs text-gray-400 mb-1">Output Folder</label>
            <div className="flex items-center gap-2">
              <button
                onClick={handleSelectOutput}
                disabled={running}
                className="shrink-0 px-3 py-1.5 text-xs bg-gray-700 hover:bg-gray-600 disabled:opacity-40 disabled:cursor-not-allowed rounded border border-gray-600 text-gray-200 transition-colors"
              >
                Browse...
              </button>
              <span className="text-xs text-gray-300 truncate min-w-0" title={outputDir || ''}>
                {outputDir || 'No folder selected'}
              </span>
            </div>
          </div>

          {/* Format selector */}
          <div>
            <label className="block text-xs text-gray-400 mb-1.5">Output Format</label>
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="radio"
                  name="batch-format"
                  value="png"
                  checked={format === 'png'}
                  onChange={() => setFormat('png')}
                  disabled={running}
                  className="accent-blue-500"
                />
                <span className="text-sm text-gray-200">PNG</span>
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="radio"
                  name="batch-format"
                  value="jpg"
                  checked={format === 'jpg'}
                  onChange={() => setFormat('jpg')}
                  disabled={running}
                  className="accent-blue-500"
                />
                <span className="text-sm text-gray-200">JPG</span>
              </label>
            </div>
          </div>

          {/* JPG Quality slider */}
          {format === 'jpg' && (
            <div>
              <label className="block text-xs text-gray-400 mb-1">
                JPG Quality: <span className="text-gray-200 font-medium">{quality}</span>
              </label>
              <input
                type="range"
                min={10}
                max={100}
                step={1}
                value={quality}
                onChange={(e) => setQuality(Number(e.target.value))}
                disabled={running}
                className="w-full h-1.5 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-blue-500 disabled:opacity-40"
              />
              <div className="flex justify-between text-xs text-gray-500 mt-0.5">
                <span>10</span>
                <span>100</span>
              </div>
            </div>
          )}

          {/* Progress display */}
          {running && progress && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-gray-300 truncate max-w-[280px]" title={progress.name}>
                  {progress.name}
                </span>
                <span className="text-gray-400 shrink-0 ml-2">
                  {progress.current} / {progress.total}
                </span>
              </div>
              <div className="w-full bg-gray-700 rounded-full h-2 overflow-hidden">
                <div
                  className="bg-blue-500 h-full rounded-full transition-all duration-150"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <div className="text-xs text-gray-500 text-right">{pct}%</div>
            </div>
          )}

          {/* Running without progress yet */}
          {running && !progress && (
            <div className="text-xs text-gray-400 animate-pulse">Scanning DDS files...</div>
          )}

          {/* Results summary */}
          {result && !running && (
            <div className="rounded border border-gray-700 bg-gray-900/50 px-3 py-2.5 space-y-1">
              <div className="text-sm text-gray-200 font-medium">Conversion Complete</div>
              <div className="flex items-center gap-4 text-xs">
                <span className="text-green-400">{result.success} succeeded</span>
                {result.failed > 0 && (
                  <span className="text-red-400">{result.failed} failed</span>
                )}
              </div>
              {result.errors.length > 0 && (
                <div className="mt-1.5 max-h-24 overflow-y-auto">
                  {result.errors.map((err, i) => (
                    <div key={i} className="text-xs text-red-300/80 truncate" title={err}>
                      {err}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-gray-700">
          <button
            onClick={onClose}
            disabled={running}
            className="px-3 py-1.5 text-xs bg-gray-700 hover:bg-gray-600 disabled:opacity-40 disabled:cursor-not-allowed rounded border border-gray-600 text-gray-200 transition-colors"
          >
            {running ? 'Cancel' : 'Close'}
          </button>
          <button
            onClick={handleConvert}
            disabled={!canConvert}
            className="px-4 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 disabled:bg-blue-600/40 disabled:cursor-not-allowed rounded text-white font-medium transition-colors"
          >
            {running ? 'Converting...' : 'Convert'}
          </button>
        </div>
      </div>
    </div>
  )
}
