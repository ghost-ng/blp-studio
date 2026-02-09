# Troubleshooting

Common issues and solutions for BLP Studio.

---

## "No Oodle DLL found" / Compressed textures appear blank

**Problem:** Texture previews show as blank or the app displays a warning about missing Oodle DLL.

**Cause:** The app needs `oo2core_9_win64.dll` to decompress Oodle Kraken-compressed textures used by Civilization VII.

**Solution:**

1. **Auto-detection:** BLP Studio automatically searches the Civ VII Steam install directory and common game locations for the DLL.

2. **Manual fix:** If auto-detection fails, copy `oo2core_9_win64.dll` from your Civ VII installation directory into the app's `resources/` folder.

3. **DLL location:** The DLL is typically found at:
   ```
   Steam\steamapps\common\Sid Meier's Civilization VII\Binaries\Win64Steam\oo2core_9_win64.dll
   ```

**Note:** `oo2core_9_win64.dll` is proprietary software owned by Epic Games and cannot be redistributed with BLP Studio. You must obtain it from your own game installation.

---

## "Game not detected" / Install to Game is disabled

**Problem:** The "Install to Game" button is disabled or the app cannot find your Civilization VII installation.

**Cause:** BLP Studio searches standard Steam installation paths, but your game may be installed in a non-standard location.

**Solutions:**

1. **Check the status bar:** Look at the bottom of the window. It should display the detected SHARED_DATA paths. If nothing is shown, the game was not detected.

2. **Open a game BLP file:** Navigate to your Civ VII installation directory and open any BLP file from there. The app will auto-detect the game root from the file path.

3. **SHARED_DATA location:** The app searches for SHARED_DATA directories at:
   ```
   <game_root>/base-standard/Platforms/Windows/BLPs/SHARED_DATA/
   ```

4. **Verify installation:** Ensure Civilization VII is actually installed and the directory structure is intact.

---

## Texture preview shows nothing / black square

**Problem:** The texture preview panel displays a black square or nothing at all.

**Possible causes and solutions:**

1. **Missing CIVBIG file:** The texture's CIVBIG file may not exist in SHARED_DATA. Check the Properties panel for "Source Path" to verify the file location.

2. **Unsupported format:** The texture format may not be supported. Currently supported formats:
   - BC1 (DXT1)
   - BC3 (DXT5)
   - BC4
   - BC5
   - BC7

3. **Very large textures:** Textures larger than 4096x4096 have preview disabled to prevent memory issues.

4. **Extract and view externally:** Try using "Extract All" to save the raw DDS file and open it in an external DDS viewer (e.g., Paint.NET, Photoshop with DDS plugin).

---

## "Dimension mismatch" warning when replacing

**Problem:** When replacing a texture, you see a warning about dimension mismatch.

**Explanation:** This warning appears when your replacement DDS file has different dimensions (width/height) than the original texture.

**Impact:** The replacement will still be applied, but the game may or may not handle the different size correctly. Some textures have hardcoded size expectations.

**Best practice:** Always match the original texture dimensions exactly to ensure compatibility.

---

## Replacement doesn't appear in game

**Problem:** After installing replacements to the game, changes do not appear in-game.

**Troubleshooting steps:**

1. **Close the game:** Make sure Civilization VII is not running when you install changes. The game loads assets at startup and won't pick up changes made while running.

2. **Verify SHARED_DATA path:** Check the status bar at the bottom of BLP Studio to ensure the SHARED_DATA path matches your actual game installation.

3. **Check Steam integrity:** Steam's "Verify Integrity of Game Files" feature may revert your changes. Avoid running this unless you want to restore original files.

4. **Mod exports:** If exporting as a mod, ensure the mod folder is in the correct location:
   - Base content: `base-standard/`
   - DLC content: `content/dlc/`

5. **Verify CIVBIG files were written:** Navigate to the output directory and check that the CIVBIG files were actually created/modified. Check file timestamps to confirm they were recently written.

6. **File permissions:** Ensure the SHARED_DATA directory is writable (not read-only).

---

## App crashes when opening large BLP files

**Problem:** BLP Studio crashes or becomes unresponsive when opening certain BLP files.

**Explanation:** Some BLP files reference thousands of assets. This is normal for large package files like UI or VFX.

**Solutions:**

1. **Close other applications:** If the app runs out of memory, free up RAM by closing other programs.

2. **Preview limits:** The app automatically limits texture preview to 4096x4096 to prevent out-of-memory errors. This should handle most files.

3. **System requirements:** Working with large BLP files requires adequate RAM (8GB minimum, 16GB recommended).

4. **Report persistent crashes:** If a specific file consistently crashes the app, please report it as a bug (see "How to report a bug" below).

---

## DDS Viewer shows wrong colors

**Problem:** Texture colors appear incorrect or washed out in the preview.

**Possible causes:**

1. **Uncommon DDS variants:** Some DDS format variants may not be perfectly decoded, especially rare or non-standard ones.

2. **BC7 decoding:** BC7 decoding is CPU-based and should be accurate for most cases. If colors look wrong, there may be an edge case in the decoder.

3. **SRGB formats:** SRGB variants (BC1_UNORM_SRGB, BC7_UNORM_SRGB) are decoded but the preview does not apply gamma correction, which may make colors appear different than in-game.

4. **Check DXGI format:** Look at the DXGI format field in the Properties panel to verify the format is what you expect.

**Workaround:** Extract the DDS file and open it in an external viewer to compare. If the external viewer shows the same colors, the issue may be with the source data.

---

## Batch DDS export fails on some files

**Problem:** When performing a batch export, some files fail to export.

**Cause:** Files must be valid DDS with either standard or DX10 headers. Corrupt or truncated DDS files will be skipped.

**Troubleshooting:**

1. **Check the error list:** The batch export results dialog shows specific failure messages for each failed file.

2. **Validate source files:** Ensure the DDS files you're trying to export are valid and can be opened in other DDS viewers.

3. **File corruption:** Truncated or partially written DDS files will fail. Re-export or re-save the problematic files.

4. **Unsupported formats:** Some exotic DDS formats may not be supported. Check the DXGI format.

---

## How to report a bug

If you encounter an issue not covered here, please report it:

1. **Open GitHub issues:** Go to Help > Report Issue in the menu, which opens the GitHub issues page.

2. **Include these details:**
   - What you were doing when the issue occurred
   - What actually happened
   - What you expected to happen
   - Steps to reproduce the issue

3. **Include specifics:**
   - The BLP filename and asset name (if applicable)
   - The error message (if one was shown)
   - Screenshots (if helpful)
   - Your system information (OS version, RAM, etc.)

4. **Check for duplicates:** Before creating a new issue, search existing issues to see if your problem has already been reported.

**GitHub repository:** Include the link to your project's GitHub issues page here.

---

## Additional Resources

- [Getting Started Guide](Getting-Started.md)
- [Format Specification](../docs/BLP_FORMAT_SPEC.md)
- [API Documentation](API-Documentation.md)

---

**Last updated:** 2026-02-08
