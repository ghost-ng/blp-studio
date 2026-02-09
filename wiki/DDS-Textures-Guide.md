# DDS Textures Guide

This guide explains DDS texture format fundamentals and how BLP Studio handles texture viewing, extraction, and replacement.

## What is DDS?

DDS (DirectDraw Surface) is the standard texture format used in modern game engines, including Civilization VII. Key characteristics:

- **GPU-optimized storage**: Stores textures in GPU-compressed formats (BCn/DXGI) that can be uploaded directly to video memory
- **Block compression**: Uses block-based compression algorithms that decompress in hardware during rendering
- **Mipmap support**: Contains pre-generated smaller versions of textures for efficient level-of-detail rendering
- **Header structure**: Has a 128-byte header (or 148 bytes with DX10 extension) describing format and dimensions

**Important**: Civilization VII stores raw texture data without DDS headers inside CIVBIG containers. BLP Studio automatically strips headers when replacing textures and adds headers back when extracting, making the workflow seamless.

## DDS File Structure

### Main Header (128 bytes)

```
Offset  Size  Field               Description
------  ----  -----               -----------
0x00    4     Magic               "DDS " (0x20534444)
0x04    4     Header size         Always 124
0x08    4     Flags               Capability flags
0x0C    4     Height              Texture height in pixels
0x10    4     Width               Texture width in pixels
0x14    4     Pitch/Linear size   Bytes per scanline or total size
0x18    4     Depth               Texture depth (for volume textures)
0x1C    4     Mipmap count        Number of mipmap levels
0x20    44    Reserved            Reserved space (11 DWORDs)
0x4C    32    Pixel format        DDS_PIXELFORMAT structure
0x6C    16    Caps                Capability flags (4 DWORDs)
0x7C    4     Reserved2           Unused
```

### DX10 Extended Header (20 bytes, optional)

When the pixel format fourCC field is "DX10" (0x30315844), an additional 20-byte header follows at offset 0x80:

```
Offset  Size  Field               Description
------  ----  -----               -----------
0x80    4     DXGI format         DXGI_FORMAT enumeration value
0x84    4     Resource dimension  Texture dimension (1D/2D/3D)
0x88    4     Misc flags          Additional capability flags
0x8C    4     Array size          Number of textures in array
0x90    4     Misc flags 2        Additional flags
```

The DX10 header is required for modern DXGI formats like BC7 and is recommended for all DDS files for maximum compatibility.

## Common DXGI Formats in Civilization VII

| DXGI | Name | BPP | Compression | Use Case |
|------|------|-----|-------------|----------|
| 71 | BC1_UNORM | 4 | 6:1 | Diffuse textures (opaque or 1-bit alpha) |
| 72 | BC1_UNORM_SRGB | 4 | 6:1 | Diffuse textures in sRGB color space |
| 77 | BC3_UNORM | 8 | 4:1 | Textures with full alpha channel |
| 78 | BC3_UNORM_SRGB | 8 | 4:1 | Full alpha textures in sRGB |
| 80 | BC4_UNORM | 4 | 2:1 | Single-channel (roughness, height, masks) |
| 83 | BC5_UNORM | 8 | 2:1 | Two-channel (normal maps - RG channels) |
| 98 | BC7_UNORM | 8 | 4:1 | High-quality RGBA (modern format) |
| 99 | BC7_UNORM_SRGB | 8 | 4:1 | High-quality RGBA in sRGB |

### Format Selection Guidelines

- **BC1**: Best for opaque diffuse textures or those with only 1-bit alpha (on/off transparency)
- **BC3**: Use when you need smooth alpha gradients (glass, fading effects)
- **BC4**: Perfect for single-channel data like roughness, metallic, or height maps
- **BC5**: The standard for normal maps - stores X and Y in two channels (Z is reconstructed)
- **BC7**: Highest quality for color and alpha, but larger files than BC1
- **SRGB variants**: Use for color textures (diffuse, albedo) but NOT for data textures (normals, roughness)

## Mipmaps

Mipmaps are a chain of pre-generated smaller versions of a texture, each level half the dimensions of the previous:

- **Mip 0**: Full resolution (e.g., 2048x2048)
- **Mip 1**: Half resolution (1024x1024)
- **Mip 2**: Quarter resolution (512x512)
- **Mip 3**: 256x256
- And so on down to 1x1

### Why Mipmaps Matter

1. **Performance**: GPU samples smaller mips for distant objects, reducing memory bandwidth
2. **Visual quality**: Prevents aliasing and shimmering on distant textures
3. **Memory efficiency**: The entire mip chain adds only ~33% to file size

### Mipmap Storage

Mipmaps are stored sequentially after the DDS header:
```
[DDS Header]
[Mip 0 data - full resolution]
[Mip 1 data - half resolution]
[Mip 2 data - quarter resolution]
...
```

BLP Studio's DDS viewer lets you browse individual mip levels using the mip slider. When replacing textures, always include all mipmaps to match the original texture's mip count.

## BCn Compression Details

Block compression (BCn) formats compress textures in 4x4 pixel blocks. Each block encodes to a fixed number of bytes regardless of content, making decompression predictable and hardware-accelerated.

### BC1 (DXT1) - 4 bits per pixel
- Each 4x4 block = 8 bytes
- Stores two 16-bit RGB565 colors
- 2-bit indices per pixel select one of 4 interpolated colors
- Optional 1-bit alpha (black color = transparent)

### BC3 (DXT5) - 8 bits per pixel
- Each 4x4 block = 16 bytes
- 8 bytes for alpha (two reference values + 3-bit indices)
- 8 bytes for color (same as BC1)
- Best for textures with smooth alpha gradients

### BC4 - 4 bits per pixel
- Each 4x4 block = 8 bytes
- Single channel, stores two reference values + 3-bit indices
- Excellent for grayscale data (roughness, height, AO)

### BC5 - 8 bits per pixel
- Each 4x4 block = 16 bytes
- Two BC4 blocks (one for R, one for G channel)
- Standard for normal maps - X and Y components, Z reconstructed as sqrt(1 - X^2 - Y^2)
- Higher quality than BC1 for normal map compression

### BC7 - 8 bits per pixel
- Each 4x4 block = 16 bytes
- Most complex format with 8 different encoding modes
- Encoder chooses best mode per block for optimal quality
- Highest quality BCn format, but slower to encode
- Widely supported on modern GPUs (DX11+)

## Using the DDS Viewer

Access the DDS Viewer via **DDS Viewer > Open DDS** (Ctrl+D) or drag-and-drop a .dds file onto the window.

### Viewer Features

**Mipmap Navigation**
- Use the mip level slider to browse through mipmap chain
- Current mip dimensions shown in status bar
- Zoom in/out with mouse wheel or zoom slider

**Channel Isolation**
- **R button**: Show red channel only (grayscale)
- **G button**: Show green channel only
- **B button**: Show blue channel only
- **A button**: Show alpha channel only
- **RGB button**: Show all color channels
- Useful for inspecting normal maps, masks, and packed textures

**Background Options**
- **Checkerboard**: Default, shows transparency clearly
- **Black**: Better for viewing bright textures
- **White**: Better for viewing dark textures

**Export Options**
- **Export to PNG**: Lossless export of current mip level
- **Export to JPG**: Lossy export (no alpha channel)
- **Batch Convert**: Convert entire folders of DDS to PNG/JPG

**Comparison Mode**
- Load two DDS files side-by-side
- Synchronized zoom and pan
- Perfect for comparing original vs. modified textures

## Using DDS Viewer from BLP Browser

The BLP Browser provides quick access to texture viewing without manual extraction:

**Context Menu Options** (right-click any texture in the asset tree):
- **Open in DDS Viewer**: Opens the texture in the full DDS viewer with all mip levels
- **Export as PNG**: Quick export of mip 0 to PNG format
- **Export as JPG**: Quick export of mip 0 to JPG format
- **Copy Preview**: Copy the preview thumbnail to clipboard

**Workflow Tips**
1. Browse textures in the BLP asset tree
2. Right-click and "Open in DDS Viewer" to inspect format and mipmaps
3. Check DXGI format in the status bar (BC1, BC5, BC7, etc.)
4. Note dimensions and mip count before creating replacements

## Creating Replacement Textures

Follow this workflow to replace textures in BLP files:

### Step 1: Extract Original Texture

1. In BLP Browser, locate the texture in the asset tree
2. Right-click and choose **Export as DDS**
3. Save to your working directory
4. Note the DXGI format, dimensions, and mip count

### Step 2: Edit the Texture

Use a DDS-capable image editor:

**GIMP with DDS Plugin**
- Free and open source
- Install the DDS plugin for GIMP 2.10+
- Can load and save DDS with various BCn formats
- Generate mipmaps automatically on save

**Paint.NET with DDS Plugin**
- Free, Windows-only
- Excellent DDS support
- Simple interface for basic edits

**DirectXTex (texconv.exe)**
- Microsoft's official command-line tool
- Most accurate BCn compression
- Batch conversion support
- Example: `texconv.exe -f BC7_UNORM_SRGB -m 10 input.png`

**Adobe Photoshop with Intel Plugin**
- Commercial, but industry standard
- Intel Texture Works plugin supports all BCn formats
- Precise control over compression settings

### Step 3: Save with Correct Settings

Critical requirements:
- **Same DXGI format** as original (BC1 for BC1, BC5 for BC5, etc.)
- **Same dimensions** as original (mismatches trigger warnings)
- **Same mip count** or more (game may ignore extra mips)
- **Use DX10 header** for best compatibility

### Step 4: Replace in BLP Studio

1. In BLP Browser, select the texture you want to replace
2. Click **Replace** button or right-click and choose **Replace Texture**
3. Browse to your edited DDS file
4. BLP Studio automatically:
   - Validates format compatibility
   - Strips the DDS header
   - Wraps raw pixel data in CIVBIG container
   - Handles Oodle Kraken compression if needed

### Step 5: Save and Test

1. Save the modified BLP file
2. Replace the original in the game directory (make backups first)
3. Launch Civilization VII and verify the texture in-game

## Tips and Best Practices

### Format Matching
- **Always match the original DXGI format** when replacing textures
- Changing BC5 normal maps to BC1 will cause visual artifacts
- sRGB vs. linear mismatch causes incorrect brightness

### Dimension Guidelines
- **Power of two dimensions** (256, 512, 1024, 2048) are recommended
- Non-power-of-two textures may have reduced mip counts
- BLP Studio shows warnings for dimension mismatches but allows them
- The game engine may or may not handle non-matching dimensions gracefully

### Mipmap Generation
- **Include full mip chains** down to 1x1 for best quality
- Missing mipmaps cause performance issues and visual artifacts
- Most DDS editors can auto-generate mipmaps with various filters
- Box filter is fast but low quality; Lanczos or Kaiser is better

### Compression Quality
- BC7 encoding is slow but produces highest quality
- Use highest quality encoder settings for hero assets
- Fast compression is fine for testing and iteration
- BC1 and BC3 are much faster to encode than BC7

### Testing Workflow
- **Test in-game early and often**
- View textures at multiple distances to check mipmap quality
- Compare side-by-side with original in DDS Viewer
- Check for color shifts (sRGB vs. linear issues)

### Header Handling
- BLP Studio handles all header stripping/adding automatically
- The game stores **raw pixel data only** in CIVBIG containers
- Never manually strip headers before importing to BLP Studio
- Extracted DDS files always include proper headers for compatibility

### Compression Transparency
- Textures may be Oodle Kraken compressed inside the BLP
- BLP Studio automatically decompresses on load and recompresses on save
- You never need to handle Oodle compression manually
- Compression is transparent to the texture replacement workflow

## Troubleshooting

**Problem**: Texture appears too bright or too dark in-game
- **Cause**: sRGB/linear mismatch
- **Solution**: Ensure you use the SRGB variant (e.g., BC7_UNORM_SRGB) for color textures

**Problem**: Texture looks blocky or corrupted
- **Cause**: Wrong BCn format or missing mipmaps
- **Solution**: Verify DXGI format matches original, regenerate mipmaps

**Problem**: Normal map looks incorrect (surfaces too flat or too bumpy)
- **Cause**: Wrong format (should be BC5) or incorrect channel packing
- **Solution**: Use BC5_UNORM format, ensure X in R channel and Y in G channel

**Problem**: Texture replacement fails in BLP Studio
- **Cause**: Corrupted DDS file or unsupported format
- **Solution**: Re-save DDS with DX10 header, validate file opens in DDS Viewer

**Problem**: Game crashes after texture replacement
- **Cause**: Severe dimension mismatch or corrupted data
- **Solution**: Restore backup, ensure exact dimension match, verify DDS file integrity

## Additional Resources

- **Microsoft DirectXTex**: https://github.com/Microsoft/DirectXTex
- **GIMP DDS Plugin**: Available in GIMP 2.10+ plugin manager
- **Intel Texture Works**: https://software.intel.com/content/www/us/en/develop/articles/intel-texture-works-plugin.html
- **DDS Format Specification**: https://docs.microsoft.com/en-us/windows/win32/direct3ddds/dx-graphics-dds

---

*Last updated: February 2026*
