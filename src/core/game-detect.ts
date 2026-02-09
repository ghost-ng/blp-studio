/**
 * Civilization VII installation detection
 *
 * Scans common Steam library locations across drives C-F for the
 * game installation, locates SHARED_DATA directories (Base + DLC),
 * and finds the Oodle decompression DLL.
 */

import { existsSync, readdirSync, statSync } from 'fs';
import { join, dirname, sep } from 'path';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GAME_FOLDER_NAME = "Sid Meier's Civilization VII";
const OODLE_DLL = 'oo2core_9_win64.dll';

const DRIVE_LETTERS = ['C', 'D', 'E', 'F'];

const STEAM_SUFFIXES = [
  'Program Files (x86)\\Steam\\steamapps\\common',
  'Program Files\\Steam\\steamapps\\common',
  'SteamLibrary\\steamapps\\common',
];

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Build the list of Steam common directories to probe across all
 * configured drive letters and path suffixes.
 */
function steamCommonDirs(): string[] {
  const dirs: string[] = [];
  for (const drive of DRIVE_LETTERS) {
    for (const suffix of STEAM_SUFFIXES) {
      dirs.push(`${drive}:\\${suffix}`);
    }
  }
  return dirs;
}

/**
 * List immediate subdirectories of `dir`. Returns an empty array if the
 * directory does not exist or is not readable.
 */
function listSubdirs(dir: string): string[] {
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => join(dir, e.name));
  } catch {
    return [];
  }
}

/**
 * Safely check whether `p` exists and is a directory.
 */
function isDir(p: string): boolean {
  try {
    return existsSync(p) && statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Safely check whether `p` exists and is a regular file.
 */
function isFile(p: string): boolean {
  try {
    return existsSync(p) && statSync(p).isFile();
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Search common Steam library directories for the Civilization VII
 * installation folder.
 *
 * @returns The full path to the game root, or null if not found.
 */
export function findGameRoot(): string | null {
  for (const commonDir of steamCommonDirs()) {
    const candidate = join(commonDir, GAME_FOLDER_NAME);
    if (isDir(candidate)) {
      return candidate;
    }
  }
  return null;
}

/**
 * Given a game root directory, find all SHARED_DATA directories.
 *
 * These appear in two patterns:
 *   - Base content:  <gameRoot>/<module>/Platforms/Windows/BLPs/SHARED_DATA
 *   - DLC content:   <gameRoot>/DLC/<dlc>/Platforms/Windows/BLPs/SHARED_DATA
 *
 * @returns Array of absolute paths to SHARED_DATA directories.
 */
export function findAllSharedData(gameRoot: string): string[] {
  const results: string[] = [];
  const tail = join('Platforms', 'Windows', 'BLPs', 'SHARED_DATA');

  // Base modules (immediate children of gameRoot)
  for (const sub of listSubdirs(gameRoot)) {
    const candidate = join(sub, tail);
    if (isDir(candidate)) {
      results.push(candidate);
    }
  }

  // DLC modules
  const dlcRoot = join(gameRoot, 'DLC');
  for (const dlcSub of listSubdirs(dlcRoot)) {
    const candidate = join(dlcSub, tail);
    if (isDir(candidate)) {
      results.push(candidate);
    }
  }

  return results;
}

/**
 * Convenience: find the game root then enumerate all SHARED_DATA
 * directories. Returns an empty array if the game is not found.
 */
export function findSharedDataCandidates(): string[] {
  const root = findGameRoot();
  if (!root) return [];
  return findAllSharedData(root);
}

/**
 * Search for the Oodle DLL (oo2core_9_win64.dll) in several locations:
 *   1. The Electron app's own directory (process.cwd() / app resources)
 *   2. The current working directory
 *   3. Beside the game executable in every Steam common directory
 *
 * @returns Array of absolute paths where the DLL was found.
 */
export function findOodleCandidates(): string[] {
  const found: string[] = [];
  const seen = new Set<string>();

  const addIfExists = (p: string): void => {
    const normalized = p.toLowerCase();
    if (seen.has(normalized)) return;
    if (isFile(p)) {
      seen.add(normalized);
      found.push(p);
    }
  };

  // App directory (where the Electron binary lives)
  if (typeof process !== 'undefined') {
    if (process.resourcesPath) {
      addIfExists(join(process.resourcesPath, OODLE_DLL));
      addIfExists(join(process.resourcesPath, 'resources', OODLE_DLL));
    }
    // Dev mode: check project resources folder
    addIfExists(join(process.cwd(), 'resources', OODLE_DLL));
    addIfExists(join(process.cwd(), OODLE_DLL));
    // Also check app.getAppPath() parent/resources in development
    try {
      const { app } = require('electron');
      if (app) {
        addIfExists(join(app.getAppPath(), 'resources', OODLE_DLL));
        addIfExists(join(app.getAppPath(), '..', 'resources', OODLE_DLL));
      }
    } catch { /* not in main process */ }
  }

  // Steam game installations -- the DLL typically lives in the game
  // root or a Binaries subfolder
  for (const commonDir of steamCommonDirs()) {
    const gameDir = join(commonDir, GAME_FOLDER_NAME);
    if (!isDir(gameDir)) continue;

    // Root
    addIfExists(join(gameDir, OODLE_DLL));

    // Common binary subdirectories
    addIfExists(join(gameDir, 'Binaries', 'Win64', OODLE_DLL));
    addIfExists(join(gameDir, 'Base', 'Binaries', 'Win64', OODLE_DLL));

    // Walk one level deep for any folder containing the DLL
    for (const sub of listSubdirs(gameDir)) {
      addIfExists(join(sub, OODLE_DLL));
      addIfExists(join(sub, 'Binaries', 'Win64', OODLE_DLL));
    }
  }

  return found;
}

/**
 * Walk up a filesystem path to find the Civilization VII game root.
 * This is useful when the user opens a file and we want to locate
 * sibling SHARED_DATA directories relative to it.
 *
 * @param filePath Any path inside or below the game directory.
 * @returns The game root path, or null if not found.
 */
export function findGameRootFromPath(filePath: string): string | null {
  let current = filePath;

  // Walk upward until we hit a root or find the game folder
  for (;;) {
    const base = current.split(sep).pop() ?? '';
    if (base === GAME_FOLDER_NAME) {
      return current;
    }

    const parent = dirname(current);
    if (parent === current) {
      // Reached filesystem root without finding the game folder
      return null;
    }
    current = parent;
  }
}

/**
 * Build a lookup index mapping bare filenames to their full paths
 * across one or more SHARED_DATA directories.
 *
 * When duplicate filenames exist, the last directory in the input
 * array wins (DLC overrides Base).
 *
 * @param dirs Array of SHARED_DATA directory paths.
 * @returns Map from filename (e.g. "UI.blp") to absolute path.
 */
export function buildSharedDataIndex(dirs: string[]): Map<string, string> {
  const index = new Map<string, string>();

  for (const dir of dirs) {
    if (!isDir(dir)) continue;

    let entries: ReturnType<typeof readdirSync>;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (entry.isFile()) {
        index.set(entry.name, join(dir, entry.name));
      }
    }
  }

  return index;
}
