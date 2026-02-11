import React, { useState, useRef, useEffect } from 'react'

interface BLPManifest {
  filename: string
  filepath: string
  header: {
    magic: string
    version: number
    packageDataOffset: number
    bigDataOffset: number
    bigDataCount: number
    fileSize: number
  }
  assets: AssetEntry[]
  typeCounts: Record<string, number>
  sharedDataCount: number
  oodleLoaded: boolean
}

interface AssetEntry {
  name: string
  type: 'texture' | 'blob' | 'gpu' | 'sound'
  metadata: Record<string, unknown>
}

interface ProgressInfo {
  current: number
  total: number
  name: string
}

interface StatusBarProps {
  message: string
  manifest: BLPManifest | null
  progress?: ProgressInfo | null
  sharedDataPaths?: string[]
  onOpenFolder?: (path: string) => void
}

export function StatusBar({ message, manifest, progress, sharedDataPaths = [], onOpenFolder }: StatusBarProps) {
  const pct = progress ? Math.round((progress.current / progress.total) * 100) : 0
  const [showFolders, setShowFolders] = useState(false)
  const popupRef = useRef<HTMLDivElement>(null)

  // Close popup on outside click
  useEffect(() => {
    if (!showFolders) return
    const handler = (e: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
        setShowFolders(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showFolders])

  const hasSharedData = manifest && manifest.sharedDataCount > 0

  return (
    <div className="h-7 bg-gray-800 border-t border-gray-700 flex items-center px-3 text-xs text-gray-400 shrink-0 relative">
      {/* Progress bar background */}
      {progress && pct > 0 && (
        <div
          className="absolute left-0 top-0 h-full bg-blue-600/25 transition-all duration-150"
          style={{ width: `${pct}%` }}
        />
      )}
      {/* Indeterminate loading animation when progress=0 */}
      {progress && pct === 0 && (
        <div className="absolute left-0 top-0 h-full w-full overflow-hidden">
          <div className="h-full w-1/3 bg-blue-500/20 animate-pulse" style={{
            animation: 'statusbar-slide 1.5s ease-in-out infinite',
          }} />
        </div>
      )}

      {/* Content (on top of progress bar) */}
      <div className="flex items-center w-full relative z-10">
        {progress ? (
          <span className="truncate flex-1 text-blue-300">
            {progress.total > 1 ? `${progress.current}/${progress.total} (${pct}%) ` : ''}{progress.name}
          </span>
        ) : (
          <span className="truncate flex-1">{message}</span>
        )}
        {manifest && (
          <div className="flex items-center gap-3 ml-4">
            <span>{manifest.filename}</span>
            <span>{manifest.assets.length} assets</span>
            <span className={manifest.oodleLoaded ? 'text-green-400' : 'text-yellow-400'}>
              Oodle: {manifest.oodleLoaded ? 'OK' : 'N/A'}
            </span>
            <div className="relative" ref={popupRef}>
              <span
                className={`${hasSharedData ? 'text-green-400 hover:text-green-300 cursor-pointer underline decoration-dotted' : 'text-yellow-400'}`}
                onClick={() => {
                  if (hasSharedData && sharedDataPaths.length > 0) {
                    if (sharedDataPaths.length === 1 && onOpenFolder) {
                      onOpenFolder(sharedDataPaths[0])
                    } else {
                      setShowFolders(!showFolders)
                    }
                  }
                }}
                title={hasSharedData ? 'Click to open SHARED_DATA folders' : undefined}
              >
                SHARED_DATA: {hasSharedData ? `${manifest.sharedDataCount} files` : 'N/A'}
              </span>
              {/* Folder popup */}
              {showFolders && sharedDataPaths.length > 1 && (
                <div className="absolute bottom-7 right-0 bg-gray-900 border border-gray-600 rounded shadow-xl max-h-64 overflow-y-auto min-w-[320px] z-50">
                  <div className="px-3 py-1.5 text-gray-400 border-b border-gray-700 font-medium">
                    SHARED_DATA folders ({sharedDataPaths.length})
                  </div>
                  {sharedDataPaths.map((p, i) => (
                    <div
                      key={i}
                      className="px-3 py-1 hover:bg-gray-700 cursor-pointer text-gray-300 truncate"
                      onClick={() => {
                        onOpenFolder?.(p)
                        setShowFolders(false)
                      }}
                      title={p}
                    >
                      {p}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
