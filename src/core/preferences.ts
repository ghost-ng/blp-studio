/**
 * User preferences storage.
 * Persists settings as JSON in the app's userData directory.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'

export interface Preferences {
  theme: 'dark' | 'light'
  recentFiles: string[]
  defaultExportFormat: 'png' | 'jpg'
  jpgQuality: number
  ddsDefaultBackground: 'checkerboard' | 'black' | 'white'
  compressionMode: 'auto' | 'always' | 'never'
}

const MAX_RECENT = 10

const defaults: Preferences = {
  theme: 'dark',
  recentFiles: [],
  defaultExportFormat: 'png',
  jpgQuality: 90,
  ddsDefaultBackground: 'checkerboard',
  compressionMode: 'auto',
}

let prefsPath = ''
let cached: Preferences | null = null

/** Initialize with the app's userData directory. Must be called after app.ready. */
export function initPreferences(userDataPath: string): void {
  prefsPath = join(userDataPath, 'preferences.json')
}

export function loadPreferences(): Preferences {
  if (cached) return cached

  if (!prefsPath) return { ...defaults }

  try {
    if (existsSync(prefsPath)) {
      const raw = JSON.parse(readFileSync(prefsPath, 'utf-8'))
      cached = {
        theme: raw.theme === 'light' ? 'light' : 'dark',
        recentFiles: Array.isArray(raw.recentFiles)
          ? raw.recentFiles.filter((f: unknown) => typeof f === 'string').slice(0, MAX_RECENT)
          : [],
        defaultExportFormat: raw.defaultExportFormat === 'jpg' ? 'jpg' : 'png',
        jpgQuality: typeof raw.jpgQuality === 'number' ? Math.max(10, Math.min(100, raw.jpgQuality)) : 90,
        ddsDefaultBackground: ['checkerboard', 'black', 'white'].includes(raw.ddsDefaultBackground) ? raw.ddsDefaultBackground : 'checkerboard',
        compressionMode: ['auto', 'always', 'never'].includes(raw.compressionMode) ? raw.compressionMode : 'auto',
      }
      return cached
    }
  } catch {
    // Corrupt file — reset
  }

  cached = { ...defaults }
  return cached
}

function save(): void {
  if (!prefsPath || !cached) return
  try {
    const dir = dirname(prefsPath)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    writeFileSync(prefsPath, JSON.stringify(cached, null, 2), 'utf-8')
  } catch (e) {
    console.error('Failed to save preferences:', e)
  }
}

export function setTheme(theme: 'dark' | 'light'): void {
  const prefs = loadPreferences()
  prefs.theme = theme
  save()
}

export function updatePreferences(partial: Partial<Preferences>): void {
  const prefs = loadPreferences()
  if (partial.theme !== undefined) prefs.theme = partial.theme
  if (partial.defaultExportFormat !== undefined) prefs.defaultExportFormat = partial.defaultExportFormat
  if (partial.jpgQuality !== undefined) prefs.jpgQuality = Math.max(10, Math.min(100, partial.jpgQuality))
  if (partial.ddsDefaultBackground !== undefined) prefs.ddsDefaultBackground = partial.ddsDefaultBackground
  if (partial.compressionMode !== undefined) prefs.compressionMode = partial.compressionMode
  save()
}

export function clearRecentFiles(): void {
  const prefs = loadPreferences()
  prefs.recentFiles = []
  save()
}

export function addRecentFile(filepath: string): string[] {
  const prefs = loadPreferences()
  // Remove if already present, then prepend
  prefs.recentFiles = prefs.recentFiles.filter(f => f !== filepath)
  prefs.recentFiles.unshift(filepath)
  if (prefs.recentFiles.length > MAX_RECENT) {
    prefs.recentFiles = prefs.recentFiles.slice(0, MAX_RECENT)
  }
  save()
  return prefs.recentFiles
}
