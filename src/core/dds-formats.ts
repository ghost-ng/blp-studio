/**
 * DDS texture format tables and header generation
 *
 * Provides DXGI format metadata for block-compressed and uncompressed
 * texture formats used in Civilization VII BLP BigData, plus utilities
 * for computing mip-chain sizes and writing DDS file headers with the
 * DX10 extended header.
 */

// ---------------------------------------------------------------------------
// DXGI Block-Compressed Formats
// ---------------------------------------------------------------------------

export const DXGI_BLOCK_FORMATS: Map<number, { name: string; blockSize: number }> = new Map([
  [71, { name: 'BC1_UNORM', blockSize: 8 }],
  [72, { name: 'BC1_UNORM_SRGB', blockSize: 8 }],
  [74, { name: 'BC2_UNORM', blockSize: 16 }],
  [75, { name: 'BC2_UNORM_SRGB', blockSize: 16 }],
  [77, { name: 'BC3_UNORM', blockSize: 16 }],
  [78, { name: 'BC3_UNORM_SRGB', blockSize: 16 }],
  [80, { name: 'BC4_UNORM', blockSize: 8 }],
  [81, { name: 'BC4_SNORM', blockSize: 8 }],
  [83, { name: 'BC5_UNORM', blockSize: 16 }],
  [84, { name: 'BC5_SNORM', blockSize: 16 }],
  [95, { name: 'BC6H_UF16', blockSize: 16 }],
  [96, { name: 'BC6H_SF16', blockSize: 16 }],
  [98, { name: 'BC7_UNORM', blockSize: 16 }],
  [99, { name: 'BC7_UNORM_SRGB', blockSize: 16 }],
]);

// ---------------------------------------------------------------------------
// DXGI Uncompressed Formats
// ---------------------------------------------------------------------------

export const DXGI_UNCOMPRESSED: Map<number, { name: string; bpp: number }> = new Map([
  [10, { name: 'R16G16B16A16_FLOAT', bpp: 8 }],
  [28, { name: 'R8G8B8A8_UNORM', bpp: 4 }],
  [29, { name: 'R8G8B8A8_UNORM_SRGB', bpp: 4 }],
  [34, { name: 'R16G16_FLOAT', bpp: 4 }],
  [61, { name: 'R8_UNORM', bpp: 1 }],
  [87, { name: 'B8G8R8A8_UNORM', bpp: 4 }],
]);

// ---------------------------------------------------------------------------
// Blob type metadata
// ---------------------------------------------------------------------------

export const BLOB_TYPES: Map<number, { name: string; ext: string }> = new Map([
  [0, { name: 'heightmap', ext: '.hmu' }],
  [1, { name: 'blend_heightmap', ext: '.bmu' }],
  [2, { name: 'idmap', ext: '.idm' }],
  [3, { name: 'material_id', ext: '.mid' }],
  [5, { name: 'animation', ext: '.anim' }],
  [6, { name: 'stateset', ext: '.ssid' }],
  [7, { name: 'audio', ext: '.wav' }],
  [9, { name: 'blend_mesh', ext: '.bmu' }],
  [11, { name: 'mesh', ext: '.bin' }],
  [12, { name: 'skeleton', ext: '.skel' }],
  [13, { name: 'collision', ext: '.bin' }],
]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Return the human-readable name for a DXGI format id, or "UNKNOWN_<id>"
 * if the format is not in either table.
 */
export function dxgiName(fmtId: number): string {
  const block = DXGI_BLOCK_FORMATS.get(fmtId);
  if (block) return block.name;

  const uncomp = DXGI_UNCOMPRESSED.get(fmtId);
  if (uncomp) return uncomp.name;

  return `UNKNOWN_${fmtId}`;
}

/**
 * Compute the total byte size of a full mip chain for the given texture
 * dimensions and DXGI format.
 */
export function calcTextureSize(
  width: number,
  height: number,
  mipCount: number,
  dxgiFmt: number,
): number {
  const blockFmt = DXGI_BLOCK_FORMATS.get(dxgiFmt);
  let total = 0;

  let w = width;
  let h = height;

  for (let mip = 0; mip < mipCount; mip++) {
    if (blockFmt) {
      const bw = Math.max(1, Math.floor((w + 3) / 4));
      const bh = Math.max(1, Math.floor((h + 3) / 4));
      total += bw * bh * blockFmt.blockSize;
    } else {
      const uncomp = DXGI_UNCOMPRESSED.get(dxgiFmt);
      const bpp = uncomp ? uncomp.bpp : 4;
      total += w * h * bpp;
    }
    w = Math.max(1, w >> 1);
    h = Math.max(1, h >> 1);
  }

  return total;
}

/**
 * Build a 148-byte DDS header (128-byte base + 20-byte DX10 extension)
 * suitable for writing directly to disk before the raw pixel data.
 */
export function makeDdsHeader(
  width: number,
  height: number,
  mipCount: number,
  dxgiFmt: number,
): Buffer {
  // -- Base header (128 bytes) --
  const header = Buffer.alloc(128);

  // Magic 'DDS '
  header.writeUInt32LE(0x20534444, 0);

  // dwSize (always 124)
  header.writeUInt32LE(124, 4);

  // dwFlags
  let flags = 0x1 | 0x2 | 0x4 | 0x1000; // CAPS | HEIGHT | WIDTH | PIXELFORMAT
  if (mipCount > 1) flags |= 0x20000; // MIPMAPCOUNT
  const blockFmt = DXGI_BLOCK_FORMATS.get(dxgiFmt);
  let pitch: number;
  if (blockFmt) {
    flags |= 0x80000; // LINEARSIZE
    pitch = Math.max(1, Math.floor((width + 3) / 4)) * blockFmt.blockSize;
  } else {
    flags |= 0x8; // PITCH
    const uncomp = DXGI_UNCOMPRESSED.get(dxgiFmt);
    const bpp = uncomp ? uncomp.bpp : 4;
    pitch = width * bpp;
  }
  header.writeUInt32LE(flags, 8);

  // dwHeight, dwWidth
  header.writeUInt32LE(height, 12);
  header.writeUInt32LE(width, 16);

  // dwPitchOrLinearSize
  header.writeUInt32LE(pitch, 20);

  // dwDepth
  header.writeUInt32LE(1, 24);

  // dwMipMapCount
  header.writeUInt32LE(mipCount, 28);

  // dwReserved1[11] -- bytes 32..75 stay zero

  // Pixel format struct at offset 76
  // ddspf.dwSize
  header.writeUInt32LE(32, 76);

  // ddspf.dwFlags = DDPF_FOURCC
  header.writeUInt32LE(0x4, 80);

  // ddspf.dwFourCC = 'DX10'
  header[84] = 0x44; // 'D'
  header[85] = 0x58; // 'X'
  header[86] = 0x31; // '1'
  header[87] = 0x30; // '0'

  // dwCaps
  let caps = 0x1000; // DDSCAPS_TEXTURE
  if (mipCount > 1) caps |= 0x8 | 0x400000; // COMPLEX | MIPMAP
  header.writeUInt32LE(caps, 108);

  // dwCaps2..dwCaps4, dwReserved2 stay zero (bytes 112..127)

  // -- DX10 extended header (20 bytes) --
  const dx10 = Buffer.alloc(20);

  // dxgiFormat
  dx10.writeUInt32LE(dxgiFmt, 0);

  // resourceDimension = D3D10_RESOURCE_DIMENSION_TEXTURE2D (3)
  dx10.writeUInt32LE(3, 4);

  // miscFlag
  dx10.writeUInt32LE(0, 8);

  // arraySize
  dx10.writeUInt32LE(1, 12);

  // miscFlags2
  dx10.writeUInt32LE(0, 16);

  return Buffer.concat([header, dx10]);
}

/**
 * Determine the appropriate file extension for a BigData blob based on
 * its type code and, when available, a sniff of the payload bytes.
 */
export function blobExtension(data: Buffer, blobType: number): string {
  const entry = BLOB_TYPES.get(blobType);
  if (entry) return entry.ext;

  // Fallback: sniff common signatures
  if (data.length >= 4) {
    const magic = data.subarray(0, 4);
    if (magic.toString('ascii') === 'RIFF') return '.wav';
    if (magic.toString('ascii') === 'OggS') return '.ogg';
    if (magic[0] === 0x89 && magic.toString('ascii', 1, 4) === 'PNG') return '.png';
  }

  return '.bin';
}
