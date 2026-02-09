# Getting Started with BLP Studio

Welcome to BLP Studio, a specialized tool for browsing and extracting assets from Civilization VII's `.blp` (Binary Library Package) files.

## Installation

### Download
BLP Studio is distributed as a portable executable. No installation is required.

1. Download `BLPStudio.exe` from the [Releases](https://github.com/yourusername/blp-studio/releases) page
2. Save it to any folder on your computer
3. Double-click to launch

### System Requirements
- **Operating System**: Windows 10 or Windows 11 (x64)
- **Civilization VII**: Installed via Steam for automatic game file detection (optional)
- **Oodle Compression DLL**: Required for texture decompression

### Oodle DLL Setup
BLP Studio requires the Oodle compression library (`oo2core_9_win64.dll`) to decompress textures.

**Automatic Detection** (Recommended):
If you have Civilization VII installed via Steam, BLP Studio will automatically locate the DLL in your game installation directory.

**Manual Setup**:
If auto-detection fails or you're using a non-Steam installation:
1. Locate `oo2core_9_win64.dll` in your Civilization VII installation directory
2. Copy it to the `resources/` folder next to `BLPStudio.exe`

The typical game installation path is:
```
C:\Program Files (x86)\Steam\steamapps\common\Sid Meier's Civilization VII\
```

## Opening a BLP File

### Method 1: File Menu
1. Click **File > Open BLP** or press `Ctrl+O`
2. Navigate to the BLP file location
3. Select the `.blp` file and click **Open**

### Method 2: Drag and Drop
Simply drag a `.blp` file from Windows Explorer and drop it into the BLP Studio window.

### Method 3: Recent Files
Click **File** in the menu bar to see recently opened files. Click any file to reopen it quickly.

### Where to Find BLP Files
Civilization VII's BLP files are located in the game installation directory:

```
Steam\steamapps\common\Sid Meier's Civilization VII\base-standard\Platforms\Windows\BLPs\
```

This directory contains all the game's asset packages organized by type and quality level.

## BLP File Families

Civilization VII organizes assets into multiple BLP packages based on content type and quality level.

### Material Packages (Textures)
**Material_*.blp** (16 files)
- Contains textures: diffuse maps, normal maps, roughness maps, metallic maps, etc.
- Full-resolution textures for standard quality settings

**Material_*_Low.blp** (16 files)
- Lower-resolution variants of textures
- Used on lower quality settings to reduce memory usage

### StandardAsset Packages (Meshes, Animations, Sounds)
**StandardAsset_*.blp** (8 files)
- Contains 3D meshes, skeletal animations, skeletons, audio files, and other game assets
- Standard quality level

**StandardAsset_*_High.blp** (8 files)
- Higher-quality mesh variants with more geometry detail
- Used on high/ultra graphics settings

**StandardAsset_*_Low.blp** (8 files)
- Lower-quality mesh variants with reduced polygon counts
- Used on low graphics settings or for distant LODs

### Specialized Packages
**Script.blp**
- Game scripts and logic files

**UI.blp**
- User interface assets (icons, backgrounds, UI textures)

**VFX.blp** and **VFX_High.blp**
- Visual effects assets (particle textures, effect meshes)

## The Interface

BLP Studio's interface is divided into several key areas:

### Toolbar (Top)
- **Open**: Open a new BLP file
- **Extract All**: Extract all assets from the current BLP file
- **Save** (dropdown): Save current asset or save all assets
- **Theme Toggle**: Switch between dark and light themes
- **Settings**: Open the settings dialog

### Left Panel: Asset Tree
- Displays all assets in the currently opened BLP file
- **Search Box**: Filter assets by name (type to search)
- **Type Filter**: Dropdown to filter by asset type (textures, blobs, GPU assets, sounds)
- **Resizable**: Drag the panel border to resize

### Center Panel: Preview Area
- **Texture Preview**: Visual preview of selected texture assets
- **Zoom Controls**: Zoom in/out or fit to window
- **Channel Selector**: View individual color channels (R, G, B, A) or RGB combined
- **Background Options**: Toggle between checkerboard, black, or white backgrounds

### Right Panel: Properties
- **Metadata Display**: Shows asset information
  - Format (e.g., BC7, BC5, RGBA8)
  - Dimensions (width x height)
  - Mipmap count
  - Source file path
  - Compression settings

### Status Bar (Bottom)
- **SHARED_DATA Paths**: Shows resolved shared data locations
- **Progress Indicator**: Displays loading and extraction progress
- **Asset Count**: Total number of assets in the current file

## Browsing Assets

### Viewing an Asset
1. Click on any asset in the left panel asset tree
2. The center panel will display a preview (for supported asset types)
3. The right panel will show metadata and properties

### Filtering Assets
Use the **Type Filter** dropdown above the asset tree to show only specific types:
- **All Assets**: Show everything
- **Textures**: Show only texture assets
- **Blobs**: Show binary data blobs
- **GPU Assets**: Show GPU-specific data
- **Sounds**: Show audio files

### Searching for Assets
Use the **Search Box** above the asset tree:
1. Click in the search box
2. Type part of the asset name
3. The tree will filter to show only matching assets
4. Clear the search box to show all assets again

### Context Menu (Right-Click)
Right-click on texture assets to access additional options:
- **Open in DDS Viewer**: Open the texture in the built-in DDS viewer for detailed inspection
- **Export as PNG**: Export the texture as a PNG file
- **Export as JPG**: Export the texture as a JPEG file
- **Copy Path**: Copy the asset's internal path to the clipboard

## Extracting Assets

### Extract a Single Asset
1. Select the asset in the tree
2. Right-click and choose an export format (PNG, JPG, or raw)
3. Choose a destination folder
4. The asset will be saved with its original name

### Extract All Assets
1. Click the **Extract All** button in the toolbar
2. Choose a destination folder
3. All assets will be extracted, maintaining the internal folder structure

### Export Settings
The export format and quality can be configured in the Settings dialog:
- **PNG**: Lossless compression, supports transparency, larger file size
- **JPG**: Lossy compression, smaller file size, configurable quality (1-100)

## Settings

Access the Settings dialog via **View > Settings** or press `Ctrl+,`.

### Theme
Choose between **Dark** and **Light** themes to match your preference.

### Export Format
Set the default export format for textures:
- **PNG**: Recommended for textures with transparency or when quality is critical
- **JPG**: Recommended for diffuse textures when file size matters

### JPG Quality Slider
When JPG is selected, adjust the quality slider (1-100):
- Higher values = better quality, larger file size
- Lower values = more compression, smaller file size
- Recommended: 85-95 for a good balance

### DDS Viewer Background
Choose the background color for the DDS viewer:
- **Checkerboard**: Makes transparent areas visible (recommended)
- **Black**: Useful for bright textures
- **White**: Useful for dark textures

### Oodle Compression Mode
Control when Oodle compression is used for exported textures:
- **Auto**: Match the compression used in the original BLP file (recommended)
- **Always**: Always use Oodle compression when exporting
- **Never**: Never use Oodle compression (faster, larger files)

### Saving Settings
Click **Save** to apply changes. Settings are saved automatically and persist between sessions.

## Keyboard Shortcuts

Learn these shortcuts to work more efficiently:

| Shortcut | Action |
|----------|--------|
| `Ctrl+O` | Open BLP file |
| `Ctrl+D` | Open DDS file |
| `Ctrl+Shift+T` | Toggle theme (Dark/Light) |
| `Ctrl+,` | Open Settings dialog |
| `Escape` | Close current dialog |

## Next Steps

Now that you're familiar with the basics:

1. **Explore Sample Files**: Open `UI.blp` or `Material_0.blp` from the game directory
2. **Browse Textures**: Use the type filter to view only textures, then preview different assets
3. **Extract Assets**: Try extracting a few textures to see the export process
4. **Customize Settings**: Adjust the theme and export settings to match your workflow

For more advanced topics, see:
- [Asset Types and Formats](Asset-Types-and-Formats.md)
- [Advanced Extraction](Advanced-Extraction.md)
- [Troubleshooting](Troubleshooting.md)

## Getting Help

If you encounter issues:
- Check the [Troubleshooting Guide](Troubleshooting.md)
- Review the [FAQ](FAQ.md)
- Report bugs on the [GitHub Issues](https://github.com/yourusername/blp-studio/issues) page
