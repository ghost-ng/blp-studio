# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

BLP Studio is an Electron desktop app for browsing, previewing, and modifying art assets inside Civilization VII `.blp` package files. It handles BLP parsing, CIVBIG container I/O, Oodle Kraken compression (via native DLL + koffi FFI), BCn texture decompression, and mod package generation. Windows-only (x64).

## Build Commands

```bash
npm run dev          # electron-vite dev with hot reload (uses scripts/dev.mjs to clear ELECTRON_RUN_AS_NODE)
npm run build        # TypeScript + Vite production bundle (output in out/)
npm run package      # build + electron-builder portable Windows EXE (output in dist/)
npm run package:dir  # build + unpacked directory (for debugging packaging)
npm run cli          # headless CLI for BLP parser debugging (scripts/cli.ts via tsx)
npm run icons        # regenerate app icons from pixel data
```

No test framework or linter is configured.

## Architecture

Three-process Electron app bundled by electron-vite (separate Vite configs for main, preload, renderer):

**Core layer** (`src/core/`) — platform-agnostic, no Electron imports:
- `blp-parser.ts` — BLP binary format parser with self-describing type system
- `type-registry.ts` — decodes TypeInfoStripe self-describing types
- `civbig.ts` — CIVBIG container reader/writer
- `oodle.ts` — Oodle Kraken compress/decompress via koffi FFI to `oo2core_9_win64.dll`
- `bcn-decoder.ts` — BC1/BC4/BC5/BC7 software texture decompression
- `dds-formats.ts` — DXGI format tables and DDS header generation
- `game-detect.ts` — Steam install + SHARED_DATA directory discovery (probes drives C-F)
- `mod-manifest.ts` — `.modinfo` and `.dep` XML generation
- `preferences.ts` — JSON settings persistence via `app.getPath('userData')`

**Main process** (`src/main/index.ts`) — single large file with all IPC handlers, window management, menus, asset extraction/replacement/export logic, game installation with backups, mod packaging.

**Preload** (`src/preload/index.ts`) — context bridge exposing type-safe IPC API to renderer. Context isolation enabled, sandbox disabled (required for Node APIs).

**Renderer** (`src/renderer/`) — React + TailwindCSS SPA. Entry: `index.html` → `src/main.tsx` → `App.tsx`. State is local React hooks, no state management library. All data comes through IPC.

## Key Patterns

- **IPC**: All main↔renderer communication via `ipcMain.handle()` / `ipcRenderer.invoke()`. Input validation on all handlers.
- **Binary data**: Node.js `Buffer`, little-endian throughout. Compressed data identified by `0x8C` first byte (Oodle Kraken).
- **Oodle DLL**: Not bundled with the repo by default (it's in `resources/`). Auto-detected from Steam install or `process.resourcesPath`. The `findOodleCandidates()` function in `game-detect.ts` handles resolution for both dev and packaged builds.
- **koffi**: Only runtime dependency. Used for FFI calls to native Oodle DLL. Requires `createRequire` workaround for ESM compatibility.
- **Styling**: TailwindCSS utility classes. Dark mode is default; light mode applied via `html.light` class. Custom gray palette in `tailwind.config.js`.
- **TypeScript**: Strict mode. Two tsconfig projects: `tsconfig.node.json` (main + preload + core, ES2022 no DOM) and `tsconfig.web.json` (renderer, ES2022 + DOM + JSX).

## Packaging

electron-builder config is in `package.json` under `"build"`. The `extraResources` section copies `resources/` (icons + Oodle DLL) into the packaged app. Output: `dist/BLP-Studio-<version>-portable.exe`.

## Release Workflow

Push a tag matching `v*` to trigger `.github/workflows/release.yml`, which builds on `windows-latest` and uploads the portable EXE to a GitHub Release via `softprops/action-gh-release`.

## Dev Environment Notes

- `scripts/dev.mjs` deletes `ELECTRON_RUN_AS_NODE` from env before launching electron-vite, since tools like Claude Code set this variable which breaks Electron.
- The renderer's `index.html` is at `src/renderer/index.html` (configured in `electron-vite.config.ts`).
- Preload resolves to `out/preload/index.js` relative to `out/main/index.js` via `join(__dirname, '../preload/index.js')`.
