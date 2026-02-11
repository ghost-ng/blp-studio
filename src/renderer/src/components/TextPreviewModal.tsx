import React, { useState, useRef, useEffect, useCallback } from 'react'

interface TextPreviewModalProps {
  title: string
  text: string
  language: 'json' | 'xml'
  defaultFilename: string
  filterName: string
  filterExt: string
  onClose: () => void
  onNotify: (type: 'success' | 'error', title: string, message?: string) => void
}

export function TextPreviewModal({ title, text, language, defaultFilename, filterName, filterExt, onClose, onNotify }: TextPreviewModalProps) {
  const [search, setSearch] = useState('')
  const [matchIndex, setMatchIndex] = useState(0)
  const [matches, setMatches] = useState<number[]>([])
  const [copied, setCopied] = useState(false)
  const contentRef = useRef<HTMLPreElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  // Focus search on Ctrl+F
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return }
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault()
        searchRef.current?.focus()
        searchRef.current?.select()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  // Compute match positions when search changes
  useEffect(() => {
    if (!search || search.length < 2) { setMatches([]); setMatchIndex(0); return }
    const lower = text.toLowerCase()
    const needle = search.toLowerCase()
    const found: number[] = []
    let pos = 0
    while ((pos = lower.indexOf(needle, pos)) !== -1) {
      found.push(pos)
      pos += 1
    }
    setMatches(found)
    setMatchIndex(0)
  }, [search, text])

  // Scroll to current match
  useEffect(() => {
    if (matches.length === 0 || !contentRef.current) return
    const mark = contentRef.current.querySelector(`[data-match="${matchIndex}"]`)
    if (mark) mark.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [matchIndex, matches])

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [text])

  const handleSave = useCallback(async () => {
    try {
      const result = await window.electronAPI.saveTextFile(text, defaultFilename, filterName, filterExt)
      if (result) {
        onNotify('success', `${filterName} saved`, `${(result.size / 1024).toFixed(1)} KB`)
      }
    } catch (e) {
      onNotify('error', 'Save failed', String(e))
    }
  }, [text, defaultFilename, filterName, filterExt, onNotify])

  const nextMatch = () => setMatchIndex(i => (i + 1) % Math.max(matches.length, 1))
  const prevMatch = () => setMatchIndex(i => (i - 1 + matches.length) % Math.max(matches.length, 1))

  // Render text with search highlights
  const renderHighlighted = () => {
    if (!search || search.length < 2 || matches.length === 0) return text

    const parts: React.ReactNode[] = []
    let lastEnd = 0
    const needleLen = search.length

    matches.forEach((pos, idx) => {
      if (pos > lastEnd) parts.push(text.slice(lastEnd, pos))
      parts.push(
        <mark
          key={idx}
          data-match={idx}
          className={idx === matchIndex ? 'bg-yellow-400 text-gray-900' : 'bg-yellow-700/50 text-gray-100'}
        >
          {text.slice(pos, pos + needleLen)}
        </mark>
      )
      lastEnd = pos + needleLen
    })
    if (lastEnd < text.length) parts.push(text.slice(lastEnd))
    return parts
  }

  const lines = text.split('\n').length

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="bg-gray-900 border border-gray-700 rounded-lg shadow-2xl flex flex-col"
        style={{ width: '80vw', maxWidth: 900, height: '80vh' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2 border-b border-gray-700">
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm">{title}</span>
            <span className="text-xs text-gray-500">{lines} lines</span>
            <span className="text-xs text-gray-600 font-mono">{language.toUpperCase()}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={handleCopy}
              className="px-2.5 py-1 bg-gray-700 hover:bg-gray-600 rounded text-xs transition-colors"
            >
              {copied ? 'Copied!' : 'Copy All'}
            </button>
            <button
              onClick={handleSave}
              className="px-2.5 py-1 bg-gray-700 hover:bg-gray-600 rounded text-xs transition-colors"
            >
              Save...
            </button>
            <button
              onClick={onClose}
              className="px-2 py-1 hover:bg-gray-700 rounded text-gray-400 hover:text-gray-200 text-sm transition-colors"
            >
              &#x2715;
            </button>
          </div>
        </div>

        {/* Search bar */}
        <div className="flex items-center gap-2 px-4 py-1.5 border-b border-gray-800 bg-gray-850">
          <input
            ref={searchRef}
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.shiftKey ? prevMatch() : nextMatch() }
              if (e.key === 'Escape') { setSearch(''); searchRef.current?.blur() }
            }}
            placeholder="Search... (Ctrl+F)"
            className="flex-1 bg-gray-800 border border-gray-600 rounded px-2 py-0.5 text-xs text-gray-200 placeholder-gray-500 outline-none focus:border-blue-500"
          />
          {search.length >= 2 && (
            <>
              <span className="text-xs text-gray-500">
                {matches.length > 0 ? `${matchIndex + 1}/${matches.length}` : 'No matches'}
              </span>
              <button onClick={prevMatch} disabled={matches.length === 0} className="text-xs text-gray-400 hover:text-gray-200 disabled:text-gray-600 px-1">&uarr;</button>
              <button onClick={nextMatch} disabled={matches.length === 0} className="text-xs text-gray-400 hover:text-gray-200 disabled:text-gray-600 px-1">&darr;</button>
            </>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto">
          <pre
            ref={contentRef}
            className="p-4 text-xs font-mono text-gray-300 whitespace-pre leading-relaxed select-text"
          >
            {renderHighlighted()}
          </pre>
        </div>
      </div>
    </div>
  )
}
