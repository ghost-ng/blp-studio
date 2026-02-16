# V1 Animation Keyframe Body Data Structure Analysis

## Executive Summary

The V1 animation keyframe body data uses a **variable-length compression scheme** with a **32-byte floating-point header** followed by **bit-packed compressed keyframe values**. The compression achieves approximately **1.8-3.0 bytes per keyframe entry**.

## Key Findings

### 1. Body Data Structure

```
Body = [32-byte float header] + [variable-length compressed keyframes]
```

**Float Header (32 bytes / 8 floats):**
- Contains quantization parameters and base values for decompression
- Common patterns:
  - Floats [0-1]: Often 0.1 or small values (scale factors?)
  - Floats [2-3]: Position/range values (can be negative)
  - Floats [4-5]: Larger values (bounding box or max values?)
  - Floats [6-7]: Small values (deltas or precision values?)

**Examples:**
- `BLOB_Exp1_Euro_NavalBoat01_CombatWarp01.anim`: `[0.1, 0.1, -2.68, -1.21, 35.64, 0.027, 0.0018, 0.0026]`
- `BLOB_Ant2_Med_CavalryHeavy01_Run01.anim`: `[0.0, 0.36, -0.032, 6.17, 6.73, 0.050, 0.033, 0.368]`

### 2. Compressed Keyframe Data

After the 32-byte header, the data appears to have **two zones**:

**Zone 1: Frame Indices / Selectors (variable length)**
- Small integers (usually 0-7)
- Example: `02 02 00 00 05 04 00 00` (8 bytes)
- Example: `02 02 02 02 02 00 00 00 04 05 04 05 05 00 00 00` (16 bytes)
- Likely indicates which frames have keyframes or compression method per channel

**Zone 2: Packed Keyframe Values**
- Densely packed binary data
- Example: `e3 8a 82 f4 17 cf 31 05 e0 6e 59 58...`
- Contains the actual quantized keyframe values
- Uses variable-bit encoding or byte-aligned quantization

### 3. Segment Group Values

For single-segment files (count1=1), the segment group `[g0, g1, g2, g3]` has these patterns:

- **g0**: Total compressed entries (NOT totalAnim × frameCount)
  - Offset ranges from -36 to +44 compared to expected count
  - Likely counts unique values or compression blocks
  
- **g1 vs g2 split**:
  - **NOT** consistently `g1 = rAnim × frameCount`
  - **NOT** consistently `g2 = (tAnim+sAnim) × frameCount`
  - Only 6/280 files match the g1 = rAnim×frames pattern
  - The split appears more complex (possibly by compression method or data type)

- **g3**: Offset to body data start (from AC base)

### 4. Compression Statistics

**Bytes per entry ratio (bodySize / g0):**
- Minimum: 1.19 bytes/entry
- Maximum: 9.83 bytes/entry
- Median: 3.29 bytes/entry
- Mean: 3.29 bytes/entry

**After excluding 32-byte header (bodySize - 32) / (totalAnim × frameCount):**
- Range: ~1.8 to 3.0 bytes per keyframe entry
- Most files cluster around 2.5-3.0 bytes/entry

**Distribution shows two peaks:**
- Lower compression: ~2.0-2.5 bytes/entry (simpler animations, fewer channels)
- Higher compression: ~3.8-4.0 bytes/entry (complex animations, more channels)

### 5. No Simple Formula Found

None of the tested formulas matched the body size consistently:
- `g0 × 2`: 0/280 matches
- `g0 × 3`: 0/280 matches
- `g0 × 4`: 1/280 matches
- `g0 × 6`: 0/280 matches (3 components × 2 bytes)
- `g0 × 8`: 1/280 matches
- `g1×6 + g2×6`: 0/280 matches
- `g1×8 + g2×6`: 1/280 matches

This confirms **variable-length compression** rather than fixed-size encoding.

## Observations

### Pattern Recognition

1. **The 32-byte header is consistent** across all files
   - Always 8 floats
   - Contains meaningful values (not padding)
   
2. **After header data shows structure**:
   - Small bytes (0-7) appear first → frame selectors/indices
   - Dense packed data follows → compressed values
   
3. **Compression is adaptive**:
   - Simpler animations (fewer channels, fewer frames) → lower bytes/entry
   - Complex animations → higher bytes/entry
   - Likely uses different encoding based on data characteristics

### Multi-segment Files

For files with `count1 > 1` (2210/2490 files):
- Multiple segment groups exist
- Body data calculation is more complex
- Each segment may have its own compression parameters
- Requires segment-aware parsing

## Next Steps

To fully decode the keyframe data, we need to:

1. **Understand the float header semantics**:
   - Identify which floats are min/max values
   - Identify which are scale/quantization factors
   - Determine the coordinate space mapping

2. **Decode the frame selector zone**:
   - Determine the exact structure (fixed size? variable?)
   - Understand what each byte/value represents
   - Map to channel indices and frame numbers

3. **Implement decompression**:
   - Parse bit-packed or byte-aligned quantized values
   - Apply dequantization using header parameters
   - Reconstruct full keyframe data (quaternions/vec3s)

4. **Handle multi-segment files**:
   - Understand segment boundaries
   - Parse multiple compression blocks
   - Merge/concatenate segments properly

## Files Analyzed

- **Total V1 files with animated channels**: 2490
- **Single-segment files (count1=1)**: 280
- **Multi-segment files (count1>1)**: 2210

Analysis focused on single-segment files for simplicity, as they represent the clearest case of the compression format.
