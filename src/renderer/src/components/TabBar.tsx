import React, { useState, useRef, useEffect, useCallback } from 'react'

export interface TabInfo {
  id: string
  filename: string
  hasModifications: boolean
}

interface TabBarProps {
  tabs: TabInfo[]
  activeTabId: string | null
  onSelectTab: (id: string) => void
  onCloseTab: (id: string) => void
  onNewTab?: () => void
  onRenameTab?: (id: string, newName: string) => void
}

export function TabBar({ tabs, activeTabId, onSelectTab, onCloseTab, onNewTab, onRenameTab }: TabBarProps) {
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; tabId: string } | null>(null)
  const [renamingTabId, setRenamingTabId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const menuRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Close context menu on outside click or Escape
  useEffect(() => {
    if (!contextMenu) return
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setContextMenu(null)
      }
    }
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setContextMenu(null)
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKey)
    }
  }, [contextMenu])

  // Focus input when entering rename mode
  useEffect(() => {
    if (renamingTabId && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [renamingTabId])

  const handleContextMenu = useCallback((e: React.MouseEvent, tabId: string) => {
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY, tabId })
  }, [])

  const startRename = useCallback((tabId: string) => {
    const tab = tabs.find(t => t.id === tabId)
    if (!tab) return
    setRenameValue(tab.filename)
    setRenamingTabId(tabId)
    setContextMenu(null)
  }, [tabs])

  const commitRename = useCallback(() => {
    if (renamingTabId && renameValue.trim() && onRenameTab) {
      onRenameTab(renamingTabId, renameValue.trim())
    }
    setRenamingTabId(null)
  }, [renamingTabId, renameValue, onRenameTab])

  const cancelRename = useCallback(() => {
    setRenamingTabId(null)
  }, [])

  if (tabs.length === 0) return null

  return (
    <div className="flex items-stretch bg-gray-800 border-b border-gray-700 text-sm overflow-x-auto shrink-0"
         style={{ minHeight: 32 }}>
      {tabs.map(tab => {
        const isActive = tab.id === activeTabId
        const isRenaming = tab.id === renamingTabId
        return (
          <div
            key={tab.id}
            className={`group flex items-center gap-1 px-3 py-1 cursor-pointer border-r border-gray-700 max-w-[200px] transition-colors ${
              isActive
                ? 'bg-gray-900 text-gray-100 border-b-2 border-b-blue-500'
                : 'text-gray-400 hover:text-gray-200 hover:bg-gray-750'
            }`}
            style={{ minWidth: 100 }}
            onClick={() => !isRenaming && onSelectTab(tab.id)}
            onContextMenu={(e) => handleContextMenu(e, tab.id)}
            onDoubleClick={() => onRenameTab && startRename(tab.id)}
            title={!isRenaming ? tab.filename : undefined}
          >
            {tab.hasModifications && (
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
            )}
            {isRenaming ? (
              <input
                ref={inputRef}
                value={renameValue}
                onChange={e => setRenameValue(e.target.value)}
                onBlur={commitRename}
                onKeyDown={e => {
                  if (e.key === 'Enter') commitRename()
                  if (e.key === 'Escape') cancelRename()
                }}
                className="flex-1 min-w-0 bg-gray-700 border border-blue-500 rounded px-1 py-0 text-xs text-gray-100 outline-none"
                onClick={e => e.stopPropagation()}
              />
            ) : (
              <span className="truncate text-xs">{tab.filename}</span>
            )}
            <button
              onClick={(e) => { e.stopPropagation(); onCloseTab(tab.id) }}
              className="ml-1 shrink-0 rounded p-0.5 text-gray-600 hover:text-gray-200 hover:bg-gray-600 transition-all"
              title="Close tab"
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        )
      })}
      {onNewTab && (
        <button
          onClick={onNewTab}
          className="shrink-0 px-2 py-1 flex items-center text-gray-500 hover:text-gray-200 hover:bg-gray-750 transition-colors"
          title="New tab"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
        </button>
      )}

      {/* Context menu */}
      {contextMenu && (
        <div
          ref={menuRef}
          className="fixed bg-gray-700 border border-gray-600 rounded shadow-lg z-[100] min-w-[120px] py-1 text-sm"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          {onRenameTab && (
            <button
              className="w-full text-left px-3 py-1.5 text-gray-200 hover:bg-gray-600 transition-colors"
              onClick={() => startRename(contextMenu.tabId)}
            >
              Rename
            </button>
          )}
          <button
            className="w-full text-left px-3 py-1.5 text-gray-200 hover:bg-gray-600 transition-colors"
            onClick={() => { onCloseTab(contextMenu.tabId); setContextMenu(null) }}
          >
            Close
          </button>
        </div>
      )}
    </div>
  )
}
