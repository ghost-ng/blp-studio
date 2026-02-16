# V1 AC11AC11 Compressed Animation Format — Reverse Engineering Progress

## Status: IN PROGRESS
Last updated: 2025-02-14

### What works
- V0 uncompressed animations (play correctly)
- V1 section navigation (offsets, sizes verified across files)
- V1 constant data reading (rotations, positions, scales)
- V1 bitfield parsing (MSB-first, per-group word-aligned)
- V1 animated header reading (offset/scale per channel)
- V1 segment body bitstream reading (variable bit-width dequantization)

### What's broken
- V1 animations still visually collapse to a line (skeleton doesn't animate properly)
- Rotation values sometimes exceed [-1, 1] range (invalid quaternion components)
- `bpf` doesn't exactly match `g[0]` — off by ~177 bits for 944-channel file
- Possible init data (totalAnim * 6 bytes gap) not yet used
- Scale values are all 0.1 — suspicious (may collapse skeleton)

---

## File Structure

```
Offset   Size   Field
0x00     4      Magic: 0x6AB06AB0
0x04     4      Total size of file (from 0x00)
0x08     4      FPS (float)
0x0C     4      Frame count (uint32)
0x10     4      Bone count in file header
...
0x48     4      Version marker (0xFFFFFFFF = V0, else V1)
...
0x5C     4      AC11AC11 magic (V1 subheader marker)
0x60     ---    Start of V1 inner data (AC = 0x60)
```

## V0 (Uncompressed)

Marker: `0xFFFFFFFF` at offset 0x48.
Keyframes start at 0x60. Each frame has `boneCount` bones, each bone is 10 floats (40 bytes):
`[qw, qx, qy, qz, px, py, pz, sx, sy, sz]`

## V1 (AC11AC11 Compressed)

### Inner Header (relative to AC = 0x60)

```
AC+0x00  4   V1 block total size (bytes from AC)
AC+0x04  4   ?
AC+0x08  4   ?
AC+0x0C  4   ?
AC+0x10  4   V1 bone count (may differ from file header bone count)
AC+0x14  4   Last frame index
AC+0x18  4   FPS (float, matches file header)
AC+0x1C  4   ?
AC+0x20  4   count1 — number of time segments
AC+0x24  4   totalAnim — total animated channels (rAnim + tAnim + sAnim)
AC+0x28  4   rAnim — number of animated rotation channels
AC+0x2C  4   tAnim — number of animated position channels
AC+0x30  4   sAnim — number of animated scale channels
AC+0x34  4   valA — number of constant rotation entries
AC+0x38  4   valB — number of constant position entries
AC+0x3C  4   valC — number of constant scale entries
AC+0x40  4   Sentinel (0xFFFFFFFF)
AC+0x44  4   secOff[0] — offset to segment groups (from BASE)
AC+0x48  4   secOff[1] — offset to bitfield (from BASE)
AC+0x4C  4   secOff[2] — offset to constant data (from BASE)
AC+0x50  4   secOff[3] — offset to animated headers (from BASE)
AC+0x54  ---  Start of frame data (dataStart)
```

**CRITICAL**: All section offsets are relative to **BASE = AC + 0x20 = 0x80**, NOT to dataStart (AC + 0x54 = 0xB4). The 52-byte difference (0xB4 - 0x80 = 0x34) was the "mystery gap" that took multiple sessions to figure out.

### Section Layout

All offsets below are absolute: `BASE + secOff[N]`

#### Frame Boundaries (at dataStart = AC + 0x54)
- If `count1 >= 2`: array of `count1` uint32 frame indices + 1 uint32 sentinel
- If `count1 == 1`: implicit single segment [0, frameCount)
- Example: `[0, 17, 34, 51, 68, 85, 102, 119, 136, 153, 170, 0xFFFFFFFF]` for count1=11

#### Section 0: Segment Groups (at BASE + secOff[0])
- `count1 × 16` bytes
- Each group: `[bitsPerFrame(u32), rotBits(u32), otherBits(u32), bodyOffset(u32)]`
- `bitsPerFrame = rotBits + otherBits` (total bits per frame in this segment)
- `bodyOffset` is relative to BASE (absolute body position = BASE + bodyOffset)
- `rotBits` and `otherBits` split the per-frame bits between rotation and position/scale channels

#### Section 1: Bitfield (at BASE + secOff[1])
- Size: `secOff[2] - secOff[1]` bytes
- Per-group word-aligned layout: each channel group (R, T, S) occupies `ceil(boneCount/16)` uint32 words
- Stride = `ceil(boneCount/16) × 16` entries per group
- **MSB-first** bit extraction: `(word >>> (30 - i*2)) & 3` for entry i within each word
- Channel types: 0 = identity/rest-pose, 1 = constant, 2 = animated
- Layout: `[R₀..Rₙ padding] [T₀..Tₙ padding] [S₀..Sₙ padding]`

**Verification**: After MSB extraction:
- Count of type-1 R entries should equal `valA`
- Count of type-1 T entries should equal `valB`
- Count of type-1 S entries should equal `valC`
- Count of type-2 R entries should equal `rAnim` (from AC+0x28)
- Count of type-2 T entries should equal `tAnim` (from AC+0x2C)
- Count of type-2 S entries should equal `sAnim` (from AC+0x30)

Example bitfield word `0x0AAAAAAA` (MSB-first):
- Entries 0-1: type 0 (identity), entries 2-15: type 2 (animated)

#### Section 2: Constant Data (at BASE + secOff[2])
Sequential:
1. `valA × 12` bytes: constant rotations (3 × float32 xyz, reconstruct w = sqrt(1 - x² - y² - z²))
2. `valB × 12` bytes: constant positions (3 × float32 xyz)
3. `valC × 12` bytes: constant scales (3 × float32 xyz)

#### Section 3: Animated Channel Headers (at BASE + secOff[3])
- `totalAnim × 24` bytes
- Each header: `[offset_x, offset_y, offset_z, scale_x, scale_y, scale_z]` (6 × float32)
- Channel ordering: first `rAnim` rotation channels, then `tAnim` position channels, then `sAnim` scale channels
- Dequantization: `value = offset + (quantized / maxQ) * scale` where `maxQ = (1 << bitWidth) - 1`

### Per-Segment Body (at BASE + segGroup[seg].bodyOffset)

```
[totalAnim bytes: per-channel bit widths]
[totalAnim × 6 bytes: init data (3 × uint16 per channel) — PURPOSE UNKNOWN]
[bitstream: bitsPerFrame × segFrames bits, byte-aligned at end]
```

- Bit width of 0 = channel is constant at `offset` for this segment
- Bitstream is read from the END of the segment body backwards:
  `bitstreamStart = nextSegmentBody - ceil(bitsPerFrame × segFrames / 8)`
- Within the bitstream, for each frame × each channel: read `bitWidth × 3` bits (3 components)
- Bit reading is LSB-first within bytes

### Dequantization

For each animated channel with bit width `w > 0`:
```
maxQ = (1 << w) - 1
for each component i in [0, 1, 2]:
    quantized = readBits(w)  // from bitstream
    value = header.offset[i] + (quantized / maxQ) * header.scale[i]
```

For rotation channels (smallest-3 quaternion):
```
x, y, z = dequantized values
sumSq = x² + y² + z²
w = sumSq <= 1.0 ? sqrt(1.0 - sumSq) : 0
quaternion = [w, x, y, z]
```

---

## Discoveries Timeline

### Session 1-2: Initial V1 parsing
- Identified AC11AC11 subheader, segment groups, bitfield, constants
- First implementation used wrong offsets — data read from wrong positions

### Session 3: Section offset base
- **Key discovery**: Section offsets relative to BASE (AC+0x20), not dataStart (AC+0x54)
- The 52-byte gap = dataStart - BASE = 0x34
- Verified across 4 test files with different count1 values (8, 10, 11, 17)

### Session 3: Bitfield bit order
- **Key discovery**: Bitfield uses MSB-first extraction, not LSB-first
- `(word >>> (30 - i*2)) & 3` instead of `(word >>> (i*2)) & 3`
- Proof: MSB-first gives channel counts matching all header values (valA/B/C and rAnim/tAnim/sAnim)
- LSB-first was off by 6 for every group due to padding/bone-boundary entries being swapped
- Confirmed with DwAttacker file where `valB=1`: MSB gives exactly 1 constant position at bone 1

### Session 3: Body layout
- Init data gap = `totalAnim × 6` bytes between bit widths and bitstream
- With correct totalAnim (944), gap is exactly 5664 = 944 × 6
- Purpose of init data still unknown (possibly per-segment initial quantized values?)

### Session 4: Quaternion normalization + position scaling (STILL BROKEN)

**Applied fixes:**
- Quaternion normalization after smallest-3 reconstruction (both constant and animated)
- Position × 10 scaling for both constant and animated positions
- Scale override to [1,1,1]

**Result:** Skeleton STILL collapses when V1 animation is applied. Rest pose renders fine.

**Analysis of V1 positions vs rest pose:**
- bone2: V1 pos z=8.74, rest LOCAL z=89.19, rest WORLD z≈89.19 → ratio ≈ 10.2×
- bone3: V1 pos z=9.13, rest LOCAL z=90.17, rest WORLD z≈90.17 → ratio ≈ 9.9×
- For bones 2-3, local ≈ world because parents (bones 0-1) are at origin with identity rotation
- bone2 y: -0.08 vs rest -0.83, ratio ≈ 10.4×

**Key question: Are V1 positions LOCAL or WORLD?**
For early bones (parents at origin), local = world, so can't distinguish.
For deeper bones with non-trivial parent transforms, the distinction matters critically:
- If LOCAL × 0.1: multiply by 10 → correct local positions for viewer chaining ✓
- If WORLD × 0.1: multiply by 10 → world positions fed into viewer chaining → WRONG positions
  - Would need: `local = inv(parent_world_rot) × (world - parent_world_pos)`

The simple ×10 approach was tried and didn't fix the issue. This strongly suggests V1 positions
are WORLD-SPACE × 0.1 (not local), and need world-to-local conversion using parent hierarchy.

**Skeleton file "localPosition" field (offset 0x0E0) might actually be world-like:**
- bone2 "localPosition" z = 89.19 is very large for a local offset from parent
- bone3 "localPosition" z = 90.17 similarly large
- If these bones are children of bone0/1 (at origin), local = world, so field is technically correct
- For deeper bones, need to check if skeleton localPosition truly differs from worldPosition

**The `scaled world position` field at skeleton offset 0x100:**
- Format: `[x×scale, y×scale, z×scale, scale]` where scale ≈ 0.1
- This field's values would match V1 positions exactly → V1 stores scaled world positions

**Next steps to try:**
1. Need to verify whether V1 positions are truly world-space by checking deeper bones
   (bones with parents that have non-trivial rotation, e.g., arm/hand bones)
2. If confirmed world-space, implement world-to-local conversion:
   - For each frame, iterate bones in parent-first order
   - Chain local rotations to get world rotations
   - Convert: `local_pos = inv(parent_world_rot) × (V1_pos × 10 - parent_world_pos)`
3. Alternative theory: maybe the init data (totalAnim × 6 bytes) contains something critical
   that we're skipping, causing the bitstream to be misaligned
4. Alternative theory: maybe the bitstream reading is wrong — could be reading frames
   in wrong order, or channels in wrong order within the bitstream

**Other possible issues not yet investigated:**
- Init data (totalAnim × 6 bytes gap) is completely ignored — could contain base values
  for delta encoding, meaning our dequantized values are offsets from initial values
- Bitstream byte order or bit reading direction could be wrong for some segments
- Multi-segment boundary handling — frame transitions between segments

---

## Open Questions

1. **Init data**: 6 bytes per channel (3 × uint16?) between bit widths and bitstream. Not currently used. Could be:
   - Initial quantized values for delta encoding?
   - Per-segment base values?
   - Quantization range overrides?
   - **HIGH PRIORITY**: If these are initial values for delta encoding, skipping them would make
     ALL animated values wrong, potentially explaining the collapse.

2. **~~bpf mismatch~~**: RESOLVED — after MSB bitfield fix, `bpf` matches `g[0]` exactly.

3. **Scale 0.1**: All constant scales are [0.1, 0.1, 0.1]. Currently overridden to [1,1,1].
   The 0.1 factor appears to be a coordinate-space scale applied to positions.

4. **Rotation range**: Some dequantized rotation components exceed [-1, 1]. Now handled
   by normalizing quaternion after smallest-3 reconstruction.

5. **V1 position space**: Are positions local × 0.1 or world × 0.1? Critical for correct
   rendering. Evidence points to world × 0.1 based on skeleton's `scaled world position` field.

---

## Test Files

| File | Bones | Segments | Frames | totalAnim | rAnim | tAnim | sAnim | valA | valB | valC |
|------|-------|----------|--------|-----------|-------|-------|-------|------|------|------|
| LEAD_BRIT_Ada_VO_Reject | 474 | 11 | 192 | 944 | 472 | 472 | 0 | 0 | 0 | 474 |
| LEAD_BRIT_Ada_VO_FirstMeet | 474 | 17 | 277 | 944 | 472 | 472 | 0 | 0 | 0 | 474 |
| LEAD_BRIT_Ada_VO_DwAttacker | 474 | 21 | 351 | 944 | 472 | 472 | 0 | 0 | 1 | 474 |

All test files have: 472 animated rotations, 472 animated positions, 0 animated scales, 474 constant scales = [0.1, 0.1, 0.1] each. Bones 0-1 are identity (rest pose) for both R and T.
