# Modding Workflow

This guide covers the complete workflow for modifying Civilization VII assets using BLP Studio and getting your changes into the game.

## Overview

BLP Studio provides three export methods for getting modified assets into the game, each suited for different use cases:

1. **Install to Game** - Quick testing during development
2. **Export as Mod** - Creating distributable mods for sharing
3. **Export CIVBIG Files** - Manual file placement for advanced users

All three methods produce CIVBIG files containing your modified textures. The difference is in how and where those files are delivered.

---

## Method 1: Install to Game (Quick Testing)

**Best for:** Rapid iteration during development

This method writes modified CIVBIG files directly into the game's SHARED_DATA directory, allowing you to see changes immediately without creating a full mod package.

### Workflow

1. Open the BLP file that contains the texture you want to modify
2. Select the texture in the asset tree and click **Replace**
3. Choose your new DDS file from disk
4. Click **Save > Install to Game**
5. BLP Studio writes modified CIVBIG files directly into the game's SHARED_DATA directory
6. Automatic backups are created with `.blpstudio.bak` extension
7. Launch the game to see your changes

### Restoring Backups

BLP Studio automatically creates backups of any files it modifies when using Install to Game.

- A **"Restore Backups (N)"** button appears in the toolbar when backups exist
- Click it to revert all modified files to their original state
- Backup files are stored alongside the originals with `.blpstudio.bak` extension
- The number shown indicates how many backup files are available

### Requirements

- The game must be installed and detected by BLP Studio
- Check the status bar for detected SHARED_DATA paths
- The game's SHARED_DATA directory must be writable
- You must have proper file permissions for the game directory

### Limitations

- Changes are temporary and will be overwritten if game files are verified
- Not suitable for distribution to other users
- Only affects your local installation

---

## Method 2: Export as Mod (For Sharing)

**Best for:** Distributing your mod to other players

This method creates a complete mod package with proper metadata files that the game's mod system can recognize and manage.

### Workflow

1. Replace textures as described in Method 1
2. Click **Save > Export as Mod**
3. Choose or create a folder for your mod
4. BLP Studio generates a complete mod package

### Generated Files

BLP Studio creates the following structure:

```
MyTextureMod/
  my-texture-mod.modinfo        (XML mod manifest)
  my-texture-mod.dep            (XML art dependency file)
  Platforms/
    Windows/
      BLPs/
        SHARED_DATA/
          armory_diff           (modified CIVBIG)
          armory_norm           (modified CIVBIG)
          ...
```

#### modinfo File

The `.modinfo` file is an XML manifest that defines:
- Mod identity (ID, name, version, author)
- Mod dependencies (required base game or DLC content)
- UpdateArt directives that tell the game where to find modified art assets

#### dep File

The `.dep` file is an XML art dependency file that specifies:
- Unique GUID for the mod's art package
- Required game art IDs that this mod depends on

### Installing the Mod

To install a mod exported from BLP Studio:

**For base game mods:**
```
Sid Meier's Civilization VII\base-standard\
```

**For DLC mods:**
```
Sid Meier's Civilization VII\content\dlc\
```

Drop the entire mod folder into the appropriate directory. The game will automatically discover SHARED_DATA files from the `*/Platforms/Windows/BLPs/SHARED_DATA/` path and use the modinfo/dep files for mod management in the main menu.

### Distribution

To share your mod:
1. Zip the entire mod folder
2. Share the zip file with installation instructions
3. Users extract to the appropriate game directory
4. The mod appears in the game's mod manager

---

## Method 3: Export CIVBIG Files (Manual)

**Best for:** Maximum control over file placement

This method exports only the raw CIVBIG files without mod metadata, giving you complete control over where and how they're used.

### Workflow

1. Replace textures as described in Method 1
2. Click **Save > Export CIVBIG Files**
3. Choose an output directory
4. CIVBIG files are written to a `SHARED_DATA` subdirectory
5. Manually place these files wherever you need them

### Use Cases

- Testing different file locations
- Creating custom mod structures
- Debugging file loading issues
- Advanced modding workflows with custom tools

---

## Oodle Compression

Textures in the base game are typically compressed using Oodle Kraken compression to reduce file size and improve loading performance.

### Compression Settings

Access compression settings via **Settings > Saving > Oodle Compression**:

- **Auto** (recommended): Match the original file's compression state
  - If the original texture was compressed, the replacement is compressed
  - If the original texture was uncompressed, the replacement is uncompressed

- **Always**: Force Oodle compression on all output
  - Smaller file sizes
  - Slightly longer save times
  - Matches base game practice

- **Never**: Write uncompressed data
  - Larger file sizes
  - Faster save times
  - The game accepts both compressed and uncompressed CIVBIG files

### How It Works

When saving modified assets, BLP Studio:
1. Strips the DDS header from your texture file
2. Extracts the raw pixel data
3. Optionally compresses the data using Oodle Kraken (based on your setting)
4. Writes the result to the CIVBIG file

The game's engine can read both compressed and uncompressed CIVBIG files, so compression is optional but recommended for distribution.

---

## Texture Replacement Checklist

Follow these guidelines to ensure your texture replacements work correctly:

### Format Matching

1. **Match the original DXGI format exactly**
   - Check the Properties panel for the original format (e.g., BC7_UNORM, BC5_UNORM)
   - Export your DDS file in the same format
   - Mismatched formats may cause rendering issues or crashes

2. **Match dimensions if possible**
   - BLP Studio shows warnings for dimension mismatches
   - The game may accept different sizes but visual quality can suffer
   - Aspect ratio changes can cause stretching or distortion

3. **Include all mipmap levels**
   - Mipmaps improve rendering quality at different distances
   - Most game textures include full mipmap chains
   - Missing mipmaps can cause visual artifacts

4. **Use DDS files with DX10 extended headers**
   - DX10 headers provide better format compatibility
   - Most modern DDS tools support DX10 headers
   - Legacy DDS formats may work but are less reliable

5. **Let BLP Studio handle the header**
   - The DDS header is automatically stripped during save
   - Only raw pixel data goes into the CIVBIG file
   - You don't need to manually process DDS files

### Validation

BLP Studio performs validation when you replace textures:
- Format compatibility checks
- Dimension mismatch warnings
- Mipmap level verification
- File size estimates

Pay attention to warnings in the status bar and message dialogs.

---

## Working with Multiple Assets

BLP Studio supports batch workflows for modifying multiple assets before saving.

### Batch Replacement

1. **Queue multiple replacements**
   - Replace as many textures as you want before saving
   - Each replacement is tracked independently
   - No changes are written until you click Save

2. **Track your changes**
   - The toolbar shows "N assets modified" indicator
   - Modified assets show a visual indicator in the asset tree
   - Hover over indicators to see replacement details

3. **Revert individual changes**
   - Click "Revert" on any replaced asset to undo the replacement
   - Only affects that specific asset
   - Other pending replacements remain queued

4. **Save all at once**
   - Choose your save method (Install to Game, Export as Mod, or Export CIVBIG)
   - All queued replacements are written in one operation
   - Progress is shown in the status bar

### Benefits

- Fewer save operations mean less time spent
- Easier to organize related changes (e.g., all textures for one building)
- Can review all changes before committing
- Undo is simple before saving

---

## Finding the Right BLP File

Civilization VII organizes assets into BLP files by category. Understanding the naming conventions helps you locate the right file quickly.

### File Naming Conventions

- **Material_*.blp** - Contains textures (diffuse, normal, roughness maps)
  - Example: `Material_Armory.blp` contains all armory-related textures
  - Example: `Material_Warrior.blp` contains warrior unit textures

- **UI_*.blp** - User interface elements
- **VFX_*.blp** - Visual effects and particles
- **StandardAsset_*.blp** - Shared game assets

### Finding Specific Textures

1. **Use the search box**
   - Located at the top of the asset tree
   - Type part of the texture name to filter results
   - Search is case-insensitive and matches partial names

2. **Check the Properties panel**
   - Select any asset to view its properties
   - The SHARED_DATA source path shows which CIVBIG file it came from
   - File size, format, and dimensions are displayed

3. **Browse the asset tree**
   - Assets are organized in a hierarchical tree structure
   - Expand nodes to explore related assets
   - The tree structure mirrors the internal BLP organization

### Tips

- Building textures typically follow the pattern: `{BuildingName}_diff`, `{BuildingName}_norm`, `{BuildingName}_rough`
- Unit textures use similar conventions
- When in doubt, search for a keyword related to what you want to modify
- Keep notes on which BLP files contain which assets for future reference

---

## Troubleshooting

### Changes Don't Appear in Game

- Verify the game is reading from the correct SHARED_DATA directory
- Check that CIVBIG files were written to the right location
- Ensure file permissions allow the game to read your modifications
- Try clearing the game's shader cache
- Verify your mod is enabled in the game's mod manager (if using Export as Mod)

### Texture Appears Corrupted

- Confirm the DXGI format matches the original exactly
- Check that all mipmap levels are present
- Verify the DDS file is valid by opening it in an image editor
- Try the "Never" Oodle compression setting to rule out compression issues

### Mod Doesn't Load

- Check that `.modinfo` and `.dep` files are in the mod root directory
- Verify the mod folder is in the correct game directory
- Look for errors in the game's log files
- Ensure the mod ID in the modinfo file is unique

### Install to Game Button Disabled

- Check that the game is detected (look at the status bar)
- Verify SHARED_DATA paths are valid and writable
- Try running BLP Studio as administrator if permission errors occur
- Check that the game directory hasn't moved or been uninstalled

---

## Best Practices

### Development Workflow

1. Start with **Install to Game** for rapid testing
2. Test your changes thoroughly in-game
3. Once satisfied, use **Export as Mod** for final distribution
4. Include a README with installation instructions
5. Document which textures you've modified

### File Management

- Keep your source DDS files organized in a project folder
- Name files clearly to match the textures they replace
- Back up original CIVBIG files before modifying
- Use version control (Git) for complex mods

### Testing

- Test your mod with a clean game install
- Verify compatibility with popular mods
- Check both the main menu and in-game rendering
- Test on different graphics settings if possible

### Distribution

- Provide clear installation instructions
- List any dependencies (DLC, other mods)
- Include screenshots showing the changes
- Specify which game version your mod is for
- Consider hosting on popular modding sites

---

## Additional Resources

- BLP Studio documentation: Check the wiki for detailed feature guides
- Civilization VII modding community: Forums and Discord servers
- DDS texture tools: NVIDIA Texture Tools, Intel Texture Works
- Art asset guidelines: Match the game's art style for best results

Happy modding!
