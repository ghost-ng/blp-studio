/**
 * Oodle compression/decompression wrapper
 *
 * Uses koffi to call OodleLZ_Decompress and OodleLZ_Compress from
 * oo2core_9_win64.dll at runtime. The DLL ships with Civilization VII
 * and is NOT redistributable, so the user must point this wrapper at a
 * local copy.
 *
 * Oodle-compressed buffers can be identified by their first byte being
 * 0x8C (Kraken codec marker).
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const koffi = require('koffi');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type OodleDecompressFn = (
  comp: Buffer,
  compSize: bigint,
  raw: Buffer,
  rawSize: bigint,
  fuzzSafe: number,
  checkCrc: number,
  verbosity: number,
  decBufBase: null,
  decBufSize: bigint,
  fpCallback: null,
  callbackUserData: null,
  decoderMemory: null,
  decoderMemorySize: bigint,
  threadPhase: number,
) => bigint;

type OodleCompressFn = (
  compressor: number,
  rawBuf: Buffer,
  rawLen: bigint,
  compBuf: Buffer,
  level: number,
  pOptions: null,
  dictionaryBase: null,
  lrm: null,
  scratchMem: null,
  scratchSize: bigint,
) => bigint;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Oodle compressor algorithm IDs */
export const OodleCompressor = {
  Kraken: 8,
  Mermaid: 9,
  Selkie: 11,
  Leviathan: 13,
} as const;

/** Oodle compression levels */
export const OodleLevel = {
  None: 0,
  SuperFast: 1,
  VeryFast: 2,
  Fast: 3,
  Normal: 4,
  Optimal1: 5,
  Optimal2: 6,
  Optimal3: 7,
  Optimal4: 8,
  Optimal5: 9,
} as const;

// ---------------------------------------------------------------------------
// Class
// ---------------------------------------------------------------------------

export class OodleDecompressor {
  private decompressFn: OodleDecompressFn;
  private compressFn: OodleCompressFn;

  /**
   * Load the Oodle DLL from the given path and bind the compression
   * and decompression functions. Throws if the DLL cannot be loaded.
   */
  constructor(dllPath: string) {
    const lib = koffi.load(dllPath);

    this.decompressFn = lib.func(
      'int64_t OodleLZ_Decompress(' +
        'void* comp, int64_t compSize, ' +
        'void* raw, int64_t rawSize, ' +
        'int32_t fuzzSafe, int32_t checkCrc, int32_t verbosity, ' +
        'void* decBufBase, int64_t decBufSize, ' +
        'void* fpCallback, void* callbackUserData, ' +
        'void* decoderMemory, int64_t decoderMemorySize, ' +
        'int32_t threadPhase)',
    ) as unknown as OodleDecompressFn;

    this.compressFn = lib.func(
      'int64_t OodleLZ_Compress(' +
        'int32_t compressor, ' +
        'void* rawBuf, int64_t rawLen, ' +
        'void* compBuf, ' +
        'int32_t level, ' +
        'void* pOptions, ' +
        'void* dictionaryBase, ' +
        'void* lrm, ' +
        'void* scratchMem, int64_t scratchSize)',
    ) as unknown as OodleCompressFn;
  }

  /**
   * Decompress an Oodle-compressed buffer.
   *
   * @param compData  The compressed input bytes.
   * @param rawSize   The expected decompressed size in bytes.
   * @returns         A Buffer of `rawSize` bytes on success, or null on failure.
   */
  decompress(compData: Buffer, rawSize: number): Buffer | null {
    const rawBuf = Buffer.alloc(rawSize);

    const result = this.decompressFn(
      compData,
      BigInt(compData.length),
      rawBuf,
      BigInt(rawSize),
      1,  // fuzzSafe
      0,  // checkCrc
      0,  // verbosity
      null,
      BigInt(0),
      null,
      null,
      null,
      BigInt(0),
      0,  // threadPhase
    );

    if (result > 0n) {
      return rawBuf;
    }

    return null;
  }

  /**
   * Compress a buffer using Oodle.
   *
   * @param rawData     The uncompressed input bytes.
   * @param compressor  Compressor algorithm (default: Kraken)
   * @param level       Compression level (default: Normal)
   * @returns           A Buffer with compressed data on success, or null on failure.
   */
  compress(
    rawData: Buffer,
    compressor: number = OodleCompressor.Kraken,
    level: number = OodleLevel.Normal,
  ): Buffer | null {
    const maxSize = OodleDecompressor.getCompressedBounds(rawData.length);
    const compBuf = Buffer.alloc(maxSize);

    const result = this.compressFn(
      compressor,
      rawData,
      BigInt(rawData.length),
      compBuf,
      level,
      null,
      null,
      null,
      null,
      BigInt(0),
    );

    const compSize = Number(result);
    if (compSize > 0) {
      return compBuf.subarray(0, compSize);
    }

    return null;
  }

  /**
   * Calculate the maximum compressed output size for a given input size.
   * Formula from Oodle SDK: rawLen + 274 * ceil(rawLen / 0x40000)
   */
  static getCompressedBounds(rawLen: number): number {
    return rawLen + 274 * Math.ceil((rawLen + 0x3ffff) / 0x40000);
  }

  /**
   * Quick check whether a buffer looks Oodle-compressed.
   * The Kraken codec typically starts with 0x8C.
   */
  static isOodleCompressed(data: Buffer): boolean {
    return data.length > 0 && data[0] === 0x8c;
  }
}
