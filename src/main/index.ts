import { app, BrowserWindow, ipcMain, dialog, shell, Menu, nativeImage, clipboard } from 'electron'
import { join } from 'path'
import { tmpdir } from 'os'
import { BLPParser } from '../core/blp-parser'
import { readCivbig, readCivbigInfo, writeCivbig } from '../core/civbig'
import { dxgiName, calcTextureSize, makeDdsHeader, blobExtension } from '../core/dds-formats'
import { OodleDecompressor } from '../core/oodle'
import {
  findSharedDataCandidates,
  findOodleCandidates,
  findGameRootFromPath,
  findAllSharedData,
  buildSharedDataIndex
} from '../core/game-detect'
import { decodeBCn } from '../core/bcn-decoder'
import { generateModinfo, generateDep, sanitizeModId } from '../core/mod-manifest'
import { initPreferences, loadPreferences, setTheme, updatePreferences, addRecentFile, clearRecentFiles } from '../core/preferences'
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync, readdirSync, unlinkSync } from 'fs'

// ---- App State ----
let mainWindow: BrowserWindow | null = null
let currentParser: BLPParser | null = null
let sdIndex: Map<string, string> = new Map()
let oodle: OodleDecompressor | null = null
let gameRoot: string | null = null
let sdDirs: string[] = []

// Replacement data: maps asset name → raw replacement bytes + DDS metadata
interface ReplacementData {
  data: Buffer
  ddsInfo?: { width: number; height: number; format: number; mips: number; formatName: string }
}
const replacements: Map<string, ReplacementData> = new Map()

// ---- Icon ----
function getAppIcon(): Electron.NativeImage | undefined {
  // Packaged: process.resourcesPath/resources/icon.png
  // Dev: project root/resources/icon.png
  const candidates = [
    join(process.resourcesPath || '', 'resources', 'icon.png'),
    join(process.cwd(), 'resources', 'icon.png'),
    join(__dirname, '../../resources', 'icon.png'),
  ]
  for (const p of candidates) {
    if (existsSync(p)) return nativeImage.createFromPath(p)
  }
  return undefined
}

// ---- Window ----
function createWindow() {
  const icon = getAppIcon()
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    icon,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,  // must be false for preload to use Node APIs
      webSecurity: true,
    },
    backgroundColor: loadPreferences().theme === 'light' ? '#ffffff' : '#111827',
    titleBarStyle: 'default',
    title: 'BLP Studio',
  })

  // Security: block navigation to external URLs
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://') && !url.startsWith('http://localhost')) {
      event.preventDefault()
    }
  })

  // Security: block new window creation (popups)
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) {
      shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// ---- DDS Viewer Window ----
function createDDSWindow(filepath: string) {
  const win = new BrowserWindow({
    width: 1000,
    height: 700,
    minWidth: 600,
    minHeight: 400,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      webSecurity: true,
    },
    backgroundColor: loadPreferences().theme === 'light' ? '#ffffff' : '#111827',
    title: `DDS Viewer - ${filepath.split(/[/\\]/).pop() || 'unknown'}`,
  })

  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://') && !url.startsWith('http://localhost')) {
      event.preventDefault()
    }
  })
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  win.webContents.once('did-finish-load', () => {
    win.webContents.send('dds:load-file', filepath)
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// ---- Application Menu ----
function buildMenu() {
  const prefs = loadPreferences()
  const recentFiles = prefs.recentFiles

  const recentSubmenu: Electron.MenuItemConstructorOptions[] = recentFiles.length > 0
    ? [
        ...recentFiles.map(filepath => ({
          label: filepath.split(/[/\\]/).pop() || filepath,
          click: () => mainWindow?.webContents.send('menu:open-file', filepath),
          toolTip: filepath,
        })),
        { type: 'separator' as const },
        {
          label: 'Clear Recent',
          click: () => {
            clearRecentFiles()
            buildMenu()
          },
        },
      ]
    : [{ label: 'No Recent Files', enabled: false }]

  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Open BLP...',
          accelerator: 'CmdOrCtrl+O',
          click: () => mainWindow?.webContents.send('menu:open'),
        },
        {
          label: 'Open Recent',
          submenu: recentSubmenu,
        },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'DDS Viewer',
      submenu: [
        {
          label: 'Open DDS...',
          accelerator: 'CmdOrCtrl+D',
          click: () => mainWindow?.webContents.send('menu:open-dds'),
        },
      ],
    },
    {
      label: 'View',
      submenu: [
        {
          label: prefs.theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode',
          accelerator: 'CmdOrCtrl+Shift+T',
          click: () => mainWindow?.webContents.send('menu:toggle-theme'),
        },
        { type: 'separator' },
        {
          label: 'Settings',
          accelerator: 'CmdOrCtrl+,',
          click: () => mainWindow?.webContents.send('menu:show-settings'),
        },
        { type: 'separator' },
        { role: 'toggleDevTools' },
        { role: 'reload' },
      ],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'Report Issue...',
          click: () => shell.openExternal('https://github.com/ghost-ng/blp-studio/issues'),
        },
        { type: 'separator' },
        {
          label: 'About BLP Studio',
          click: () => mainWindow?.webContents.send('menu:show-about'),
        },
      ],
    },
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

// ---- Initialization ----
function initOodle() {
  const candidates = findOodleCandidates()
  for (const dllPath of candidates) {
    try {
      oodle = new OodleDecompressor(dllPath)
      console.log(`Oodle loaded: ${dllPath}`)
      return
    } catch (e) {
      console.warn(`Failed to load Oodle from ${dllPath}:`, e)
    }
  }
  console.warn('No Oodle DLL found. Compressed assets will not be decompressible.')
}

function initSharedData(blpPath?: string) {
  const dirs: string[] = []

  // Try to find game root from BLP path
  if (blpPath) {
    const root = findGameRootFromPath(blpPath)
    if (root) {
      gameRoot = root
      for (const sd of findAllSharedData(root)) {
        if (!dirs.includes(sd)) dirs.push(sd)
      }
    }
  }

  // Fallback: search known Steam paths
  if (dirs.length === 0) {
    for (const sd of findSharedDataCandidates()) {
      if (!dirs.includes(sd)) dirs.push(sd)
    }
  }

  // Skip rebuild if directories haven't changed
  if (dirs.length === sdDirs.length && dirs.every((d, i) => d === sdDirs[i])) {
    return
  }

  sdDirs = dirs
  sdIndex = buildSharedDataIndex(dirs)
  console.log(`SHARED_DATA: ${dirs.length} dirs, ${sdIndex.size} files`)
}

// ---- Asset helpers ----
interface AssetEntry {
  name: string
  type: 'texture' | 'blob' | 'gpu' | 'sound'
  metadata: Record<string, unknown>
}

function collectAssets(parser: BLPParser): AssetEntry[] {
  const assets: AssetEntry[] = []
  const seen = new Set<string>()

  for (const alloc of parser.iterEntriesByType('BLP::TextureEntry')) {
    const obj = parser.deserializeAlloc(alloc)
    const name = obj.m_Name as string
    if (!name || seen.has(name)) continue
    seen.add(name)
    assets.push({
      name,
      type: 'texture',
      metadata: {
        width: obj.m_nWidth,
        height: obj.m_nHeight,
        mips: obj.m_nMips,
        format: obj.m_eFormat,
        formatName: dxgiName(obj.m_eFormat as number || 0),
        size: obj.m_nSize,
        offset: obj.m_nOffset,
        flags: obj.m_mFlags,
        textureClass: obj.m_TextureClass,
        sourcePath: sdIndex.get(name) || '',
        sourceBlp: parser.filename,
      }
    })
  }

  for (const alloc of parser.iterEntriesByType('BLP::BlobEntry')) {
    const obj = parser.deserializeAlloc(alloc)
    const name = obj.m_Name as string
    if (!name || seen.has(name)) continue
    seen.add(name)
    assets.push({
      name,
      type: 'blob',
      metadata: {
        blobType: obj.m_nBlobType,
        size: obj.m_nSize,
        flags: obj.m_mFlags,
        sourcePath: sdIndex.get(name) || '',
        sourceBlp: parser.filename,
      }
    })
  }

  for (const alloc of parser.iterEntriesByType('BLP::GpuBufferEntry')) {
    const obj = parser.deserializeAlloc(alloc)
    const name = obj.m_Name as string
    if (!name || seen.has(name)) continue
    seen.add(name)
    assets.push({
      name,
      type: 'gpu',
      metadata: {
        size: obj.m_nSize,
        bytesPerElement: obj.m_nBytesPerElement,
        elementCount: obj.m_nElementCount,
        materialName: obj.m_MaterialName,
        sourcePath: sdIndex.get(name) || '',
        sourceBlp: parser.filename,
      }
    })
  }

  for (const alloc of parser.iterEntriesByType('BLP::SoundBankEntry')) {
    const obj = parser.deserializeAlloc(alloc)
    const name = obj.m_Name as string
    if (!name || seen.has(name)) continue
    seen.add(name)
    assets.push({
      name,
      type: 'sound',
      metadata: {
        size: obj.m_nSize,
        flags: obj.m_mFlags,
        sourcePath: sdIndex.get(name) || '',
        sourceBlp: parser.filename,
      }
    })
  }

  return assets
}

function getTextureRawData(name: string, metadata: Record<string, unknown>): Buffer | null {
  const w = metadata.width as number || 0
  const h = metadata.height as number || 0
  const mips = metadata.mips as number || 1
  const fmt = metadata.format as number || 0
  const rawSize = calcTextureSize(w, h, mips, fmt)

  // Try SHARED_DATA first
  const civbigPath = sdIndex.get(name)
  if (civbigPath) {
    try {
      const { data } = readCivbig(civbigPath)
      if (OodleDecompressor.isOodleCompressed(data) && oodle) {
        const raw = oodle.decompress(data, rawSize)
        return raw
      }
      return data
    } catch (e) {
      console.warn(`Failed to read CIVBIG for ${name}:`, e)
    }
  }

  return null
}

// ---- Mip size helper ----
function calcMipSize(w: number, h: number, dxgiFmt: number): number {
  return calcTextureSize(w, h, 1, dxgiFmt)
}

// ---- IPC Argument Validation ----
function isString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0
}

function isValidFilters(v: unknown): v is Array<{ name: string; extensions: string[] }> {
  return Array.isArray(v) && v.every(
    f => typeof f === 'object' && f !== null && typeof f.name === 'string' && Array.isArray(f.extensions)
  )
}

// ---- Asset metadata detection ----
function detectAssetMeta(name: string, parser: BLPParser): { typeFlag: number; wasCompressed: boolean } {
  let typeFlag = 2 // default: blob
  let wasCompressed = false

  // Check if original exists in SHARED_DATA
  const origPath = sdIndex.get(name)
  if (origPath) {
    try {
      const info = readCivbigInfo(origPath)
      typeFlag = info.typeFlag
      const { data: origData } = readCivbig(origPath)
      wasCompressed = OodleDecompressor.isOodleCompressed(origData)
    } catch {
      // Fall through to type-based detection
    }
  }

  // Fallback: determine from BLP entry type
  if (!origPath) {
    for (const alloc of parser.iterEntriesByType('BLP::TextureEntry')) {
      const obj = parser.deserializeAlloc(alloc)
      if (obj.m_Name === name) { typeFlag = 1; wasCompressed = true; break }
    }
    for (const alloc of parser.iterEntriesByType('BLP::GpuBufferEntry')) {
      const obj = parser.deserializeAlloc(alloc)
      if (obj.m_Name === name) { typeFlag = 0; break }
    }
    for (const alloc of parser.iterEntriesByType('BLP::SoundBankEntry')) {
      const obj = parser.deserializeAlloc(alloc)
      if (obj.m_Name === name) { typeFlag = 3; break }
    }
  }

  return { typeFlag, wasCompressed }
}

// ---- IPC Handlers ----
function setupIPC() {
  ipcMain.handle('dialog:open-file', async (_e, filters) => {
    if (!mainWindow) return null
    const safeFilters = isValidFilters(filters) ? filters : []
    const result = await dialog.showOpenDialog(mainWindow, {
      filters: safeFilters,
      properties: ['openFile']
    })
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle('dialog:open-directory', async () => {
    if (!mainWindow) return null
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory']
    })
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle('blp:open', async (_e, filepath?: string) => {
    if (!isString(filepath)) return null

    try {
      const parser = new BLPParser(filepath)
      parser.parse()
      currentParser = parser
      replacements.clear()

      // Init SHARED_DATA from BLP path
      initSharedData(filepath)

      const assets = collectAssets(parser)

      // Update window title and recent files
      if (mainWindow) {
        mainWindow.setTitle(`BLP Studio - ${parser.filename}`)
      }
      addRecentFile(filepath)
      buildMenu()

      const typeCounts: Record<string, number> = {}
      for (const a of assets) {
        typeCounts[a.type] = (typeCounts[a.type] || 0) + 1
      }

      return {
        filename: parser.filename,
        filepath: parser.filepath,
        header: {
          magic: parser.header!.magic,
          version: parser.header!.version,
          packageDataOffset: parser.header!.packageDataOffset,
          bigDataOffset: parser.header!.bigDataOffset,
          bigDataCount: parser.header!.bigDataCount,
          fileSize: parser.header!.fileSize,
        },
        assets,
        typeCounts,
        sharedDataCount: sdIndex.size,
        oodleLoaded: oodle !== null,
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      const stack = e instanceof Error ? e.stack : undefined
      console.error('Failed to parse BLP:', msg)
      if (stack) console.error(stack)
      return { error: msg }
    }
  })

  ipcMain.handle('asset:preview', async (_e, name: string) => {
    if (!isString(name) || !currentParser) return null

    // Find the asset
    for (const alloc of currentParser.iterEntriesByType('BLP::TextureEntry')) {
      const obj = currentParser.deserializeAlloc(alloc)
      if (obj.m_Name !== name) continue

      const w = (obj.m_nWidth as number) || 0
      const h = (obj.m_nHeight as number) || 0
      const mips = (obj.m_nMips as number) || 1
      const fmt = (obj.m_eFormat as number) || 0

      // Cap preview size to prevent OOM on huge textures (RGBA8 = 4 bytes/pixel)
      const MAX_PREVIEW_PIXELS = 4096 * 4096  // 64MB RGBA limit
      if (w * h > MAX_PREVIEW_PIXELS) {
        return {
          name,
          width: w,
          height: h,
          mips,
          dxgiFormat: fmt,
          dxgiFormatName: dxgiName(fmt),
          rgbaPixels: null,
          tooLarge: true,
        }
      }

      const rawData = getTextureRawData(name, {
        width: w, height: h, mips, format: fmt
      })

      if (!rawData) return null

      try {
        // Decode BCn to RGBA for the first mip level only
        const rgbaPixels = decodeBCn(rawData, w, h, fmt)
        return {
          name,
          width: w,
          height: h,
          mips,
          dxgiFormat: fmt,
          dxgiFormatName: dxgiName(fmt),
          rgbaPixels,
        }
      } catch (e) {
        console.error(`Failed to decode texture ${name}:`, e)
        return null
      }
    }

    return null
  })

  ipcMain.handle('asset:extract', async (_e, name: string, outputDir: string) => {
    if (!isString(name) || !isString(outputDir) || !currentParser) return false

    try {
      // Find asset type
      for (const alloc of currentParser.iterEntriesByType('BLP::TextureEntry')) {
        const obj = currentParser.deserializeAlloc(alloc)
        if (obj.m_Name !== name) continue

        const w = (obj.m_nWidth as number) || 0
        const h = (obj.m_nHeight as number) || 0
        const mips = (obj.m_nMips as number) || 1
        const fmt = (obj.m_eFormat as number) || 0
        const rawSize = calcTextureSize(w, h, mips, fmt)

        const rawData = getTextureRawData(name, { width: w, height: h, mips, format: fmt })
        if (!rawData) return false

        const header = makeDdsHeader(w, h, mips, fmt)
        const ddsData = Buffer.concat([header, rawData.subarray(0, rawSize)])

        const safeName = name.replace(/[/\\]/g, '_')
        const outPath = join(outputDir, `${safeName}.dds`)
        writeFileSync(outPath, ddsData)
        return true
      }

      // Try blobs/gpu/sounds
      const civbigPath = sdIndex.get(name)
      if (civbigPath) {
        const { data } = readCivbig(civbigPath)
        let finalData = data
        if (OodleDecompressor.isOodleCompressed(data) && oodle) {
          const raw = oodle.decompress(data, data.length * 4) // estimate
          if (raw) finalData = raw
        }
        const ext = blobExtension(finalData, -1)
        const safeName = name.replace(/[/\\]/g, '_')
        const outPath = join(outputDir, `${safeName}${ext}`)
        writeFileSync(outPath, finalData)
        return true
      }
    } catch (e) {
      console.error(`Failed to extract ${name}:`, e)
    }

    return false
  })

  ipcMain.handle('asset:extract-all', async (_e, outputDir: string, _assetType: string) => {
    if (!isString(outputDir) || !currentParser) return { success: 0, failed: 0, skipped: 0 }

    let success = 0, failed = 0, skipped = 0

    // Count total assets for progress reporting
    const allAssets = collectAssets(currentParser)
    const total = allAssets.length
    let current = 0

    function sendProgress(name: string) {
      current++
      mainWindow?.webContents.send('progress', { current, total, name })
    }

    // Extract textures
    const texDir = join(outputDir, 'textures')
    if (!existsSync(texDir)) mkdirSync(texDir, { recursive: true })

    for (const alloc of currentParser.iterEntriesByType('BLP::TextureEntry')) {
      const obj = currentParser.deserializeAlloc(alloc)
      const name = obj.m_Name as string
      if (!name) continue

      sendProgress(name)

      const w = (obj.m_nWidth as number) || 0
      const h = (obj.m_nHeight as number) || 0
      const mips = (obj.m_nMips as number) || 1
      const fmt = (obj.m_eFormat as number) || 0
      const rawSize = calcTextureSize(w, h, mips, fmt)

      const rawData = getTextureRawData(name, { width: w, height: h, mips, format: fmt })
      if (!rawData) { skipped++; continue }

      try {
        const header = makeDdsHeader(w, h, mips, fmt)
        let pixelData = rawData.subarray(0, rawSize)
        if (pixelData.length < rawSize) {
          pixelData = Buffer.concat([pixelData, Buffer.alloc(rawSize - pixelData.length)])
        }
        const safeName = name.replace(/[/\\]/g, '_')
        writeFileSync(join(texDir, `${safeName}.dds`), Buffer.concat([header, pixelData]))
        success++
      } catch {
        failed++
      }
    }

    // Extract blobs, gpu, sounds
    for (const typeName of ['BLP::BlobEntry', 'BLP::GpuBufferEntry', 'BLP::SoundBankEntry']) {
      const subdir = typeName.includes('Blob') ? 'blobs' :
                     typeName.includes('Gpu') ? 'gpu' : 'sounds'
      const dir = join(outputDir, subdir)
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

      for (const alloc of currentParser.iterEntriesByType(typeName)) {
        const obj = currentParser.deserializeAlloc(alloc)
        const name = obj.m_Name as string
        if (!name) continue

        sendProgress(name)

        const civbigPath = sdIndex.get(name)
        if (!civbigPath) { skipped++; continue }

        try {
          const { data } = readCivbig(civbigPath)
          let finalData = data
          if (OodleDecompressor.isOodleCompressed(data) && oodle) {
            const storedSize = (obj.m_nSize as number) || data.length
            const raw = oodle.decompress(data, storedSize)
            if (raw) finalData = raw
          }
          const blobType = (obj.m_nBlobType as number) ?? -1
          const ext = blobExtension(finalData, blobType)
          const safeName = name.replace(/[/\\]/g, '_')
          writeFileSync(join(dir, `${safeName}${ext}`), finalData)
          success++
        } catch {
          failed++
        }
      }
    }

    mainWindow?.webContents.send('progress', null)
    return { success, failed, skipped }
  })

  ipcMain.handle('asset:data', async (_e, name: string) => {
    if (!isString(name) || !currentParser) return null

    // Determine asset type and get metadata
    let blobType = -1
    let storedSize = 0

    // Check textures first (for size calculation)
    for (const alloc of currentParser.iterEntriesByType('BLP::TextureEntry')) {
      const obj = currentParser.deserializeAlloc(alloc)
      if (obj.m_Name !== name) continue
      const w = (obj.m_nWidth as number) || 0
      const h = (obj.m_nHeight as number) || 0
      const mips = (obj.m_nMips as number) || 1
      const fmt = (obj.m_eFormat as number) || 0
      storedSize = calcTextureSize(w, h, mips, fmt)
      break
    }

    // Check blobs/gpu/sounds
    if (storedSize === 0) {
      for (const typeName of ['BLP::BlobEntry', 'BLP::GpuBufferEntry', 'BLP::SoundBankEntry']) {
        for (const alloc of currentParser.iterEntriesByType(typeName)) {
          const obj = currentParser.deserializeAlloc(alloc)
          if (obj.m_Name !== name) continue
          storedSize = (obj.m_nSize as number) || 0
          if (typeName === 'BLP::BlobEntry') {
            blobType = (obj.m_nBlobType as number) ?? -1
          }
          break
        }
        if (storedSize > 0) break
      }
    }

    const civbigPath = sdIndex.get(name)
    if (!civbigPath) return null

    try {
      const { data, typeFlags } = readCivbig(civbigPath)
      let finalData = data
      if (OodleDecompressor.isOodleCompressed(data) && oodle) {
        const rawSize = storedSize || data.length * 4
        const raw = oodle.decompress(data, rawSize)
        if (raw) finalData = raw
      }
      // Limit preview data to 256KB to keep IPC fast
      const previewLimit = 256 * 1024
      const truncated = finalData.length > previewLimit
      const previewData = truncated ? finalData.subarray(0, previewLimit) : finalData
      return {
        data: previewData,
        totalSize: finalData.length,
        truncated,
        blobType,
        typeFlags,
      }
    } catch (e) {
      console.error(`Failed to read asset data for ${name}:`, e)
      return null
    }
  })

  ipcMain.handle('asset:replace', async (_e, name: string) => {
    if (!isString(name) || !currentParser) return null
    if (!mainWindow) return null

    // Determine appropriate file filters based on asset type
    let assetType = ''
    for (const alloc of currentParser.iterEntriesByType('BLP::TextureEntry')) {
      const obj = currentParser.deserializeAlloc(alloc)
      if (obj.m_Name === name) { assetType = 'texture'; break }
    }
    if (!assetType) {
      for (const typeName of ['BLP::BlobEntry', 'BLP::GpuBufferEntry', 'BLP::SoundBankEntry']) {
        for (const alloc of currentParser.iterEntriesByType(typeName)) {
          const obj = currentParser.deserializeAlloc(alloc)
          if (obj.m_Name === name) {
            assetType = typeName.includes('Blob') ? 'blob' :
                       typeName.includes('Gpu') ? 'gpu' : 'sound'
            break
          }
        }
        if (assetType) break
      }
    }

    const filters = assetType === 'texture'
      ? [{ name: 'DDS Texture', extensions: ['dds'] }, { name: 'All Files', extensions: ['*'] }]
      : [{ name: 'All Files', extensions: ['*'] }]

    const result = await dialog.showOpenDialog(mainWindow, {
      title: `Replace asset: ${name}`,
      filters,
      properties: ['openFile'],
    })
    if (result.canceled || !result.filePaths[0]) return null

    try {
      let data = readFileSync(result.filePaths[0])
      let ddsInfo: ReplacementData['ddsInfo'] = undefined

      // For DDS textures, parse header info then strip it
      if (assetType === 'texture' && data.length > 148) {
        const magic = data.readUInt32LE(0)
        if (magic === 0x20534444) { // 'DDS '
          // Parse DDS header fields
          const ddsHeight = data.readUInt32LE(12)
          const ddsWidth = data.readUInt32LE(16)
          const ddsMipCount = data.readUInt32LE(28) || 1
          const fourCC = data.subarray(84, 88).toString('ascii')
          const headerSize = fourCC === 'DX10' ? 148 : 128
          let ddsFormat = 0
          if (fourCC === 'DX10') {
            ddsFormat = data.readUInt32LE(128) // DXGI_FORMAT in DX10 extension
          }
          ddsInfo = {
            width: ddsWidth,
            height: ddsHeight,
            format: ddsFormat,
            mips: ddsMipCount,
            formatName: dxgiName(ddsFormat),
          }
          data = data.subarray(headerSize)
        }
      }

      replacements.set(name, { data, ddsInfo })
      console.log(`Replacement queued: ${name} (${data.length} bytes)`)
      return {
        name,
        size: data.length,
        sourcePath: result.filePaths[0],
        ddsInfo,
      }
    } catch (e) {
      console.error(`Failed to read replacement file:`, e)
      return null
    }
  })

  ipcMain.handle('asset:clear-replacement', async (_e, name: string) => {
    if (!isString(name)) return false
    return replacements.delete(name)
  })

  ipcMain.handle('asset:get-replacements', async () => {
    const result: { name: string; size: number }[] = []
    for (const [name, rep] of replacements) {
      result.push({ name, size: rep.data.length })
    }
    return result
  })

  ipcMain.handle('blp:save-replacements', async (_e, outputDir?: string) => {
    if (!currentParser || replacements.size === 0) return { success: 0, failed: 0 }

    // If no dir provided, prompt user
    let targetDir = outputDir
    if (!isString(targetDir)) {
      if (!mainWindow) return { success: 0, failed: 0 }
      const result = await dialog.showOpenDialog(mainWindow, {
        title: 'Select output directory for modified assets',
        properties: ['openDirectory', 'createDirectory'],
      })
      if (result.canceled || !result.filePaths[0]) return { success: 0, failed: 0 }
      targetDir = result.filePaths[0]
    }

    // Create SHARED_DATA subdirectory
    const sdDir = join(targetDir, 'SHARED_DATA')
    if (!existsSync(sdDir)) mkdirSync(sdDir, { recursive: true })

    let success = 0
    let failed = 0
    const total = replacements.size
    let current = 0

    const compMode = loadPreferences().compressionMode
    for (const [name, rep] of replacements) {
      current++
      mainWindow?.webContents.send('progress', { current, total, name })

      try {
        const { typeFlag, wasCompressed } = detectAssetMeta(name, currentParser)

        // Compress based on preference: auto = match original, always = force, never = skip
        const shouldCompress = compMode === 'always' || (compMode === 'auto' && wasCompressed)
        let writeData = rep.data
        if (shouldCompress && oodle) {
          const compressed = oodle.compress(rep.data)
          if (compressed && compressed.length < rep.data.length) {
            writeData = compressed
            console.log(`  Compressed ${name}: ${rep.data.length} -> ${compressed.length} (${((1 - compressed.length / rep.data.length) * 100).toFixed(1)}% reduction)`)
          }
        }

        writeCivbig(join(sdDir, name), writeData, typeFlag)
        success++
      } catch (e) {
        console.error(`Failed to write replacement for ${name}:`, e)
        failed++
      }
    }

    mainWindow?.webContents.send('progress', null)
    console.log(`Saved ${success} replacements to ${sdDir}`)
    return { success, failed }
  })

  // ---- Install to Game: overwrite CIVBIG files in SHARED_DATA with backups ----
  ipcMain.handle('blp:install-to-game', async () => {
    if (!currentParser || replacements.size === 0) return { success: 0, failed: 0, errors: [] }

    let success = 0
    let failed = 0
    const errors: string[] = []
    const total = replacements.size
    let current = 0

    const compMode = loadPreferences().compressionMode
    for (const [name, rep] of replacements) {
      current++
      mainWindow?.webContents.send('progress', { current, total, name })

      try {
        const origPath = sdIndex.get(name)
        if (!origPath) {
          errors.push(`${name}: not found in SHARED_DATA`)
          failed++
          continue
        }

        // Create backup if it doesn't exist yet
        const bakPath = origPath + '.blpstudio.bak'
        if (!existsSync(bakPath)) {
          copyFileSync(origPath, bakPath)
          console.log(`  Backup: ${origPath} -> .bak`)
        }

        // Detect original typeFlag and compression
        const { typeFlag, wasCompressed } = detectAssetMeta(name, currentParser)

        // Compress based on preference
        const shouldCompress = compMode === 'always' || (compMode === 'auto' && wasCompressed)
        let writeData = rep.data
        if (shouldCompress && oodle) {
          const compressed = oodle.compress(rep.data)
          if (compressed && compressed.length < rep.data.length) {
            writeData = compressed
            console.log(`  Compressed ${name}: ${rep.data.length} -> ${compressed.length}`)
          }
        }

        writeCivbig(origPath, writeData, typeFlag)
        console.log(`  Installed: ${name} (${writeData.length} bytes)`)
        success++
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        errors.push(`${name}: ${msg}`)
        console.error(`Failed to install ${name}:`, e)
        failed++
      }
    }

    mainWindow?.webContents.send('progress', null)
    console.log(`Install to game: ${success} ok, ${failed} failed`)
    return { success, failed, errors }
  })

  // ---- Restore Backups: revert all .blpstudio.bak files ----
  ipcMain.handle('blp:restore-backups', async () => {
    let restored = 0
    let failed = 0

    for (const dir of sdDirs) {
      try {
        const files = readdirSync(dir)
        for (const f of files) {
          if (!f.endsWith('.blpstudio.bak')) continue
          const bakPath = join(dir, f)
          const origPath = join(dir, f.replace('.blpstudio.bak', ''))
          try {
            copyFileSync(bakPath, origPath)
            unlinkSync(bakPath)
            restored++
            console.log(`  Restored: ${origPath}`)
          } catch (e) {
            console.error(`Failed to restore ${bakPath}:`, e)
            failed++
          }
        }
      } catch (e) {
        console.error(`Failed to scan ${dir} for backups:`, e)
      }
    }

    console.log(`Restore backups: ${restored} restored, ${failed} failed`)
    return { restored, failed }
  })

  // ---- Backup Count: count .blpstudio.bak files ----
  ipcMain.handle('blp:backup-count', async () => {
    let count = 0
    for (const dir of sdDirs) {
      try {
        const files = readdirSync(dir)
        for (const f of files) {
          if (f.endsWith('.blpstudio.bak')) count++
        }
      } catch {
        // Directory may not exist
      }
    }
    return count
  })

  // ---- Export as Mod: create proper mod folder structure ----
  ipcMain.handle('blp:export-as-mod', async () => {
    if (!currentParser || replacements.size === 0) return { success: 0, failed: 0 }
    if (!mainWindow) return { success: 0, failed: 0 }

    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Select or create a folder for the mod',
      properties: ['openDirectory', 'createDirectory'],
    })
    if (result.canceled || !result.filePaths[0]) return { success: 0, failed: 0 }

    const modDir = result.filePaths[0]
    const folderName = modDir.split(/[/\\]/).pop() || 'blp-studio-mod'
    const modId = sanitizeModId(folderName)
    const modName = folderName

    // Create directory structure
    const sdDir = join(modDir, 'Platforms', 'Windows', 'BLPs', 'SHARED_DATA')
    if (!existsSync(sdDir)) mkdirSync(sdDir, { recursive: true })

    // Write modinfo and dep files
    writeFileSync(join(modDir, `${modId}.modinfo`), generateModinfo(modId, modName), 'utf-8')
    writeFileSync(join(modDir, `${modId}.dep`), generateDep(modId), 'utf-8')

    // Write CIVBIG files
    let success = 0
    let failed = 0
    const total = replacements.size
    let current = 0
    const compMode = loadPreferences().compressionMode

    for (const [name, rep] of replacements) {
      current++
      mainWindow?.webContents.send('progress', { current, total, name })

      try {
        const { typeFlag, wasCompressed } = detectAssetMeta(name, currentParser)

        const shouldCompress = compMode === 'always' || (compMode === 'auto' && wasCompressed)
        let writeData = rep.data
        if (shouldCompress && oodle) {
          const compressed = oodle.compress(rep.data)
          if (compressed && compressed.length < rep.data.length) {
            writeData = compressed
            console.log(`  Compressed ${name}: ${rep.data.length} -> ${compressed.length}`)
          }
        }

        writeCivbig(join(sdDir, name), writeData, typeFlag)
        success++
      } catch (e) {
        console.error(`Failed to write replacement for ${name}:`, e)
        failed++
      }
    }

    mainWindow?.webContents.send('progress', null)
    console.log(`Exported mod "${modId}" to ${modDir}: ${success} assets`)
    return { success, failed, modDir, modId }
  })

  ipcMain.handle('app:status', async () => {
    return {
      oodleLoaded: oodle !== null,
      sharedDataDirs: sdDirs.length,
      sharedDataFiles: sdIndex.size,
      sharedDataPaths: sdDirs,
      gameRoot,
      gameDetected: gameRoot !== null && sdDirs.length > 0,
      replacementCount: replacements.size,
    }
  })

  ipcMain.handle('app:open-folder', async (_e, folderPath: string) => {
    if (!isString(folderPath)) return
    shell.openPath(folderPath)
  })

  ipcMain.handle('pref:get', async () => {
    return loadPreferences()
  })

  ipcMain.handle('pref:set-theme', async (_e, theme: string) => {
    if (theme !== 'dark' && theme !== 'light') return
    setTheme(theme)
    buildMenu()
  })

  ipcMain.handle('pref:update', async (_e, prefs: Record<string, unknown>) => {
    if (!prefs || typeof prefs !== 'object') return
    updatePreferences(prefs as Parameters<typeof updatePreferences>[0])
    // If theme changed, rebuild menu to update label
    if ('theme' in prefs) buildMenu()
  })

  ipcMain.handle('app:version', async () => {
    return app.getVersion()
  })

  // ---- DDS Viewer ----
  ipcMain.handle('dds:open', async (_e, filepath?: string) => {
    let ddsPath = filepath
    if (!isString(ddsPath)) {
      if (!mainWindow) return null
      const result = await dialog.showOpenDialog(mainWindow, {
        title: 'Open DDS File',
        filters: [
          { name: 'DDS Textures', extensions: ['dds'] },
          { name: 'All Files', extensions: ['*'] },
        ],
        properties: ['openFile'],
      })
      if (result.canceled || !result.filePaths[0]) return null
      ddsPath = result.filePaths[0]
    }

    try {
      const fileData = readFileSync(ddsPath)
      if (fileData.length < 128 || fileData.readUInt32LE(0) !== 0x20534444) {
        return { error: 'Not a valid DDS file' }
      }

      const height = fileData.readUInt32LE(12)
      const width = fileData.readUInt32LE(16)
      const mipCount = fileData.readUInt32LE(28) || 1
      const fourCC = fileData.subarray(84, 88).toString('ascii')
      const headerSize = fourCC === 'DX10' ? 148 : 128
      let dxgiFormat = 0

      if (fourCC === 'DX10' && fileData.length >= 148) {
        dxgiFormat = fileData.readUInt32LE(128)
      } else {
        // Legacy DDS without DX10 header — try to detect from fourCC
        if (fourCC === 'DXT1') dxgiFormat = 71
        else if (fourCC === 'DXT3') dxgiFormat = 74
        else if (fourCC === 'DXT5') dxgiFormat = 77
        else if (fourCC === 'ATI1') dxgiFormat = 80
        else if (fourCC === 'ATI2') dxgiFormat = 83
      }

      const pixelData = fileData.subarray(headerSize)
      const rgbaPixels = decodeBCn(pixelData as Buffer, width, height, dxgiFormat)

      return {
        filepath: ddsPath,
        filename: ddsPath.split(/[/\\]/).pop() || 'unknown.dds',
        width,
        height,
        mips: mipCount,
        dxgiFormat,
        dxgiFormatName: dxgiName(dxgiFormat),
        fileSize: fileData.length,
        headerSize,
        rgbaPixels,
      }
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('dds:get-mip', async (_e, filepath: string, mipLevel: number) => {
    if (!isString(filepath) || typeof mipLevel !== 'number') return null

    try {
      const fileData = readFileSync(filepath)
      if (fileData.length < 128 || fileData.readUInt32LE(0) !== 0x20534444) return null

      const height = fileData.readUInt32LE(12)
      const width = fileData.readUInt32LE(16)
      const mipCount = fileData.readUInt32LE(28) || 1
      const fourCC = fileData.subarray(84, 88).toString('ascii')
      const headerSize = fourCC === 'DX10' ? 148 : 128
      let dxgiFormat = 0

      if (fourCC === 'DX10' && fileData.length >= 148) {
        dxgiFormat = fileData.readUInt32LE(128)
      } else {
        if (fourCC === 'DXT1') dxgiFormat = 71
        else if (fourCC === 'DXT3') dxgiFormat = 74
        else if (fourCC === 'DXT5') dxgiFormat = 77
        else if (fourCC === 'ATI1') dxgiFormat = 80
        else if (fourCC === 'ATI2') dxgiFormat = 83
      }

      if (mipLevel < 0 || mipLevel >= mipCount) return null

      // Calculate offset to the requested mip level
      let mipOffset = 0
      let mw = width, mh = height
      for (let m = 0; m < mipLevel; m++) {
        mipOffset += calcMipSize(mw, mh, dxgiFormat)
        mw = Math.max(1, mw >> 1)
        mh = Math.max(1, mh >> 1)
      }

      const pixelData = fileData.subarray(headerSize + mipOffset)
      const rgbaPixels = decodeBCn(pixelData as Buffer, mw, mh, dxgiFormat)

      return { width: mw, height: mh, mipLevel, rgbaPixels }
    } catch {
      return null
    }
  })

  ipcMain.handle('dds:export', async (_e, rgbaPixels: Uint8Array, width: number, height: number, format: string, quality?: number) => {
    if (!mainWindow || !rgbaPixels || !width || !height) return null

    const filters = format === 'jpg'
      ? [{ name: 'JPEG Image', extensions: ['jpg', 'jpeg'] }]
      : [{ name: 'PNG Image', extensions: ['png'] }]

    const result = await dialog.showSaveDialog(mainWindow, {
      title: `Export as ${format.toUpperCase()}`,
      filters,
    })
    if (result.canceled || !result.filePath) return null

    try {
      // nativeImage.createFromBitmap expects BGRA on Windows — swap R and B
      const bgraPixels = Buffer.from(rgbaPixels)
      for (let i = 0; i < bgraPixels.length; i += 4) {
        const r = bgraPixels[i]
        bgraPixels[i] = bgraPixels[i + 2]
        bgraPixels[i + 2] = r
      }
      const img = nativeImage.createFromBitmap(bgraPixels, { width, height })
      const outData = format === 'jpg'
        ? img.toJPEG(quality || 90)
        : img.toPNG()
      writeFileSync(result.filePath, outData)
      return { filepath: result.filePath, size: outData.length }
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
    }
  })

  // ---- Batch DDS Export ----
  ipcMain.handle('dds:batch-export', async (_e, sourceDir: string, outputDir: string, format: string, quality?: number) => {
    if (!isString(sourceDir) || !isString(outputDir)) {
      return { success: 0, failed: 0, errors: ['Invalid source or output directory'] }
    }
    if (format !== 'png' && format !== 'jpg') {
      return { success: 0, failed: 0, errors: ['Invalid format: must be png or jpg'] }
    }

    if (!existsSync(outputDir)) {
      mkdirSync(outputDir, { recursive: true })
    }

    // Collect all .dds files from sourceDir
    let allFiles: string[]
    try {
      allFiles = readdirSync(sourceDir).filter(f => f.toLowerCase().endsWith('.dds'))
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return { success: 0, failed: 0, errors: [`Failed to read source directory: ${msg}`] }
    }

    if (allFiles.length === 0) {
      return { success: 0, failed: 0, errors: ['No .dds files found in source directory'] }
    }

    const total = allFiles.length
    let success = 0
    let failed = 0
    const errors: string[] = []

    for (let i = 0; i < allFiles.length; i++) {
      const filename = allFiles[i]
      const filepath = join(sourceDir, filename)

      mainWindow?.webContents.send('progress', { current: i + 1, total, name: filename })

      try {
        const fileData = readFileSync(filepath)
        if (fileData.length < 128 || fileData.readUInt32LE(0) !== 0x20534444) {
          errors.push(`${filename}: not a valid DDS file`)
          failed++
          continue
        }

        const height = fileData.readUInt32LE(12)
        const width = fileData.readUInt32LE(16)
        const fourCC = fileData.subarray(84, 88).toString('ascii')
        const headerSize = fourCC === 'DX10' ? 148 : 128
        let dxgiFormat = 0

        if (fourCC === 'DX10' && fileData.length >= 148) {
          dxgiFormat = fileData.readUInt32LE(128)
        } else {
          if (fourCC === 'DXT1') dxgiFormat = 71
          else if (fourCC === 'DXT3') dxgiFormat = 74
          else if (fourCC === 'DXT5') dxgiFormat = 77
          else if (fourCC === 'ATI1') dxgiFormat = 80
          else if (fourCC === 'ATI2') dxgiFormat = 83
        }

        // Decode mip 0 to RGBA
        const pixelData = fileData.subarray(headerSize)
        const rgbaPixels = decodeBCn(pixelData as Buffer, width, height, dxgiFormat)

        // nativeImage.createFromBitmap expects BGRA on Windows — swap R and B
        const bgraPixels = Buffer.from(rgbaPixels)
        for (let j = 0; j < bgraPixels.length; j += 4) {
          const r = bgraPixels[j]
          bgraPixels[j] = bgraPixels[j + 2]
          bgraPixels[j + 2] = r
        }
        const img = nativeImage.createFromBitmap(bgraPixels, { width, height })
        const outData = format === 'jpg'
          ? img.toJPEG(quality || 90)
          : img.toPNG()

        const baseName = filename.replace(/\.dds$/i, '')
        const ext = format === 'jpg' ? '.jpg' : '.png'
        writeFileSync(join(outputDir, baseName + ext), outData)
        success++
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        errors.push(`${filename}: ${msg}`)
        failed++
      }
    }

    mainWindow?.webContents.send('progress', null)
    return { success, failed, errors }
  })

  // ---- Open DDS in new window ----
  ipcMain.handle('dds:open-window', async (_e, filepath: string) => {
    if (!isString(filepath)) return
    createDDSWindow(filepath)
  })

  // ---- Extract texture to temp DDS file (for opening BLP textures in DDS viewer) ----
  ipcMain.handle('asset:extract-temp-dds', async (_e, name: string) => {
    if (!isString(name) || !currentParser) return null

    for (const alloc of currentParser.iterEntriesByType('BLP::TextureEntry')) {
      const obj = currentParser.deserializeAlloc(alloc)
      if (obj.m_Name !== name) continue

      const w = (obj.m_nWidth as number) || 0
      const h = (obj.m_nHeight as number) || 0
      const mips = (obj.m_nMips as number) || 1
      const fmt = (obj.m_eFormat as number) || 0
      const rawSize = calcTextureSize(w, h, mips, fmt)

      const rawData = getTextureRawData(name, { width: w, height: h, mips, format: fmt })
      if (!rawData) return null

      const header = makeDdsHeader(w, h, mips, fmt)
      let pixelData = rawData.subarray(0, rawSize)
      if (pixelData.length < rawSize) {
        pixelData = Buffer.concat([pixelData, Buffer.alloc(rawSize - pixelData.length)])
      }

      const tempDir = join(tmpdir(), 'blp-studio')
      if (!existsSync(tempDir)) mkdirSync(tempDir, { recursive: true })
      const safeName = name.replace(/[/\\]/g, '_')
      const tempPath = join(tempDir, `${safeName}.dds`)
      writeFileSync(tempPath, Buffer.concat([header, pixelData]))
      return tempPath
    }

    return null
  })

  // ---- Export texture directly to PNG/JPG ----
  ipcMain.handle('asset:export-as-image', async (_e, name: string, format: string, quality?: number) => {
    if (!isString(name) || !currentParser || !mainWindow) return null
    if (format !== 'png' && format !== 'jpg') return null

    for (const alloc of currentParser.iterEntriesByType('BLP::TextureEntry')) {
      const obj = currentParser.deserializeAlloc(alloc)
      if (obj.m_Name !== name) continue

      const w = (obj.m_nWidth as number) || 0
      const h = (obj.m_nHeight as number) || 0
      const mips = (obj.m_nMips as number) || 1
      const fmt = (obj.m_eFormat as number) || 0

      const rawData = getTextureRawData(name, { width: w, height: h, mips, format: fmt })
      if (!rawData) return { error: 'Texture data not found' }

      const rgbaPixels = decodeBCn(rawData, w, h, fmt)

      const filters = format === 'jpg'
        ? [{ name: 'JPEG Image', extensions: ['jpg', 'jpeg'] }]
        : [{ name: 'PNG Image', extensions: ['png'] }]

      const safeName = name.replace(/[/\\]/g, '_')
      const result = await dialog.showSaveDialog(mainWindow, {
        title: `Export ${name} as ${format.toUpperCase()}`,
        defaultPath: `${safeName}.${format}`,
        filters,
      })
      if (result.canceled || !result.filePath) return null

      // RGBA → BGRA for nativeImage
      const bgraPixels = Buffer.from(rgbaPixels)
      for (let i = 0; i < bgraPixels.length; i += 4) {
        const r = bgraPixels[i]
        bgraPixels[i] = bgraPixels[i + 2]
        bgraPixels[i + 2] = r
      }
      const img = nativeImage.createFromBitmap(bgraPixels, { width: w, height: h })
      const outData = format === 'jpg' ? img.toJPEG(quality || 90) : img.toPNG()
      writeFileSync(result.filePath, outData)
      return { filepath: result.filePath, size: outData.length }
    }

    return { error: 'Texture not found' }
  })

  // ---- Copy preview image to clipboard as PNG ----
  ipcMain.handle('preview:copy-as-png', async (_e, rgbaPixels: Uint8Array, width: number, height: number) => {
    if (!rgbaPixels || !width || !height) return false

    try {
      // RGBA → BGRA for nativeImage
      const bgraPixels = Buffer.from(rgbaPixels)
      for (let i = 0; i < bgraPixels.length; i += 4) {
        const r = bgraPixels[i]
        bgraPixels[i] = bgraPixels[i + 2]
        bgraPixels[i + 2] = r
      }
      const img = nativeImage.createFromBitmap(bgraPixels, { width, height })
      clipboard.writeImage(img)
      return true
    } catch (e) {
      console.error('Failed to copy image to clipboard:', e)
      return false
    }
  })
}

// ---- App lifecycle ----
app.whenReady().then(() => {
  initPreferences(app.getPath('userData'))
  initOodle()
  initSharedData()
  setupIPC()
  buildMenu()
  createWindow()
})

app.on('window-all-closed', () => {
  app.quit()
})
