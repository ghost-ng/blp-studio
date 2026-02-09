# BLP Studio

A desktop tool for browsing and previewing art assets inside Civilization VII's `.blp` package files. Developed to help with Civ7 mod design.

Thanks to the [Civ7 Modding Helpline Discord](https://discord.gg/eNxHM8PV) community for inspiration and feedback.

## Features

- **Browse** BLP packages -- textures, blobs, GPU buffers, and sound banks
- **Preview** textures with zoom, channel isolation, and background toggles
- **DDS Viewer** -- inspect DDS files, export to PNG/JPG, batch-convert, side-by-side compare
- **Extract** individual assets or entire packages
- **Replace** assets and export as mod packages (experimental -- enable in Settings)

## Download

Grab the latest portable EXE from [Releases](https://github.com/ghost-ng/blp-studio/releases). No installation required.

## Requirements

- **Windows 10/11** (x64)
- **Civilization VII** installed via Steam (for Oodle DLL auto-detection)

> **Disclaimer:** `oo2core_9_win64.dll` is the Oodle decompression library, proprietary software owned by Epic Games. It is **not** created by or affiliated with this project. BLP Studio includes a copy solely to enable decompression of Civilization VII assets. All rights to the Oodle SDK belong to Epic Games, Inc.

## Quick start

1. Download `BLP-Studio-*-portable.exe` from Releases
2. Run it -- no install needed
3. Open a `.blp` file or drag one into the window
4. Browse assets, preview textures, inspect metadata

## Building from source

```bash
git clone https://github.com/ghost-ng/blp-studio.git
cd blp-studio
npm install
npm run dev          # dev mode with hot reload
npm run build        # production build
npm run package      # Windows portable EXE (output in dist/)
```

## How BLP files work

See the [wiki](https://github.com/ghost-ng/blp-studio/wiki) for documentation on the BLP format, CIVBIG containers, DDS textures, and modding workflows.

## Contributing

1. Fork the repo
2. Create a feature branch
3. Run `npm run build` to verify compilation
4. Open a pull request

## Reporting issues

Found a bug or have a feature request? [Open an issue](https://github.com/ghost-ng/blp-studio/issues).

## License

MIT
