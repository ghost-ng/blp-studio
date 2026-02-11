import { contextBridge, ipcRenderer } from 'electron'

export interface AssetEntry {
  name: string
  type: 'texture' | 'blob' | 'gpu' | 'sound'
  metadata: Record<string, unknown>
}

export interface BLPManifest {
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

export interface TexturePreview {
  name: string
  width: number
  height: number
  mips: number
  dxgiFormat: number
  dxgiFormatName: string
  rgbaPixels: Uint8Array
}

export interface ReplacementInfo {
  name: string
  size: number
  sourcePath: string
}

export interface ProgressInfo {
  current: number
  total: number
  name: string
}

export interface ElectronAPI {
  openBLP: (filepath?: string) => Promise<BLPManifest | null>
  getAssetData: (name: string) => Promise<{ data: Uint8Array; totalSize: number; truncated: boolean; blobType: number; typeFlags: number } | null>
  getTexturePreview: (name: string) => Promise<TexturePreview | null>
  extractAsset: (name: string, outputPath: string) => Promise<boolean>
  extractAll: (outputDir: string, assetType: string) => Promise<{ success: number; failed: number; skipped: number }>
  replaceAsset: (name: string) => Promise<ReplacementInfo | null>
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
  getPreferences: () => Promise<{ theme: 'dark' | 'light'; recentFiles: string[]; defaultExportFormat: 'png' | 'jpg'; jpgQuality: number; ddsDefaultBackground: 'checkerboard' | 'black' | 'white'; compressionMode: 'auto' | 'always' | 'never' }>
  setTheme: (theme: 'dark' | 'light') => Promise<void>
  updatePreferences: (prefs: Record<string, unknown>) => Promise<void>
  getVersion: () => Promise<string>
  onMenuOpen: (callback: () => void) => () => void
  onMenuShowSettings: (callback: () => void) => () => void
  onMenuShowAbout: (callback: () => void) => () => void
  onMenuOpenFile: (callback: (filepath: string) => void) => () => void
  onMenuToggleTheme: (callback: () => void) => () => void
  onMenuOpenDds: (callback: () => void) => () => void
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
  exportTexturesBatch: (names: string[], outputDir: string, format: string, quality?: number) => Promise<{ success: number; failed: number }>
  getThumbnails: (names: string[]) => Promise<Record<string, { width: number; height: number; rgbaPixels: Uint8Array }>>
  preloadTextures: () => Promise<{ loaded: number; total: number }>
  onPreloadProgress: (callback: (info: ProgressInfo) => void) => () => void
  onDdsLoadFile: (callback: (filepath: string) => void) => () => void
}

const api: ElectronAPI = {
  openBLP: (filepath?) => ipcRenderer.invoke('blp:open', filepath),
  getAssetData: (name) => ipcRenderer.invoke('asset:data', name),
  getTexturePreview: (name) => ipcRenderer.invoke('asset:preview', name),
  extractAsset: (name, outputPath) => ipcRenderer.invoke('asset:extract', name, outputPath),
  extractAll: (outputDir, assetType) => ipcRenderer.invoke('asset:extract-all', outputDir, assetType),
  replaceAsset: (name) => ipcRenderer.invoke('asset:replace', name),
  clearReplacement: (name) => ipcRenderer.invoke('asset:clear-replacement', name),
  getReplacements: () => ipcRenderer.invoke('asset:get-replacements'),
  saveReplacements: (outputDir?) => ipcRenderer.invoke('blp:save-replacements', outputDir),
  installToGame: () => ipcRenderer.invoke('blp:install-to-game'),
  exportAsMod: () => ipcRenderer.invoke('blp:export-as-mod'),
  restoreBackups: () => ipcRenderer.invoke('blp:restore-backups'),
  getBackupCount: () => ipcRenderer.invoke('blp:backup-count'),
  selectFile: (filters) => ipcRenderer.invoke('dialog:open-file', filters),
  selectDirectory: () => ipcRenderer.invoke('dialog:open-directory'),
  getStatus: () => ipcRenderer.invoke('app:status'),
  openFolder: (folderPath) => ipcRenderer.invoke('app:open-folder', folderPath),
  onProgress: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, info: ProgressInfo | null) => callback(info)
    ipcRenderer.on('progress', handler)
    return () => ipcRenderer.removeListener('progress', handler)
  },
  getPreferences: () => ipcRenderer.invoke('pref:get'),
  setTheme: (theme) => ipcRenderer.invoke('pref:set-theme', theme),
  updatePreferences: (prefs) => ipcRenderer.invoke('pref:update', prefs),
  getVersion: () => ipcRenderer.invoke('app:version'),
  onMenuOpen: (callback) => {
    const handler = () => callback()
    ipcRenderer.on('menu:open', handler)
    return () => ipcRenderer.removeListener('menu:open', handler)
  },
  onMenuOpenFile: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, filepath: string) => callback(filepath)
    ipcRenderer.on('menu:open-file', handler)
    return () => ipcRenderer.removeListener('menu:open-file', handler)
  },
  onMenuToggleTheme: (callback) => {
    const handler = () => callback()
    ipcRenderer.on('menu:toggle-theme', handler)
    return () => ipcRenderer.removeListener('menu:toggle-theme', handler)
  },
  onMenuOpenDds: (callback) => {
    const handler = () => callback()
    ipcRenderer.on('menu:open-dds', handler)
    return () => ipcRenderer.removeListener('menu:open-dds', handler)
  },
  onMenuShowSettings: (callback) => {
    const handler = () => callback()
    ipcRenderer.on('menu:show-settings', handler)
    return () => ipcRenderer.removeListener('menu:show-settings', handler)
  },
  onMenuShowAbout: (callback) => {
    const handler = () => callback()
    ipcRenderer.on('menu:show-about', handler)
    return () => ipcRenderer.removeListener('menu:show-about', handler)
  },
  openDDS: (filepath?) => ipcRenderer.invoke('dds:open', filepath),
  getDdsMip: (filepath, mipLevel) => ipcRenderer.invoke('dds:get-mip', filepath, mipLevel),
  exportDds: (rgbaPixels, width, height, format, quality?) => ipcRenderer.invoke('dds:export', rgbaPixels, width, height, format, quality),
  batchExportDds: (sourceDir, outputDir, format, quality?) => ipcRenderer.invoke('dds:batch-export', sourceDir, outputDir, format, quality),
  openDdsWindow: (filepath) => ipcRenderer.invoke('dds:open-window', filepath),
  extractTempDds: (name) => ipcRenderer.invoke('asset:extract-temp-dds', name),
  exportTextureAsImage: (name, format, quality?) => ipcRenderer.invoke('asset:export-as-image', name, format, quality),
  copyPreviewAsPng: (rgbaPixels, width, height) => ipcRenderer.invoke('preview:copy-as-png', rgbaPixels, width, height),
  exportManifest: (manifestJson, defaultFilename) => ipcRenderer.invoke('blp:export-manifest', manifestJson, defaultFilename),
  exportDep: (modId, defaultFilename) => ipcRenderer.invoke('blp:export-dep', modId, defaultFilename),
  getDepText: (modId) => ipcRenderer.invoke('blp:get-dep-text', modId),
  getModinfoText: (modId, modName) => ipcRenderer.invoke('blp:get-modinfo-text', modId, modName),
  saveTextFile: (text, defaultFilename, filterName, filterExt) => ipcRenderer.invoke('blp:save-text-file', text, defaultFilename, filterName, filterExt),
  parseWwiseBank: (name) => ipcRenderer.invoke('asset:parse-wwise', name),
  extractWwiseAudio: (name, fileId) => ipcRenderer.invoke('asset:extract-wwise-audio', name, fileId),
  extractAllWwiseAudio: (name, outputDir) => ipcRenderer.invoke('asset:extract-all-wwise', name, outputDir),
  extractBlobsByType: (blobType, outputDir) => ipcRenderer.invoke('asset:extract-blobs-by-type', blobType, outputDir),
  exportTexturesBatch: (names, outputDir, format, quality?) => ipcRenderer.invoke('asset:export-textures-batch', names, outputDir, format, quality),
  getThumbnails: (names) => ipcRenderer.invoke('asset:thumbnails', names),
  preloadTextures: () => ipcRenderer.invoke('blp:preload-textures'),
  onPreloadProgress: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, info: ProgressInfo) => callback(info)
    ipcRenderer.on('preload-progress', handler)
    return () => ipcRenderer.removeListener('preload-progress', handler)
  },
  onDdsLoadFile: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, filepath: string) => callback(filepath)
    ipcRenderer.on('dds:load-file', handler)
    return () => ipcRenderer.removeListener('dds:load-file', handler)
  },
}

contextBridge.exposeInMainWorld('electronAPI', api)
