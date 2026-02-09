import React, { useState, useCallback, useEffect, DragEvent } from 'react'
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
  rgbaPixels: Uint8Array
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
      onDdsLoadFile: (callback: (filepath: string) => void) => () => void
    }
  }
}

type DdsViewMode = 'viewer' | 'compare'

export default function App() {
  const [manifest, setManifest] = useState<BLPManifest | null>(null)
  const [selectedAsset, setSelectedAsset] = useState<AssetEntry | null>(null)
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
  const [showAbout, setShowAbout] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [appVersion, setAppVersion] = useState('1.0.0')
  const [settingsData, setSettingsData] = useState<SettingsData>({
    theme: 'dark',
    defaultExportFormat: 'png',
    jpgQuality: 90,
    ddsDefaultBackground: 'checkerboard',
    compressionMode: 'auto',
    experimentalFeatures: false,
  })

  // Resizable panel widths
  const [leftPanelWidth, setLeftPanelWidth] = useState(288)   // asset tree (w-72 = 288px)
  const [rightPanelWidth, setRightPanelWidth] = useState(288) // properties panel

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

  const openBLPFile = useCallback(async (filepath: string) => {
    setLoading(true)
    setStatusMessage(`Opening ${filepath.split(/[/\\]/).pop()}...`)
    setProgress({ current: 0, total: 1, name: 'Parsing BLP...' })
    setSelectedAsset(null)
    setPreview(null)
    setAssetData(null)
    setReplacedAssets(new Set())

    try {
      const result = await window.electronAPI.openBLP(filepath) as (BLPManifest & { error?: string }) | { error: string } | null
      if (!result) {
        setStatusMessage('Failed to open BLP file.')
        notify('error', 'Failed to open file', 'No data returned')
      } else if ('error' in result && result.error) {
        setStatusMessage(`Failed to open BLP: ${result.error}`)
        notify('error', 'Failed to open file', result.error as string)
      } else if ('assets' in result) {
        setManifest(result as BLPManifest)
        setStatusMessage(`Loaded ${result.filename}: ${(result as BLPManifest).assets.length} assets`)
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
    } finally {
      setLoading(false)
      setProgress(null)
    }
  }, [notify])

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
      const ok = await window.electronAPI.copyPreviewAsPng(
        new Uint8Array(preview.rgbaPixels), preview.width, preview.height
      )
      if (ok) {
        notify('success', 'Copied to clipboard', `${preview.width}x${preview.height} PNG`)
      } else {
        notify('error', 'Copy failed', 'Could not copy image to clipboard')
      }
    } catch (e) {
      notify('error', 'Copy failed', String(e))
    }
  }, [preview, notify])

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

  const handleSelectAsset = useCallback(async (asset: AssetEntry) => {
    setSelectedAsset(asset)
    setAssetData(null)

    if (asset.type === 'texture') {
      setPreview(null)
      setLoading(true)
      setProgress({ current: 0, total: 1, name: `Loading ${asset.name}...` })
      try {
        const texPreview = await window.electronAPI.getTexturePreview(asset.name)
        setPreview(texPreview)
      } catch {
        setPreview(null)
      } finally {
        setLoading(false)
        setProgress(null)
      }
    } else {
      setPreview(null)
      setLoading(true)
      setProgress({ current: 0, total: 1, name: `Loading ${asset.name}...` })
      try {
        const data = await window.electronAPI.getAssetData(asset.name)
        setAssetData(data)
      } catch {
        setAssetData(null)
      } finally {
        setLoading(false)
        setProgress(null)
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
              onSelectAsset={handleSelectAsset}
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

      {/* Notification toast */}
      <Notification notification={notification} onDismiss={() => setNotification(null)} />
    </div>
  )
}
