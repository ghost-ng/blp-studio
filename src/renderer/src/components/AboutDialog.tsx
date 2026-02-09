import React, { useEffect, useRef } from 'react'

interface AboutDialogProps {
  open: boolean
  onClose: () => void
  version: string
}

const GITHUB_URL = 'https://github.com/ghost-ng/blp-studio'

export function AboutDialog({ open, onClose, version }: AboutDialogProps) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        ref={ref}
        className="bg-gray-800 border border-gray-600 rounded-lg shadow-xl w-[360px] p-6 text-center"
        onClick={e => e.stopPropagation()}
      >
        <div className="text-4xl mb-3">{'\u{1F3A8}'}</div>
        <h1 className="text-xl font-bold text-gray-100 mb-1">BLP Studio</h1>
        <p className="text-sm text-amber-400 mb-1">BETA</p>
        <p className="text-sm text-gray-400 mb-4">v{version}</p>

        <p className="text-sm text-gray-300 mb-4 leading-relaxed">
          Visual BLP asset editor for<br />
          Civilization VII modding
        </p>

        <div className="border-t border-gray-700 pt-4 mb-4">
          <p className="text-xs text-gray-500 mb-1">Created by</p>
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-blue-400 hover:text-blue-300 font-medium transition-colors"
            onClick={e => {
              e.preventDefault()
              window.open(GITHUB_URL, '_blank')
            }}
          >
            ghost_ng
          </a>
        </div>

        <div className="flex justify-center gap-2">
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-xs transition-colors text-gray-300"
            onClick={e => {
              e.preventDefault()
              window.open(GITHUB_URL, '_blank')
            }}
          >
            GitHub
          </a>
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-sm transition-colors text-gray-200"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
