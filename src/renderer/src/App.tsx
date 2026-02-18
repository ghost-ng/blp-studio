import React, { useState, useCallback, useEffect, useRef, DragEvent } from 'react'
import { Toolbar } from './components/Toolbar'
import { AssetTree } from './components/AssetTree'
import { PreviewPanel } from './components/PreviewPanel'
import { PropertiesPanel } from './components/PropertiesPanel'
import { StatusBar } from './components/StatusBar'
import { Notification, NotificationData } from './components/Notification'
import { DDSViewer, DDSData } from './components/DDSViewer'
import { DDSCompare } from './components/DDSCompare'
import { BatchDDSDialog } from './components/BatchDDSDialog'
import { AboutDialog } from './components/AboutDialog'
import { SettingsDialog, SettingsData } from './components/SettingsDialog'
import { ResizeHandle } from './components/ResizeHandle'
import { TabBar } from './components/TabBar'
import { TextPreviewModal } from './components/TextPreviewModal'

// Type declarations for the preload API
interface AssetEntry {
  name: string
  type: 'texture' | 'blob' | 'gpu' | 'sound'
  metadata: Record<string, unknown>
}

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

interface TexturePreview {
  name: string
  width: number
  height: number
  mips: number
  dxgiFormat: number
  dxgiFormatName: string
  rgbaPixels?: Uint8Array | null  // populated renderer-side via blp-preview:// protocol fetch
  bitmap?: ImageBitmap | null     // GPU-resident texture for instant display (off V8 heap)
  tooLarge?: boolean
}

export interface AssetData {
  data: Uint8Array
  totalSize: number
  truncated: boolean
  blobType: number
  typeFlags: number
}

export interface ProgressInfo {
  current: number
  total: number
  name: string
}

declare global {
  interface Window {
    electronAPI: {
      openBLP: (filepath?: string) => Promise<BLPManifest | null>
      getAssetData: (name: string) => Promise<AssetData | null>
      getTexturePreview: (name: string) => Promise<TexturePreview | null>
      extractAsset: (name: string, outputPath: string) => Promise<boolean>
      extractAll: (outputDir: string, assetType: string) => Promise<{ success: number; failed: number; skipped: number }>
      replaceAsset: (name: string) => Promise<{ name: string; size: number; sourcePath: string; ddsInfo?: { width: number; height: number; format: number; mips: number; formatName: string } } | null>
      clearReplacement: (name: string) => Promise<boolean>
      getReplacements: () => Promise<{ name: string; size: number }[]>
      saveReplacements: (outputDir?: string) => Promise<{ success: number; failed: number }>
      installToGame: () => Promise<{ success: number; failed: number; errors: string[] }>
      exportAsMod: () => Promise<{ success: number; failed: number; modDir?: string; modId?: string }>
      restoreBackups: () => Promise<{ restored: number; failed: number }>
      getBackupCount: () => Promise<number>
      selectFile: (filters: { name: string; extensions: string[] }[]) => Promise<string | null>
      selectDirectory: () => Promise<string | null>
      getStatus: () => Promise<{ oodleLoaded: boolean; sharedDataDirs: number; sharedDataFiles: number; sharedDataPaths: string[]; gameRoot: string | null; gameDetected: boolean; replacementCount: number }>
      openFolder: (folderPath: string) => Promise<void>
      onProgress: (callback: (info: ProgressInfo | null) => void) => () => void
      getPreferences: () => Promise<{ theme: 'dark' | 'light'; recentFiles: string[]; defaultExportFormat: 'png' | 'jpg'; jpgQuality: number; ddsDefaultBackground: 'checkerboard' | 'black' | 'white'; compressionMode: 'auto' | 'always' | 'never'; experimentalFeatures: boolean }>
      setTheme: (theme: 'dark' | 'light') => Promise<void>
      updatePreferences: (prefs: Record<string, unknown>) => Promise<void>
      getVersion: () => Promise<string>
      onMenuOpen: (callback: () => void) => () => void
      onMenuOpenFile: (callback: (filepath: string) => void) => () => void
      onMenuToggleTheme: (callback: () => void) => () => void
      onMenuOpenDds: (callback: () => void) => () => void
      onMenuShowSettings: (callback: () => void) => () => void
      onMenuShowAbout: (callback: () => void) => () => void
      openDDS: (filepath?: string) => Promise<unknown>
      getDdsMip: (filepath: string, mipLevel: number) => Promise<unknown>
      exportDds: (rgbaPixels: Uint8Array, width: number, height: number, format: string, quality?: number) => Promise<unknown>
      batchExportDds: (sourceDir: string, outputDir: string, format: string, quality?: number) => Promise<{ success: number; failed: number; errors: string[] }>
      openDdsWindow: (filepath: string) => Promise<void>
      extractTempDds: (name: string) => Promise<string | null>
      exportTextureAsImage: (name: string, format: string, quality?: number) => Promise<{ filepath: string; size: number } | { error: string } | null>
      copyPreviewAsPng: (rgbaPixels: Uint8Array, width: number, height: number) => Promise<boolean>
      exportManifest: (manifestJson: string, defaultFilename: string) => Promise<{ filepath: string; size: number } | null>
      exportDep: (modId: string, defaultFilename: string) => Promise<{ filepath: string; size: number } | null>
      getDepText: (modId: string) => Promise<string | null>
      getModinfoText: (modId: string, modName: string) => Promise<string | null>
      saveTextFile: (text: string, defaultFilename: string, filterName: string, filterExt: string) => Promise<{ filepath: string; size: number } | null>
      parseWwiseBank: (name: string) => Promise<{ bankVersion: number; bankId: number; embeddedFiles: { id: number; size: number }[] } | null>
      extractWwiseAudio: (name: string, fileId: number) => Promise<{ data: Uint8Array; id: number } | null>
      extractAllWwiseAudio: (name: string, outputDir: string) => Promise<{ success: number; failed: number }>
      extractBlobsByType: (blobType: number, outputDir: string) => Promise<{ success: number; failed: number }>
      decodeWwiseAudio: (audioData: Uint8Array) => Promise<Uint8Array | null>
      exportTexturesBatch: (names: string[], outputDir: string, format: string, quality?: number) => Promise<{ success: number; failed: number }>
      getThumbnails: (names: string[]) => Promise<Record<string, { width: number; height: number; rgbaPixels: Uint8Array }>>
      closeCache: (filepath: string) => Promise<void>
      logTiming: (msg: string) => Promise<void>
      onPreloadProgress: (callback: (info: { current: number; total: number }) => void) => () => void
      onDdsLoadFile: (callback: (filepath: string) => void) => () => void
      parseModel: (blpPath: string) => Promise<{
        meshes: { positions: number[]; indices: number[]; normals: number[] | null; uvs: number[] | null; boneIndices: number[] | null; boneWeights: number[] | null; vertexCount: number; triangleCount: number; materialHash: number; materialName: string }[]
        componentCount: number
        skeletons: { hash: number; deformerStart: number; deformerCount: number }[]
        deformers: { nameHash: number; transformIndex: number; parent: number; inverseBind: { position: number[]; scale: number; rotation: number[] } }[]
        skeletonBlobName: string | null
      } | null>
      loadModelTextures: (blpPath: string, materialNames: string[]) => Promise<Record<string, { diffuse?: string; normal?: string; orm?: string }> | null>
      parseSkeleton: (name: string) => Promise<{ boneCount: number; bones: { index: number; name: string; parentIndex: number; localPosition: number[]; localRotation: number[]; worldPosition: number[]; worldRotation: number[] }[] } | null>
      parseAnimation: (name: string) => Promise<{ fps: number; frameCount: number; boneCount: number; duration: number; name: string; isV0: boolean; isWorldSpace: boolean; keyframes: { rotation: number[]; position: number[]; scale: number[] }[][] | null } | null>
      listAnimations: (boneCount: number) => Promise<{ name: string; size: number }[]>
      listSkeletons: () => Promise<{ name: string; size: number }[]>
    }
  }
}

interface TabState {
  id: string
  filepath: string
  filename: string
  manifest: BLPManifest | null
  selectedAsset: AssetEntry | null
  selectedAssets: Set<string>
  preview: TexturePreview | null
  assetData: AssetData | null
  replacedAssets: Set<string>
  statusMessage: string
}

// Module-level texture preview cache — avoids re-fetching 16MB RGBA over protocol
// Keyed by asset name. Cleared when a new BLP is opened (different asset set).
const rendererTextureCache = new Map<string, TexturePreview>()

function sanitizeModId(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'blp-studio-mod'
}

type DdsViewMode = 'viewer' | 'compare'

export default function App() {
  const [manifest, setManifest] = useState<BLPManifest | null>(null)
  const [selectedAsset, setSelectedAsset] = useState<AssetEntry | null>(null)
  const [selectedAssets, setSelectedAssets] = useState<Set<string>>(new Set())
  const [preview, setPreview] = useState<TexturePreview | null>(null)
  const [assetData, setAssetData] = useState<AssetData | null>(null)
  const [loading, setLoading] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [replacedAssets, setReplacedAssets] = useState<Set<string>>(new Set())
  const [statusMessage, setStatusMessage] = useState<string>('Ready. Open a BLP file to begin.')
  const [progress, setProgress] = useState<ProgressInfo | null>(null)
  const [sharedDataPaths, setSharedDataPaths] = useState<string[]>([])
  const [backupCount, setBackupCount] = useState(0)
  const [gameDetected, setGameDetected] = useState(false)
  const [notification, setNotification] = useState<NotificationData | null>(null)
  const [ddsData, setDdsData] = useState<DDSData | null>(null)
  const [ddsViewMode, setDdsViewMode] = useState<DdsViewMode>('viewer')
  const [showBatchDialog, setShowBatchDialog] = useState(false)
  const [isDdsOnlyWindow, setIsDdsOnlyWindow] = useState(false)
  const [modelViewerActive, setModelViewerActive] = useState(false)
  const [modelData, setModelData] = useState<{
    meshes: { positions: number[]; indices: number[]; normals: number[] | null; uvs: number[] | null; boneIndices: number[] | null; boneWeights: number[] | null; vertexCount: number; triangleCount: number; materialHash: number; materialName: string }[]
    componentCount: number
    skeletons: { hash: number; deformerStart: number; deformerCount: number }[]
    deformers: { nameHash: number; transformIndex: number; parent: number; inverseBind: { position: number[]; scale: number; rotation: number[] } }[]
    skeletonBlobName: string | null
  } | null>(null)
  const [materialMap, setMaterialMap] = useState<Record<string, { diffuse?: string; normal?: string; orm?: string }> | null>(null)
  const [showAbout, setShowAbout] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [textPreview, setTextPreview] = useState<{ title: string; text: string; language: 'json' | 'xml'; defaultFilename: string; filterName: string; filterExt: string } | null>(null)
  const [appVersion, setAppVersion] = useState('1.0.0')
  const [settingsData, setSettingsData] = useState<SettingsData>({
    theme: 'dark',
    defaultExportFormat: 'png',
    jpgQuality: 90,
    ddsDefaultBackground: 'checkerboard',
    compressionMode: 'auto',
    experimentalFeatures: false,
  })

  // Keep ref to settings for use in callbacks without dep changes
  const settingsRef = useRef(settingsData)
  settingsRef.current = settingsData

  // Resizable panel widths
  const [leftPanelWidth, setLeftPanelWidth] = useState(288)   // asset tree (w-72 = 288px)
  const [rightPanelWidth, setRightPanelWidth] = useState(288) // properties panel

  // Multi-tab state
  const [tabs, setTabs] = useState<TabState[]>([])
  const [activeTabId, setActiveTabId] = useState<string | null>(null)
  const tabsRef = useRef<TabState[]>([])
  tabsRef.current = tabs
  const switchingRef = useRef(false) // guard against concurrent tab switches
  const currentTabStateRef = useRef<{
    manifest: BLPManifest | null; selectedAsset: AssetEntry | null; selectedAssets: Set<string>;
    preview: TexturePreview | null; assetData: AssetData | null; replacedAssets: Set<string>; statusMessage: string
  }>({ manifest: null, selectedAsset: null, selectedAssets: new Set(), preview: null, assetData: null, replacedAssets: new Set(), statusMessage: '' })
  // Keep ref in sync with current flat state for tab save/restore
  currentTabStateRef.current = { manifest, selectedAsset, selectedAssets, preview, assetData, replacedAssets, statusMessage }

  const notify = useCallback((type: NotificationData['type'], title: string, message?: string) => {
    setNotification({ type, title, message })
  }, [])

  const [theme, setThemeState] = useState<'dark' | 'light'>('dark')

  // Load saved preferences and app version on mount
  useEffect(() => {
    window.electronAPI.getPreferences().then(prefs => {
      setThemeState(prefs.theme)
      document.documentElement.className = prefs.theme === 'light' ? 'light' : ''
      setSettingsData({
        theme: prefs.theme,
        defaultExportFormat: prefs.defaultExportFormat || 'png',
        jpgQuality: prefs.jpgQuality || 90,
        ddsDefaultBackground: prefs.ddsDefaultBackground || 'checkerboard',
        compressionMode: prefs.compressionMode || 'auto',
        experimentalFeatures: prefs.experimentalFeatures === true,
      })
    })
    window.electronAPI.getVersion().then(v => setAppVersion(v))
  }, [])

  // Listen for DDS load from new-window IPC (DDS-only window mode)
  useEffect(() => {
    const cleanup = window.electronAPI.onDdsLoadFile(async (filepath) => {
      setIsDdsOnlyWindow(true)
      try {
        const result = await window.electronAPI.openDDS(filepath) as DDSData | { error: string } | null
        if (!result) return
        if ('error' in result) {
          notify('error', 'Failed to open DDS', result.error)
          return
        }
        setDdsData(result)
        setDdsViewMode('viewer')
      } catch (e) {
        notify('error', 'Failed to open DDS', String(e))
      }
    })
    return cleanup
  }, [notify])


  const toggleTheme = useCallback(() => {
    setThemeState(prev => {
      const next = prev === 'dark' ? 'light' : 'dark'
      document.documentElement.className = next === 'light' ? 'light' : ''
      window.electronAPI.setTheme(next)
      setSettingsData(s => ({ ...s, theme: next }))
      return next
    })
  }, [])

  const handleSaveSettings = useCallback((newSettings: SettingsData) => {
    setSettingsData(newSettings)
    // Apply theme change immediately
    if (newSettings.theme !== theme) {
      setThemeState(newSettings.theme)
      document.documentElement.className = newSettings.theme === 'light' ? 'light' : ''
    }
    // Persist all settings
    window.electronAPI.updatePreferences(newSettings)
  }, [theme])

  const handleResizeLeft = useCallback((delta: number) => {
    setLeftPanelWidth(w => Math.max(180, Math.min(500, w + delta)))
  }, [])

  const handleResizeRight = useCallback((delta: number) => {
    setRightPanelWidth(w => Math.max(180, Math.min(500, w - delta)))
  }, [])

  // Listen for progress events from main process
  useEffect(() => {
    const cleanup = window.electronAPI.onProgress((info) => {
      setProgress(info)
    })
    return cleanup
  }, [])

  // Background renderer pre-fetch — pull all textures into rendererTextureCache for true 0ms clicks
  useEffect(() => {
    if (!manifest) return

    const textures = manifest.assets.filter(a => a.type === 'texture')
    if (textures.length === 0) {
      setProgress(null)
      return
    }

    let aborted = false

    async function prefetchAll() {
      const t0 = performance.now()
      const total = textures.length
      // Only update progress bar every Nth texture to avoid flooding React with re-renders
      const updateInterval = Math.max(1, Math.ceil(total / 10))
      window.electronAPI.logTiming(`[progress-bar] start: pre-rendering ${total} textures`)
      setProgress({ current: 0, total, name: 'Pre-rendering textures...' })
      let fetched = 0

      for (const asset of textures) {
        if (aborted) break
        if (rendererTextureCache.has(asset.name)) {
          fetched++
          continue
        }

        // Yield to let user interactions take priority
        await new Promise(r => setTimeout(r, 0))
        if (aborted) break

        try {
          const resp = await fetch(`blp-preview://${encodeURIComponent(asset.name)}`)
          if (!resp.ok) continue

          const buffer = await resp.arrayBuffer()
          const view = new DataView(buffer)
          const metaLen = view.getUint32(0, true)
          const meta = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 4, metaLen)))

          let bitmap: ImageBitmap | null = null
          if (!meta.tooLarge && buffer.byteLength > 4 + metaLen) {
            // Create GPU-resident ImageBitmap — keeps texture data OFF V8's heap.
            // Without this, 43 textures × 16MB = 688MB on V8's heap causes 2-5s GC pauses.
            const pixelData = new Uint8Array(buffer, 4 + metaLen)
            const imageData = new ImageData(
              new Uint8ClampedArray(pixelData.buffer, pixelData.byteOffset, pixelData.byteLength),
              meta.width, meta.height
            )
            bitmap = await createImageBitmap(imageData)
            // pixelData and buffer go out of scope → V8 can GC the response ArrayBuffer
          }

          rendererTextureCache.set(asset.name, {
            name: asset.name, width: meta.width, height: meta.height,
            mips: meta.mips, dxgiFormat: meta.dxgiFormat,
            dxgiFormatName: meta.dxgiFormatName, rgbaPixels: null, bitmap, tooLarge: meta.tooLarge
          })
          fetched++
        } catch { /* skip failed textures */ }

        // Throttled progress update — avoids 43 React re-renders
        if (fetched % updateInterval === 0) {
          setProgress({ current: fetched, total, name: 'Pre-rendering textures...' })
        }
      }

      if (!aborted) {
        const elapsed = ((performance.now() - t0) / 1000).toFixed(1)
        window.electronAPI.logTiming(`[progress-bar] finish: ${fetched}/${total} textures in ${elapsed}s`)
        setProgress(null)
      }
    }

    prefetchAll()
    return () => { aborted = true }
  }, [manifest])

  // Tab management helpers
  const saveActiveTab = useCallback(() => {
    if (!activeTabId) return
    const s = currentTabStateRef.current
    setTabs(prev => prev.map(t => t.id === activeTabId ? {
      ...t, manifest: s.manifest, selectedAsset: s.selectedAsset, selectedAssets: s.selectedAssets,
      preview: s.preview, assetData: s.assetData, replacedAssets: s.replacedAssets, statusMessage: s.statusMessage,
    } : t))
  }, [activeTabId])

  const loadTabState = useCallback((tab: TabState) => {
    setManifest(tab.manifest)
    setSelectedAsset(tab.selectedAsset)
    setSelectedAssets(tab.selectedAssets)
    setPreview(tab.preview)
    setAssetData(tab.assetData)
    setReplacedAssets(tab.replacedAssets)
    setStatusMessage(tab.statusMessage)
  }, [])

  const handleSelectTab = useCallback(async (tabId: string) => {
    if (tabId === activeTabId || switchingRef.current) return
    switchingRef.current = true
    try {
      let targetTab: TabState | undefined
      const s = currentTabStateRef.current
      setTabs(prev => {
        const updated = prev.map(t => {
          if (t.id === activeTabId) {
            return { ...t, manifest: s.manifest, selectedAsset: s.selectedAsset, selectedAssets: s.selectedAssets,
              preview: s.preview, assetData: s.assetData, replacedAssets: s.replacedAssets, statusMessage: s.statusMessage }
          }
          return t
        })
        targetTab = updated.find(t => t.id === tabId)
        return updated
      })
      if (!targetTab) return
      // Instantly show cached state
      loadTabState(targetTab)
      setActiveTabId(tabId)
      // Switch parser context in background (fire-and-forget, UI already restored)
      if (targetTab.filepath) {
        window.electronAPI.openBLP(targetTab.filepath).catch(() => { /* parser cache handles this */ })
      }
    } finally {
      switchingRef.current = false
    }
  }, [activeTabId, loadTabState])

  const handleCloseTab = useCallback(async (tabId: string) => {
    const tabIndex = tabsRef.current.findIndex(t => t.id === tabId)
    if (tabIndex === -1) return
    const closedTab = tabsRef.current[tabIndex]
    const remaining = tabsRef.current.filter(t => t.id !== tabId)
    setTabs(remaining)
    // Free main-process cache if no other tab uses the same filepath
    if (closedTab.filepath && !remaining.some(t => t.filepath === closedTab.filepath)) {
      window.electronAPI.closeCache(closedTab.filepath).catch(() => {})
    }
    if (tabId === activeTabId) {
      if (remaining.length > 0) {
        const nextTab = remaining[Math.min(tabIndex, remaining.length - 1)]
        loadTabState(nextTab)
        setActiveTabId(nextTab.id)
        if (nextTab.filepath) {
          try { await window.electronAPI.openBLP(nextTab.filepath) } catch { /* cached */ }
        }
      } else {
        setActiveTabId(null)
        setManifest(null); setSelectedAsset(null); setSelectedAssets(new Set())
        setPreview(null); setAssetData(null); setReplacedAssets(new Set())
        setStatusMessage('Ready. Open a BLP file to begin.')
      }
    }
  }, [activeTabId, loadTabState])

  const handleRenameTab = useCallback((tabId: string, newName: string) => {
    setTabs(prev => prev.map(t => t.id === tabId ? { ...t, filename: newName } : t))
  }, [])

  const handleNewTab = useCallback(() => {
    saveActiveTab()
    const tabId = Date.now().toString()
    const newTab: TabState = {
      id: tabId, filepath: '', filename: 'New Tab',
      manifest: null, selectedAsset: null, selectedAssets: new Set(),
      preview: null, assetData: null, replacedAssets: new Set(),
      statusMessage: 'Ready. Open a BLP file to begin.',
    }
    setTabs(prev => [...prev, newTab])
    setActiveTabId(tabId)
    setManifest(null); setSelectedAsset(null); setSelectedAssets(new Set())
    setPreview(null); setAssetData(null); setReplacedAssets(new Set())
    setStatusMessage('Ready. Open a BLP file to begin.')
    setDdsData(null)
  }, [saveActiveTab])

  const openBLPFile = useCallback(async (filepath: string) => {
    // Check if already open in a tab
    const existingTab = tabsRef.current.find(t => t.filepath === filepath)
    if (existingTab) {
      handleSelectTab(existingTab.id)
      return
    }

    setLoading(true)
    setStatusMessage(`Opening ${filepath.split(/[/\\]/).pop()}...`)
    setProgress({ current: 0, total: 1, name: 'Parsing BLP...' })
    setSelectedAsset(null)
    setSelectedAssets(new Set())
    setPreview(null)
    setAssetData(null)
    setReplacedAssets(new Set())
    rendererTextureCache.clear()

    try {
      const result = await window.electronAPI.openBLP(filepath) as (BLPManifest & { error?: string }) | { error: string } | null
      if (!result) {
        setStatusMessage('Failed to open BLP file.')
        notify('error', 'Failed to open file', 'No data returned')
        setProgress(null)
      } else if ('error' in result && result.error) {
        setStatusMessage(`Failed to open BLP: ${result.error}`)
        notify('error', 'Failed to open file', result.error as string)
        setProgress(null)
      } else if ('assets' in result) {
        const blpManifest = result as BLPManifest
        setManifest(blpManifest)
        const msg = `Loaded ${blpManifest.filename}: ${blpManifest.assets.length} assets`
        setStatusMessage(msg)
        // Reuse empty active tab, or create a new one
        const activeTab = tabsRef.current.find(t => t.id === activeTabId)
        if (activeTab && !activeTab.filepath) {
          setTabs(prev => prev.map(t => t.id === activeTabId ? {
            ...t, filepath, filename: blpManifest.filename,
            manifest: blpManifest, selectedAsset: null, selectedAssets: new Set(),
            preview: null, assetData: null, replacedAssets: new Set(), statusMessage: msg,
          } : t))
        } else {
          saveActiveTab()
          const tabId = Date.now().toString()
          const newTab: TabState = {
            id: tabId, filepath, filename: blpManifest.filename,
            manifest: blpManifest, selectedAsset: null, selectedAssets: new Set(),
            preview: null, assetData: null, replacedAssets: new Set(), statusMessage: msg,
          }
          setTabs(prev => [...prev, newTab])
          setActiveTabId(tabId)
        }
        // Fetch shared data paths, game detection, backup count
        try {
          const status = await window.electronAPI.getStatus()
          setSharedDataPaths(status.sharedDataPaths || [])
          setGameDetected(status.gameDetected || false)
          const bkCount = await window.electronAPI.getBackupCount()
          setBackupCount(bkCount)
        } catch { /* ignore */ }
      }
    } catch (err) {
      setStatusMessage(`Error: ${err}`)
      notify('error', 'Failed to open file', String(err))
      setProgress(null)
    } finally {
      setLoading(false)
    }
  }, [notify, handleSelectTab, saveActiveTab, activeTabId])

  const handleOpen = useCallback(async () => {
    const filepath = await window.electronAPI.selectFile([
      { name: 'BLP Files', extensions: ['blp'] },
      { name: 'All Files', extensions: ['*'] }
    ])
    if (!filepath) return
    openBLPFile(filepath)
  }, [openBLPFile])

  const handleOpenDDS = useCallback(async (filepath?: string) => {
    try {
      const result = await window.electronAPI.openDDS(filepath) as DDSData | { error: string } | null
      if (!result) return
      if ('error' in result) {
        notify('error', 'Failed to open DDS', result.error)
        return
      }
      setDdsData(result)
      setDdsViewMode('viewer')
    } catch (e) {
      notify('error', 'Failed to open DDS', String(e))
    }
  }, [notify])

  // Open inline model viewer in preview panel
  const handleOpenModelViewer = useCallback(async () => {
    if (!manifest?.filepath) return
    setModelViewerActive(true)
    setModelData(null)
    setMaterialMap(null)
    try {
      const result = await window.electronAPI.parseModel(manifest.filepath)
      if (result) {
        setModelData(result)
        // Async texture loading from Material.blp
        const materialNames = [...new Set(result.meshes.map(m => m.materialName).filter(Boolean))]
        if (materialNames.length > 0) {
          const texMap = await window.electronAPI.loadModelTextures(manifest.filepath, materialNames)
          if (texMap) setMaterialMap(texMap)
        }
      }
    } catch (e) {
      console.error('Failed to parse model:', e)
      notify('error', 'Failed to parse model', String(e))
    }
  }, [manifest, notify])

  const handleCloseModelViewer = useCallback(() => {
    setModelViewerActive(false)
    setModelData(null)
    setMaterialMap(null)
  }, [])

  // Context menu: open texture in DDS viewer window
  const handleOpenInDdsViewer = useCallback(async (name: string) => {
    try {
      const tempPath = await window.electronAPI.extractTempDds(name)
      if (!tempPath) {
        notify('error', 'Cannot open in DDS Viewer', 'Texture data not found in SHARED_DATA')
        return
      }
      await window.electronAPI.openDdsWindow(tempPath)
    } catch (e) {
      notify('error', 'Failed to open in DDS Viewer', String(e))
    }
  }, [notify])

  // Context menu: export texture as PNG/JPG
  const handleExportTextureAsImage = useCallback(async (name: string, format: 'png' | 'jpg') => {
    try {
      const result = await window.electronAPI.exportTextureAsImage(name, format) as { filepath: string; size: number } | { error: string } | null
      if (!result) return
      if ('error' in result) {
        notify('error', 'Export failed', result.error)
      } else {
        const size = result.size < 1024 * 1024
          ? `${(result.size / 1024).toFixed(1)} KB`
          : `${(result.size / (1024 * 1024)).toFixed(2)} MB`
        notify('success', `Exported ${format.toUpperCase()}`, `${size} saved`)
      }
    } catch (e) {
      notify('error', 'Export failed', String(e))
    }
  }, [notify])

  // Context menu: copy preview image to clipboard
  const handleCopyPreviewAsPng = useCallback(async () => {
    if (!preview) return
    try {
      let pixels: Uint8Array
      if (preview.rgbaPixels) {
        pixels = new Uint8Array(preview.rgbaPixels)
      } else if (preview.bitmap) {
        const canvas = document.createElement('canvas')
        canvas.width = preview.width
        canvas.height = preview.height
        const ctx = canvas.getContext('2d')!
        ctx.drawImage(preview.bitmap, 0, 0)
        pixels = new Uint8Array(ctx.getImageData(0, 0, preview.width, preview.height).data.buffer)
      } else {
        return
      }
      const ok = await window.electronAPI.copyPreviewAsPng(pixels, preview.width, preview.height)
      if (ok) {
        notify('success', 'Copied to clipboard', `${preview.width}x${preview.height} PNG`)
      } else {
        notify('error', 'Copy failed', 'Could not copy image to clipboard')
      }
    } catch (e) {
      notify('error', 'Copy failed', String(e))
    }
  }, [preview, notify])

  // Multi-select: selection change from AssetTree
  const handleSelectionChange = useCallback((newSelection: Set<string>) => {
    setSelectedAssets(newSelection)
  }, [])

  // Multi-select: bulk export selected textures
  const handleExportSelected = useCallback(async (names: string[], format: 'png' | 'jpg') => {
    if (names.length === 0) return
    const outputDir = await window.electronAPI.selectDirectory()
    if (!outputDir) return

    setLoading(true)
    setStatusMessage(`Exporting ${names.length} textures as ${format.toUpperCase()}...`)
    try {
      const result = await window.electronAPI.exportTexturesBatch(names, outputDir, format)
      if (result.success > 0) {
        notify('success', 'Batch export complete', `${result.success} textures exported`)
      }
      setStatusMessage(`Exported ${result.success} of ${names.length} textures${result.failed > 0 ? `, ${result.failed} failed` : ''}`)
    } catch (err) {
      notify('error', 'Batch export failed', String(err))
      setStatusMessage(`Export error: ${err}`)
    } finally {
      setLoading(false)
    }
  }, [notify])

  // Show manifest as text preview
  const handleExportManifest = useCallback(() => {
    if (!manifest) return
    const exportData = {
      filename: manifest.filename,
      filepath: manifest.filepath,
      header: manifest.header,
      typeCounts: manifest.typeCounts,
      totalAssets: manifest.assets.length,
      assets: manifest.assets.map(a => ({ name: a.name, type: a.type, ...a.metadata })),
      exportedAt: new Date().toISOString(),
      exportedBy: 'BLP Studio',
    }
    const json = JSON.stringify(exportData, null, 2)
    const defaultFilename = manifest.filename.replace(/\.blp$/i, '') + '-manifest.json'
    setTextPreview({
      title: `Manifest: ${manifest.filename}`,
      text: json,
      language: 'json',
      defaultFilename,
      filterName: 'JSON Files',
      filterExt: 'json',
    })
  }, [manifest])

  // Show .dep as text preview
  const handleExportDep = useCallback(async () => {
    if (!manifest) return
    const modId = sanitizeModId(manifest.filename.replace(/\.blp$/i, ''))
    const defaultFilename = manifest.filename.replace(/\.blp$/i, '') + '.dep'
    try {
      const depText = await window.electronAPI.getDepText(modId)
      if (depText) {
        setTextPreview({
          title: `.dep: ${defaultFilename}`,
          text: depText,
          language: 'xml',
          defaultFilename,
          filterName: 'DEP Files',
          filterExt: 'dep',
        })
      }
    } catch (e) {
      notify('error', 'Failed to generate .dep', String(e))
    }
  }, [manifest, notify])

  // Listen for menu events from main process
  useEffect(() => {
    const cleanupOpen = window.electronAPI.onMenuOpen(() => handleOpen())
    const cleanupFile = window.electronAPI.onMenuOpenFile((filepath) => openBLPFile(filepath))
    const cleanupTheme = window.electronAPI.onMenuToggleTheme(() => toggleTheme())
    const cleanupDds = window.electronAPI.onMenuOpenDds(() => handleOpenDDS())
    const cleanupSettings = window.electronAPI.onMenuShowSettings(() => setShowSettings(true))
    const cleanupAbout = window.electronAPI.onMenuShowAbout(() => setShowAbout(true))
    return () => { cleanupOpen(); cleanupFile(); cleanupTheme(); cleanupDds(); cleanupSettings(); cleanupAbout() }
  }, [handleOpen, openBLPFile, toggleTheme, handleOpenDDS])

  const handleDrop = useCallback((e: DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    const name = file?.name?.toLowerCase() || ''
    if (name.endsWith('.blp')) {
      openBLPFile(file.path)
    } else if (name.endsWith('.dds')) {
      handleOpenDDS(file.path)
    }
  }, [openBLPFile, handleOpenDDS])

  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault()
    setDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault()
    setDragging(false)
  }, [])

  const handlePainted = useCallback(() => {
    setLoading(false)
    setProgress(null)
  }, [])

  const handleSelectAsset = useCallback(async (asset: AssetEntry) => {
    setSelectedAsset(asset)
    setAssetData(null)

    if (asset.type === 'texture') {
      // Check renderer-side cache first — avoids 50-60ms protocol transfer for previously-viewed textures
      const cached = rendererTextureCache.get(asset.name)
      if (cached) {
        window.electronAPI.logTiming(`[renderer] ${asset.name}: cache-hit (${cached.width}x${cached.height})`)
        setProgress({ current: 0, total: 1, name: `Rendering ${asset.name.replace(/^TEXTURE_/, '')}...` })
        setPreview(cached)
        setLoading(false)
        return
      }

      setPreview(null)
      setLoading(true)
      window.electronAPI.logTiming(`[preview] ${asset.name}: loading start`)
      // Yield so React can render the loading bar before the fetch starts
      await new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)))
      try {
        // Single fetch via custom protocol — zero IPC (IPC channel gets clogged by thumbnails)
        // Response format: [4 bytes: JSON length LE] [JSON metadata] [RGBA pixels if any]
        const t0 = performance.now()
        const resp = await fetch(`blp-preview://${encodeURIComponent(asset.name)}`)
        if (!resp.ok) throw new Error(`Protocol error: ${resp.status}`)

        const buffer = await resp.arrayBuffer()
        const view = new DataView(buffer)
        const metaLen = view.getUint32(0, true)
        const meta = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 4, metaLen)))

        let rgbaPixels: Uint8Array | null = null
        if (!meta.tooLarge && buffer.byteLength > 4 + metaLen) {
          const src = new Uint8Array(buffer, 4 + metaLen)
          const copy = new Uint8Array(src.length)
          copy.set(src)
          rgbaPixels = copy
        }
        const t1 = performance.now()
        window.electronAPI.logTiming(`[preview] ${asset.name}: loaded in ${(t1 - t0).toFixed(0)}ms (${meta.width}x${meta.height})`)

        const result: TexturePreview = { name: asset.name, width: meta.width, height: meta.height, mips: meta.mips, dxgiFormat: meta.dxgiFormat, dxgiFormatName: meta.dxgiFormatName, rgbaPixels, tooLarge: meta.tooLarge }
        rendererTextureCache.set(asset.name, result)
        setPreview(result)
      } catch (err) {
        window.electronAPI.logTiming(`[preview] ${asset.name}: failed — ${err}`)
        console.error('[renderer] texture preview failed:', err)
        setPreview(null)
      } finally {
        setLoading(false)
      }
    } else {
      setPreview(null)
      setLoading(true)
      try {
        const data = await window.electronAPI.getAssetData(asset.name)
        setAssetData(data)
      } catch {
        setAssetData(null)
      } finally {
        setLoading(false)
      }
    }
  }, [])

  const handleExtractAll = useCallback(async () => {
    const outputDir = await window.electronAPI.selectDirectory()
    if (!outputDir) return

    setLoading(true)
    setStatusMessage('Extracting all assets...')
    try {
      const result = await window.electronAPI.extractAll(outputDir, 'all')
      setStatusMessage(`Extracted: ${result.success} ok, ${result.failed} failed, ${result.skipped} skipped`)
      if (result.success > 0) {
        notify('success', 'Extraction complete', `${result.success} assets extracted`)
      } else {
        notify('error', 'Extraction failed', `${result.failed} errors`)
      }
    } catch (err) {
      setStatusMessage(`Extract error: ${err}`)
      notify('error', 'Extraction failed', String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  const handleExtractSelected = useCallback(async () => {
    if (!selectedAsset) return
    const outputDir = await window.electronAPI.selectDirectory()
    if (!outputDir) return

    setLoading(true)
    try {
      const ok = await window.electronAPI.extractAsset(selectedAsset.name, outputDir)
      setStatusMessage(ok ? `Extracted ${selectedAsset.name}` : `Failed to extract ${selectedAsset.name}`)
    } catch (err) {
      setStatusMessage(`Extract error: ${err}`)
    } finally {
      setLoading(false)
    }
  }, [selectedAsset])

  const handleReplace = useCallback(async () => {
    if (!selectedAsset) return

    try {
      const result = await window.electronAPI.replaceAsset(selectedAsset.name)
      if (result) {
        setReplacedAssets(prev => new Set([...prev, result.name]))
        let msg = `Replaced ${result.name} (${(result.size / 1024).toFixed(1)} KB from ${result.sourcePath.split(/[/\\]/).pop()})`
        // Warn if DDS dimensions differ from original
        if (result.ddsInfo && selectedAsset.metadata) {
          const origW = selectedAsset.metadata.width as number
          const origH = selectedAsset.metadata.height as number
          if (origW && origH && (result.ddsInfo.width !== origW || result.ddsInfo.height !== origH)) {
            msg += ` -- WARNING: dimensions differ (${result.ddsInfo.width}x${result.ddsInfo.height} vs original ${origW}x${origH})`
            notify('warning', 'Dimension mismatch', `${result.ddsInfo.width}x${result.ddsInfo.height} vs original ${origW}x${origH}`)
          }
        }
        setStatusMessage(msg)
      }
    } catch (err) {
      setStatusMessage(`Replace error: ${err}`)
    }
  }, [selectedAsset])

  const handleRevert = useCallback(async () => {
    if (!selectedAsset) return

    try {
      const ok = await window.electronAPI.clearReplacement(selectedAsset.name)
      if (ok) {
        setReplacedAssets(prev => {
          const next = new Set(prev)
          next.delete(selectedAsset.name)
          return next
        })
        setStatusMessage(`Reverted ${selectedAsset.name}`)
      }
    } catch (err) {
      setStatusMessage(`Revert error: ${err}`)
    }
  }, [selectedAsset])

  const handleSave = useCallback(async () => {
    if (replacedAssets.size === 0) return

    setLoading(true)
    setStatusMessage('Saving modified assets...')
    try {
      const result = await window.electronAPI.saveReplacements()
      if (result.success > 0) {
        setStatusMessage(`Saved ${result.success} CIVBIG file${result.success > 1 ? 's' : ''}${result.failed > 0 ? `, ${result.failed} failed` : ''}`)
        notify('success', 'Export complete', `${result.success} CIVBIG file${result.success > 1 ? 's' : ''} saved`)
      } else if (result.success === 0 && result.failed === 0) {
        setStatusMessage('Save cancelled')
      } else {
        setStatusMessage(`Save failed: ${result.failed} errors`)
        notify('error', 'Export failed', `${result.failed} errors`)
      }
    } catch (err) {
      setStatusMessage(`Save error: ${err}`)
      notify('error', 'Export failed', String(err))
    } finally {
      setLoading(false)
    }
  }, [replacedAssets.size])

  const handleExportAsMod = useCallback(async () => {
    if (replacedAssets.size === 0) return

    setLoading(true)
    setStatusMessage('Exporting mod package...')
    try {
      const result = await window.electronAPI.exportAsMod()
      if (result.success > 0) {
        setStatusMessage(
          `Exported mod "${result.modId}" with ${result.success} asset${result.success > 1 ? 's' : ''}${result.failed > 0 ? `, ${result.failed} failed` : ''}`
        )
        notify('success', 'Mod exported', `"${result.modId}" with ${result.success} asset${result.success > 1 ? 's' : ''}`)
      } else if (result.success === 0 && result.failed === 0) {
        setStatusMessage('Export cancelled')
      } else {
        setStatusMessage(`Export failed: ${result.failed} errors`)
        notify('error', 'Mod export failed', `${result.failed} errors`)
      }
    } catch (err) {
      setStatusMessage(`Export error: ${err}`)
      notify('error', 'Mod export failed', String(err))
    } finally {
      setLoading(false)
    }
  }, [replacedAssets.size])

  const handleInstallToGame = useCallback(async () => {
    if (replacedAssets.size === 0) return

    setLoading(true)
    setStatusMessage('Installing to game...')
    try {
      const result = await window.electronAPI.installToGame()
      if (result.success > 0) {
        setStatusMessage(`Installed ${result.success} asset${result.success > 1 ? 's' : ''} to game${result.failed > 0 ? `, ${result.failed} failed` : ''}`)
        notify('success', 'Installed to game', `${result.success} asset${result.success > 1 ? 's' : ''} written to SHARED_DATA`)
      } else {
        setStatusMessage(`Install failed: ${result.errors.join('; ')}`)
        notify('error', 'Install failed', result.errors[0] || 'Unknown error')
      }
      const bkCount = await window.electronAPI.getBackupCount()
      setBackupCount(bkCount)
    } catch (err) {
      setStatusMessage(`Install error: ${err}`)
      notify('error', 'Install failed', String(err))
    } finally {
      setLoading(false)
    }
  }, [replacedAssets.size])

  const handleRestoreBackups = useCallback(async () => {
    setLoading(true)
    setStatusMessage('Restoring backups...')
    try {
      const result = await window.electronAPI.restoreBackups()
      if (result.restored > 0) {
        setStatusMessage(`Restored ${result.restored} file${result.restored > 1 ? 's' : ''}${result.failed > 0 ? `, ${result.failed} failed` : ''}`)
        notify('success', 'Backups restored', `${result.restored} file${result.restored > 1 ? 's' : ''} restored`)
      } else {
        setStatusMessage('No backups to restore')
      }
      const bkCount = await window.electronAPI.getBackupCount()
      setBackupCount(bkCount)
    } catch (err) {
      setStatusMessage(`Restore error: ${err}`)
      notify('error', 'Restore failed', String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  const isReplaced = selectedAsset ? replacedAssets.has(selectedAsset.name) : false

  // Determine what to render in main area
  const renderMainContent = () => {
    // DDS Compare mode
    if (ddsData && ddsViewMode === 'compare') {
      return (
        <DDSCompare
          leftDds={ddsData}
          onClose={() => setDdsViewMode('viewer')}
          onNotify={notify}
        />
      )
    }

    // DDS Viewer mode
    if (ddsData) {
      return (
        <DDSViewer
          dds={ddsData}
          onClose={() => setDdsData(null)}
          onNotify={notify}
          onCompare={() => setDdsViewMode('compare')}
          onBatchExport={() => setShowBatchDialog(true)}
        />
      )
    }

    // BLP Browser (default)
    return (
      <>
        <div className="flex-1 flex overflow-hidden">
          {/* Left: Asset Tree */}
          <div className="flex flex-col shrink-0" style={{ width: leftPanelWidth }}>
            <AssetTree
              assets={manifest?.assets || []}
              selectedAsset={selectedAsset}
              selectedAssets={selectedAssets}
              onSelectAsset={handleSelectAsset}
              onSelectionChange={handleSelectionChange}
              onExportSelected={handleExportSelected}
              replacedAssets={replacedAssets}
              onOpenInDdsViewer={handleOpenInDdsViewer}
              onExportAsImage={handleExportTextureAsImage}
            />
          </div>

          <ResizeHandle direction="horizontal" onResize={handleResizeLeft} />

          {/* Center: Preview */}
          <div className="flex-1 flex flex-col min-w-0">
            <PreviewPanel
              selectedAsset={selectedAsset}
              preview={preview}
              assetData={assetData}
              loading={loading}
              onExtract={handleExtractSelected}
              onReplace={settingsData.experimentalFeatures ? handleReplace : undefined}
              onRevert={settingsData.experimentalFeatures ? handleRevert : undefined}
              isReplaced={isReplaced}
              onCopyImage={handleCopyPreviewAsPng}
              experimentalEnabled={settingsData.experimentalFeatures}
              onPainted={handlePainted}
              onOpenModelViewer={handleOpenModelViewer}
              modelViewerActive={modelViewerActive}
              modelData={modelData}
              materialMap={materialMap}
              onCloseModelViewer={handleCloseModelViewer}
            />
          </div>

          <ResizeHandle direction="horizontal" onResize={handleResizeRight} />

          {/* Right: Properties */}
          <div className="shrink-0" style={{ width: rightPanelWidth }}>
            <PropertiesPanel
              asset={selectedAsset}
              preview={preview}
            />
          </div>
        </div>

        {/* Status Bar */}
        <StatusBar
          message={statusMessage}
          manifest={manifest}
          progress={progress}
          sharedDataPaths={sharedDataPaths}
          onOpenFolder={(path) => window.electronAPI.openFolder(path)}
        />
      </>
    )
  }

  // DDS-only window: minimal chrome
  if (isDdsOnlyWindow) {
    return (
      <div className="h-screen flex flex-col bg-gray-900 text-gray-100 relative">
        {renderMainContent()}
        <Notification notification={notification} onDismiss={() => setNotification(null)} />
      </div>
    )
  }

  return (
    <div
      className="h-screen flex flex-col bg-gray-900 text-gray-100 relative"
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
    >
      {/* Drop overlay */}
      {dragging && (
        <div className="absolute inset-0 z-50 bg-blue-900/40 border-4 border-dashed border-blue-400 flex items-center justify-center pointer-events-none">
          <div className="text-center">
            <div className="text-5xl mb-3">{'\u{1F4C2}'}</div>
            <p className="text-xl text-blue-200 font-medium">Drop BLP or DDS file here</p>
          </div>
        </div>
      )}

      {/* Toolbar */}
      <Toolbar
        onOpen={handleOpen}
        onExtractAll={handleExtractAll}
        onExportManifest={handleExportManifest}
        onExportDep={handleExportDep}
        onSave={handleSave}
        onExportAsMod={handleExportAsMod}
        onInstallToGame={handleInstallToGame}
        onRestoreBackups={handleRestoreBackups}
        hasFile={!!manifest}
        loading={loading}
        replacementCount={settingsData.experimentalFeatures ? replacedAssets.size : 0}
        backupCount={backupCount}
        gameDetected={gameDetected}
        theme={theme}
        onToggleTheme={toggleTheme}
        onShowSettings={() => setShowSettings(true)}
        onShowAbout={() => setShowAbout(true)}
        experimentalEnabled={settingsData.experimentalFeatures}
      />

      {/* Tab bar */}
      {tabs.length > 0 && (
        <TabBar
          tabs={tabs.map(t => ({
            id: t.id,
            filename: t.filename,
            hasModifications: t.id === activeTabId ? replacedAssets.size > 0 : t.replacedAssets.size > 0,
          }))}
          activeTabId={activeTabId}
          onSelectTab={handleSelectTab}
          onCloseTab={handleCloseTab}
          onNewTab={handleNewTab}
          onRenameTab={handleRenameTab}
        />
      )}

      {/* Main content */}
      {renderMainContent()}

      {/* Batch DDS Export dialog */}
      <BatchDDSDialog
        open={showBatchDialog}
        onClose={() => setShowBatchDialog(false)}
        onNotify={notify}
      />

      {/* Settings dialog */}
      <SettingsDialog
        open={showSettings}
        onClose={() => setShowSettings(false)}
        settings={settingsData}
        onSave={handleSaveSettings}
      />

      {/* About dialog */}
      <AboutDialog
        open={showAbout}
        onClose={() => setShowAbout(false)}
        version={appVersion}
      />

      {/* Text preview modal (Manifest / .dep) */}
      {textPreview && (
        <TextPreviewModal
          title={textPreview.title}
          text={textPreview.text}
          language={textPreview.language}
          defaultFilename={textPreview.defaultFilename}
          filterName={textPreview.filterName}
          filterExt={textPreview.filterExt}
          onClose={() => setTextPreview(null)}
          onNotify={notify}
        />
      )}

      {/* Notification toast */}
      <Notification notification={notification} onDismiss={() => setNotification(null)} />
    </div>
  )
}
