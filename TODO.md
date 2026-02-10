# BLP Studio - Roadmap

## BLP Repackaging & Modification

- [ ] Asset renaming within BLP packages (with conflict validation)
- [ ] BLP repacking engine -- rebuild packages with modified/added/removed assets
- [ ] Blob repacking support -- repack non-texture assets preserving correct offsets
- [ ] Asset replacement validation -- pre-flight checks for format, size, compression compatibility
- [ ] Batch asset import -- import multiple DDS files, auto-match by filename pattern
- [ ] Repack preview/diff -- show what changed before committing (added/removed/modified)
- [ ] Integrity verification -- validate repacked BLP against format spec, test compression
- [ ] Partial repack -- incremental updates for faster mod iteration

## DDS Viewer

- [ ] Pixel inspector -- click to see exact RGBA values and coordinates
- [ ] Texture tiling preview -- 2x2 / 3x3 grid to check seamless tiling
- [ ] Histogram display -- RGB histogram for color distribution analysis
- [ ] Normal map validation -- detect incorrect encoding, offer conversion
- [ ] Cubemap visualization -- unwrapped or 3D preview for environment maps
- [ ] Compression artifact highlighting -- show quality metrics (PSNR), compare vs uncompressed
- [ ] Texture format conversion preview -- compare BC1/BC3/BC7 side by side before saving

## Batch Operations

- [ ] Batch rename with patterns -- find/replace, prefix/suffix, regex
- [ ] Batch compression settings -- apply format/quality across multiple textures
- [ ] Batch mipmap generation -- auto-generate mip chains with selectable filters
- [ ] Batch texture resize -- downscale/upscale preserving aspect ratio and format
- [ ] Export presets -- save/load export profiles (format, quality, naming, directory)

## Modding Workflow

- [ ] Diff against vanilla assets -- compare modified package against original game files
- [ ] Mod package templates -- pre-configured templates for common mod types
- [ ] Asset dependency graph -- visualize texture/material/model relationships
- [ ] Launch external editor -- open asset in GIMP, Paint.NET, etc. directly from BLP Studio
- [ ] Watch folder auto-import -- monitor directory for changed files, auto-update package

## UI / UX

- [ ] Thumbnail grid view -- show texture thumbnails with sorting/filtering
- [ ] Multi-tab interface -- open multiple BLP files for comparison / cross-package ops
- [ ] Keyboard shortcuts -- configurable shortcuts for common operations
- [ ] Drag-and-drop everywhere -- drag DDS into tree, between packages, to desktop
- [ ] Resizable / dockable panels -- customizable workspace layouts
- [ ] Undo/redo system for non-destructive editing
- [ ] Asset preview caching -- faster browsing of large packages
- [ ] Context menu improvements -- right-click menus per asset type
