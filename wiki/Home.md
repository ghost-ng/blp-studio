# BLP Studio

**Version: BETA** | **Author: ghost_ng** | **Repository: [github.com/ghost-ng/blp-studio](https://github.com/ghost-ng/blp-studio)**

Welcome to BLP Studio, a visual asset editor for Civilization VII Binary Library Package (`.blp`) files. This tool enables modders to browse, preview, and modify game assets directly within BLP archives.

## What is BLP Studio?

BLP Studio is a standalone desktop application designed for Civilization VII modding. It provides a graphical interface for working with `.blp` files, which are the binary container format used by Civilization VII to package game assets such as textures, materials, UI elements, and visual effects.

With BLP Studio, you can:
- Extract and replace assets without manual hex editing
- Preview DDS textures before export or replacement
- Modify game content for custom mods
- Explore the structure and contents of BLP archives

**Note:** BLP Studio is currently in BETA. While functional, some features may be incomplete or subject to change.

## Key Features

### Asset Management
- **Browse BLP Archives**: Navigate the complete structure of any BLP file with an intuitive tree view
- **Asset Preview**: Built-in DDS texture viewer with support for common DDS formats
- **Asset Replacement**: Replace existing assets with your own files while preserving BLP structure
- **Asset Extraction**: Export individual assets or entire archives

### Export Modes
BLP Studio supports three export workflows to fit different modding scenarios:
1. **Export Individual Assets**: Extract single files by right-clicking in the tree view
2. **Export Selected Multiple**: Batch export multiple selected assets
3. **Export All**: Full archive extraction with preserved directory structure

### Additional Tools
- **DDS Texture Viewer**: Preview DDS texture files with format information and mipmap navigation
- **Settings Panel**: Customize output paths, preview options, and application behavior
- **Search and Filter**: Quickly locate specific assets within large BLP files

## Quick Start Guide

### Installation
1. Download the latest portable executable from the [Releases](https://github.com/ghost-ng/blp-studio/releases) page
2. No installation required - run `BLPStudio.exe` directly
3. Recommended: Create a dedicated folder for BLP Studio and your working files

### Basic Workflow
1. **Open a BLP File**: Click `File > Open` or drag-and-drop a `.blp` file into the application
2. **Browse Assets**: Explore the archive structure in the left tree view
3. **Preview Textures**: Select any DDS texture to preview in the right panel
4. **Replace Assets**: Right-click an asset and select `Replace` to substitute with your own file
5. **Save Changes**: Click `File > Save` or `File > Save As` to create a modified BLP archive
6. **Export Assets**: Right-click to export individual files or use `File > Export All`

### Finding BLP Files
Civilization VII BLP files are typically located in:
```
C:\Users\<YourName>\AppData\Local\Firaxis Games\Sid Meier's Civilization VII\
```

Common BLP archives include:
- `UI.blp` - User interface assets
- `VFX.blp` / `VFX_High.blp` - Visual effects
- `StandardAsset.blp` / `StandardAsset_Low.blp` - Core game assets
- `Material.blp` - Material definitions and textures

## Documentation

### Getting Started
- [[Getting Started]] - Detailed installation instructions and first steps
- [[Modding Workflow]] - Complete guide to creating mods with BLP Studio

### Technical Reference
- [[BLP Format Specification]] - In-depth documentation of the BLP file format
- [[DDS Textures Guide]] - Working with DDS texture formats in Civilization VII

### Support
- [[Troubleshooting]] - Common issues and solutions

## Contributing

BLP Studio is an open-source project. Contributions, bug reports, and feature requests are welcome on the [GitHub repository](https://github.com/ghost-ng/blp-studio).

### Reporting Issues
If you encounter bugs or have suggestions:
1. Check existing [Issues](https://github.com/ghost-ng/blp-studio/issues) to avoid duplicates
2. Create a new issue with detailed reproduction steps
3. Include your BLP file details and BLP Studio version

## License

See the [LICENSE](https://github.com/ghost-ng/blp-studio/blob/main/LICENSE) file in the repository for license information.

## Acknowledgments

This project is a community effort to enable modding for Civilization VII. Special thanks to:
- The Civilization modding community for testing and feedback
- Contributors to BLP format reverse engineering research

---

**Disclaimer:** BLP Studio is an unofficial third-party tool and is not affiliated with or endorsed by Firaxis Games or 2K Games.
