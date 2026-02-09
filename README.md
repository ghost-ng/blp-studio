# BLP Studio

**BETA** -- A desktop application for browsing, previewing, and modifying the art assets inside Civilization VII's `.blp` package files. Built with Electron, React, and TypeScript.

## What it does

- **Browse** any BLP package and see every texture, blob, GPU buffer, and sound bank it references
- **Preview** textures in real time with channel isolation (R/G/B/A), mipmap browsing, and background toggles
- **Replace** assets with your own files (DDS textures, sound banks, etc.)
- **Export** your replacements three ways:
  - **Install to Game** -- writes modified CIVBIG files directly into SHARED_DATA (with automatic backups)
  - **Export as Mod** -- generates a complete mod folder with `.modinfo`, `.dep`, and `SHARED_DATA` ready to drop into the game's DLC directory
  - **Export CIVBIG Files** -- saves loose CIVBIG files to any folder
- **DDS Viewer** -- open any DDS file for inspection, export to PNG/JPG, batch-convert folders, compare two textures side by side
- **Settings** -- theme (dark/light), export format defaults, DDS viewer background, Oodle compression mode
- **Resizable panels** -- drag the edges between the asset tree, preview, and properties panels

## Download

Grab the latest portable EXE from [Releases](https://github.com/ghost-ng/blp-studio/releases). No installation required.

## Requirements

- **Windows 10/11** (x64)
- **Civilization VII** installed via Steam (for Oodle DLL auto-detection)
- If the game is not installed or installed in a non-standard location, place `oo2core_9_win64.dll` in the app's `resources/` folder

> **Disclaimer:** `oo2core_9_win64.dll` is the Oodle decompression library, proprietary software owned by Epic Games. It is **not** created by or affiliated with this project. BLP Studio includes a copy solely to enable decompression of Civilization VII assets. All rights to the Oodle SDK belong to Epic Games, Inc.

## Quick start (users)

1. Download `BLP-Studio-*-portable.exe` from Releases
2. Run the portable EXE -- no install needed
3. Click **Open BLP** or drag a `.blp` file into the window
4. Browse assets, preview textures, inspect metadata
5. Click **Replace** on any texture to swap it with your own DDS file
6. Use the **Save** dropdown to install to game, export as mod, or save loose CIVBIG files

## Building from source

```bash
git clone https://github.com/ghost-ng/blp-studio.git
cd blp-studio
npm install
npm run dev          # launch in dev mode with hot reload
```

### Production build

```bash
npm run build        # compile TypeScript + bundle with Vite
npm run package      # build Windows portable EXE (output in dist/)
```

The packaged EXE will be at `dist/BLP-Studio-<version>-portable.exe`.

### Available scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start dev server with hot reload |
| `npm run build` | Compile for production |
| `npm run package` | Build + package as Windows portable EXE |
| `npm run package:dir` | Build + package as unpacked directory (for debugging) |
| `npm run icons` | Regenerate app icons from source |

## Project structure

```
blp-studio/
  src/
    core/           # format parsers and game logic (no Electron deps)
      blp-parser.ts     BLP binary format parser + type registry
      type-registry.ts  self-describing type system decoder
      civbig.ts         CIVBIG container reader/writer
      dds-formats.ts    DXGI format tables, DDS header generation
      bcn-decoder.ts    BC1/BC4/BC5/BC7 texture decompression
      oodle.ts          Oodle Kraken compression via koffi FFI
      game-detect.ts    Steam installation + SHARED_DATA discovery
      mod-manifest.ts   .modinfo and .dep XML generation
      preferences.ts    user settings persistence
    main/
      index.ts          Electron main process, IPC handlers, menus
    preload/
      index.ts          context bridge (renderer <-> main IPC)
    renderer/
      index.html        entry point with CSP headers
      src/
        App.tsx          top-level state, routing, handlers
        components/
          Toolbar.tsx         file/save actions, theme toggle
          AssetTree.tsx       filterable asset list sidebar
          PreviewPanel.tsx    texture preview + hex viewer
          PropertiesPanel.tsx asset metadata display
          DDSViewer.tsx       standalone DDS viewer with info panel
          DDSInfoPanel.tsx    format analysis sidebar
          DDSCompare.tsx      side-by-side texture comparison
          BatchDDSDialog.tsx  batch DDS-to-PNG/JPG conversion
          ResizeHandle.tsx    draggable panel resize handle
          SettingsDialog.tsx  preferences UI
          AboutDialog.tsx     version + author info
          StatusBar.tsx       progress bar + SHARED_DATA paths
          Notification.tsx    toast notifications
  resources/
    oo2core_9_win64.dll   Oodle decompression (not redistributable)
    icon.png              app icon
    icon.ico              Windows icon
  scripts/
    dev.mjs               launches electron-vite with clean env
    gen-icon.mjs          generates icon.png from pixel data
    gen-ico.mjs           wraps PNG into Windows ICO format
    cli.ts                headless CLI for BLP operations
```

## Dependencies

| Package | What it does | Why it's needed |
|---------|-------------|-----------------|
| **koffi** | Foreign function interface for Node.js | Calls `OodleLZ_Decompress` and `OodleLZ_Compress` from the game's native DLL at runtime. This is the only way to handle Oodle Kraken-compressed textures without reimplementing the codec. |
| **electron** | Desktop app framework | Provides the window, native dialogs, file system access, and menu system. The renderer runs in a sandboxed Chromium process with `contextIsolation: true`. |
| **react** / **react-dom** | UI framework | Component-based rendering for the asset browser, DDS viewer, and all dialogs. |
| **electron-vite** | Build toolchain | Bundles main, preload, and renderer code separately with proper Electron-aware configuration. Handles TypeScript, JSX, and CSS. |
| **tailwindcss** | Utility CSS framework | All styling uses Tailwind classes. Dark mode is default; light mode is applied via CSS overrides on `html.light`. |
| **electron-builder** | Packaging + distribution | Creates the portable EXE for Windows. Handles ASAR packaging, icon embedding, and resource bundling. |
| **typescript** | Type checking | Static types across all three Electron processes (main, preload, renderer). |

**koffi** is the only runtime dependency. Everything else is bundled by Vite or only needed at build time.

## How BLP files work

See the [wiki](https://github.com/ghost-ng/blp-studio/wiki) for comprehensive documentation on the BLP format, CIVBIG containers, DDS textures, and modding workflows.

### The short version

Civilization VII stores art assets in **BLP** (Binary Library Package) files. A BLP is a manifest that describes assets (textures, meshes, animations, sounds) and where to find them. The actual data lives in **CIVBIG** container files in flat `SHARED_DATA` directories.

To mod a texture: open the BLP that references it, replace it with a DDS file matching the original dimensions and format, and BLP Studio handles the rest (header stripping, CIVBIG wrapping, Oodle compression, and game installation).

## Contributing

1. Fork the repo
2. Create a feature branch
3. Make your changes
4. Run `npm run build` to verify compilation
5. Open a pull request

## Reporting issues

Found a bug or have a feature request? [Open an issue](https://github.com/ghost-ng/blp-studio/issues).

## License

MIT
