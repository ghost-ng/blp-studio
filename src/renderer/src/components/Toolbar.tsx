import React, { useState, useRef, useEffect } from 'react'

interface ToolbarProps {
  onOpen: () => void
  onExtractAll: () => void
  onSave: () => void
  onExportAsMod: () => void
  onInstallToGame: () => void
  onRestoreBackups: () => void
  hasFile: boolean
  loading: boolean
  replacementCount?: number
  backupCount?: number
  gameDetected?: boolean
  theme?: 'dark' | 'light'
  onToggleTheme?: () => void
  onShowSettings?: () => void
  onShowAbout?: () => void
  experimentalEnabled?: boolean
}

function SaveDropdown({
  onInstallToGame,
  onExportAsMod,
  onSave,
  disabled,
  gameDetected,
}: {
  onInstallToGame: () => void
  onExportAsMod: () => void
  onSave: () => void
  disabled: boolean
  gameDetected: boolean
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        disabled={disabled}
        className="px-3 py-1.5 bg-green-700 hover:bg-green-600 disabled:bg-gray-800 disabled:text-gray-500 rounded text-sm font-medium transition-colors flex items-center gap-1"
      >
        Save
        <svg className="w-3 h-3 ml-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 bg-gray-700 border border-gray-600 rounded shadow-lg z-50 min-w-[220px]">
          <button
            onClick={() => { setOpen(false); onInstallToGame() }}
            disabled={!gameDetected}
            className="w-full text-left px-3 py-2 text-sm hover:bg-gray-600 disabled:text-gray-500 disabled:hover:bg-gray-700 transition-colors"
          >
            <div className="font-medium">Install to Game</div>
            <div className="text-xs text-gray-400 mt-0.5">
              {gameDetected ? 'Write CIVBIG files to SHARED_DATA' : 'Game not detected'}
            </div>
          </button>
          <div className="border-t border-gray-600" />
          <button
            onClick={() => { setOpen(false); onExportAsMod() }}
            className="w-full text-left px-3 py-2 text-sm hover:bg-gray-600 transition-colors"
          >
            <div className="font-medium">Export as Mod</div>
            <div className="text-xs text-gray-400 mt-0.5">Create .modinfo package for sharing</div>
          </button>
          <div className="border-t border-gray-600" />
          <button
            onClick={() => { setOpen(false); onSave() }}
            className="w-full text-left px-3 py-2 text-sm hover:bg-gray-600 transition-colors"
          >
            <div className="font-medium">Export CIVBIG Files</div>
            <div className="text-xs text-gray-400 mt-0.5">Save loose CIVBIG to a folder</div>
          </button>
        </div>
      )}
    </div>
  )
}

export function Toolbar({
  onOpen,
  onExtractAll,
  onSave,
  onExportAsMod,
  onInstallToGame,
  onRestoreBackups,
  hasFile,
  loading,
  replacementCount = 0,
  backupCount = 0,
  gameDetected = false,
  theme = 'dark',
  onToggleTheme,
  onShowSettings,
  onShowAbout,
  experimentalEnabled = false,
}: ToolbarProps) {
  return (
    <div className="h-12 bg-gray-800 border-b border-gray-700 flex items-center px-4 gap-3 shrink-0"
         style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}>
      <div className="flex items-center gap-3" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        <button
          onClick={onOpen}
          disabled={loading}
          className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-600 rounded text-sm font-medium transition-colors"
        >
          Open BLP
        </button>
        <button
          onClick={onExtractAll}
          disabled={!hasFile || loading}
          className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 disabled:text-gray-500 rounded text-sm font-medium transition-colors"
        >
          Extract All
        </button>
        {experimentalEnabled && (
          <SaveDropdown
            onInstallToGame={onInstallToGame}
            onExportAsMod={onExportAsMod}
            onSave={onSave}
            disabled={replacementCount === 0 || loading}
            gameDetected={gameDetected}
          />
        )}
        {backupCount > 0 && (
          <button
            onClick={onRestoreBackups}
            disabled={loading}
            className="px-3 py-1.5 bg-amber-700 hover:bg-amber-600 disabled:bg-gray-800 disabled:text-gray-500 rounded text-sm font-medium transition-colors"
          >
            Restore Backups ({backupCount})
          </button>
        )}
      </div>
      <div className="flex-1" />
      {replacementCount > 0 && (
        <span className="text-xs text-amber-400 mr-2">
          {replacementCount} asset{replacementCount > 1 ? 's' : ''} modified
        </span>
      )}
      <span className="text-sm font-semibold text-gray-300 cursor-pointer hover:text-gray-100 transition-colors"
            onClick={onShowAbout}
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            title="About BLP Studio"
      >BLP Studio</span>
      {onShowSettings && (
        <button
          onClick={onShowSettings}
          className="ml-1 p-1 rounded hover:bg-gray-700 transition-colors text-gray-400 hover:text-gray-200"
          title="Settings"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </button>
      )}
      {onToggleTheme && (
        <button
          onClick={onToggleTheme}
          className="ml-2 p-1 rounded hover:bg-gray-700 transition-colors text-gray-400 hover:text-gray-200"
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          {theme === 'dark' ? (
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
            </svg>
          ) : (
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
            </svg>
          )}
        </button>
      )}
    </div>
  )
}
