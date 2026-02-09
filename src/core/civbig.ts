/**
 * CIVBIG file format reader/writer
 *
 * CIVBIG is the container for BigData blobs referenced by BLP packages.
 * Each file has a 16-byte header followed by raw payload data.
 *
 * Header layout (16 bytes, all little-endian):
 *   [0..5]   "CIVBIG" magic (6 bytes ASCII)
 *   [6..7]   padding (2 zero bytes)
 *   [8..11]  u32 dataSize
 *   [12..13] u16 dataOffset (always 0x10)
 *   [14..15] u16 typeFlag (0=gpu, 1=texture, 2=blob, 3=soundbank)
 */

import { readFileSync, writeFileSync } from 'fs';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAGIC = Buffer.from('CIVBIG', 'ascii');
const HEADER_SIZE = 16;
const ALIGNMENT = 512;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CivbigInfo {
  dataSize: number;
  dataOffset: number;
  typeFlag: number; // 0=gpu, 1=texture, 2=blob, 3=soundbank
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function validateHeader(buf: Buffer, filepath: string): void {
  if (buf.length < HEADER_SIZE) {
    throw new Error(`CIVBIG file too small (${buf.length} bytes): ${filepath}`);
  }
  if (buf.compare(MAGIC, 0, MAGIC.length, 0, MAGIC.length) !== 0) {
    const got = buf.subarray(0, 6).toString('ascii');
    throw new Error(`Bad CIVBIG magic "${got}" in: ${filepath}`);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Read the metadata fields from a CIVBIG file without loading the payload.
 */
export function readCivbigInfo(filepath: string): CivbigInfo {
  const buf = readFileSync(filepath);
  validateHeader(buf, filepath);

  const dataSize = buf.readUInt32LE(8);
  const dataOffset = buf.readUInt16LE(12);
  const typeFlag = buf.readUInt16LE(14);

  return { dataSize, dataOffset, typeFlag };
}

/**
 * Read a CIVBIG file and return the payload data and type flag.
 */
export function readCivbig(filepath: string): { data: Buffer; typeFlag: number } {
  const buf = readFileSync(filepath);
  validateHeader(buf, filepath);

  const dataSize = buf.readUInt32LE(8);
  const dataOffset = buf.readUInt16LE(12);
  const typeFlag = buf.readUInt16LE(14);

  if (buf.length < dataOffset + dataSize) {
    throw new Error(
      `CIVBIG payload truncated: expected ${dataSize} bytes at offset ${dataOffset}, ` +
        `but file is only ${buf.length} bytes: ${filepath}`,
    );
  }

  const data = buf.subarray(dataOffset, dataOffset + dataSize);
  return { data, typeFlag };
}

/**
 * Write a CIVBIG file with the standard 16-byte header, payload data,
 * and zero-padding to 512-byte alignment.
 */
export function writeCivbig(filepath: string, data: Buffer, typeFlag: number): void {
  const header = Buffer.alloc(HEADER_SIZE);

  // Magic
  MAGIC.copy(header, 0);
  // bytes 6-7 stay zero (padding)

  // Data size
  header.writeUInt32LE(data.length, 8);

  // Data offset (always 0x10 = 16)
  header.writeUInt16LE(HEADER_SIZE, 12);

  // Type flag
  header.writeUInt16LE(typeFlag, 14);

  // Calculate total size with padding to 512-byte alignment
  const rawSize = HEADER_SIZE + data.length;
  const paddedSize = Math.ceil(rawSize / ALIGNMENT) * ALIGNMENT;
  const padBytes = paddedSize - rawSize;

  const out = Buffer.concat([header, data, Buffer.alloc(padBytes)]);
  writeFileSync(filepath, out);
}
