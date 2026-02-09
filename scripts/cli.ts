#!/usr/bin/env npx tsx
/**
 * BLP Studio CLI — headless tool for debugging the BLP parser
 *
 * Usage:
 *   npx tsx scripts/cli.ts <command> [args...]
 *
 * Commands:
 *   info <file.blp>         Show BLP header, preamble, stripes, allocations
 *   assets <file.blp>       List all assets (textures, blobs, gpu, sounds)
 *   types <file.blp>        Dump all type definitions from the TypeInfoStripe
 *   alloc <file.blp> [n]    Show allocation table (optionally limit to n entries)
 *   preview <file.blp> <name>  Test texture preview pipeline for an asset
 *   shared-data             Scan and report SHARED_DATA directories
 *   oodle                   Test Oodle DLL loading
 *   civbig <file>            Read and dump a CIVBIG file header
 *   hexdump <file.blp> <n>  Hex dump allocation n's raw data
 */

import { readFileSync, existsSync } from 'fs';
import { join, resolve, basename } from 'path';
import { BLPParser } from '../src/core/blp-parser';
import { dxgiName, calcTextureSize, BLOB_TYPES } from '../src/core/dds-formats';
import { readCivbig, readCivbigInfo } from '../src/core/civbig';
import {
  findGameRoot,
  findAllSharedData,
  findSharedDataCandidates,
  findOodleCandidates,
  buildSharedDataIndex,
  findGameRootFromPath,
} from '../src/core/game-detect';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function hexdump(data: Buffer, maxRows = 32): void {
  const rows = Math.min(maxRows, Math.ceil(data.length / 16));
  for (let row = 0; row < rows; row++) {
    const off = row * 16;
    const bytes = data.subarray(off, Math.min(off + 16, data.length));
    const hex: string[] = [];
    for (let i = 0; i < 16; i++) {
      hex.push(i < bytes.length ? bytes[i].toString(16).padStart(2, '0') : '  ');
    }
    let ascii = '';
    for (let i = 0; i < bytes.length; i++) {
      const b = bytes[i];
      ascii += (b >= 0x20 && b <= 0x7e) ? String.fromCharCode(b) : '.';
    }
    console.log(
      `  ${off.toString(16).padStart(8, '0')}  ${hex.slice(0, 8).join(' ')}  ${hex.slice(8).join(' ')}  |${ascii}|`
    );
  }
  if (data.length > maxRows * 16) {
    console.log(`  ... ${formatSize(data.length - maxRows * 16)} remaining`);
  }
}

function die(msg: string): never {
  console.error(`Error: ${msg}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

function cmdInfo(filepath: string): void {
  console.log(`\n=== BLP Info: ${basename(filepath)} ===\n`);

  const parser = new BLPParser(filepath);
  parser.parse();

  const h = parser.header;
  console.log(`File Header:`);
  console.log(`  Magic:            ${h.magic}`);
  console.log(`  Version:          ${h.version}`);
  console.log(`  PkgDataOffset:    0x${h.packageDataOffset.toString(16)} (${h.packageDataOffset})`);
  console.log(`  PkgDataSize:      ${formatSize(h.packageDataSize)}`);
  console.log(`  BigDataOffset:    0x${h.bigDataOffset.toString(16)} (${formatSize(h.bigDataOffset)})`);
  console.log(`  BigDataCount:     ${h.bigDataCount}`);
  console.log(`  FileSize:         ${formatSize(h.fileSize)}`);

  const p = parser.preamble;
  console.log(`\nPreamble:`);
  console.log(`  PackageVersion:   ${p.packageVersion}`);
  console.log(`  PointerSize:      ${p.sizeofVoidPointer}`);
  console.log(`  Align64:          ${p.alignof64Bit}`);
  console.log(`  HeaderSize:       ${p.sizeofPackageHeader}`);

  const ph = parser.pkgHeader;
  console.log(`\nStripes:`);
  const stripeNames = ['ResourceLinker', 'PackageBlock', 'TempData', 'TypeInfo', 'RootTypeName'];
  const stripes = [ph.resourceLinkerData, ph.packageBlock, ph.tempData, ph.typeInfo, ph.rootTypeName];
  for (let i = 0; i < 5; i++) {
    const s = stripes[i];
    console.log(`  [${i}] ${stripeNames[i].padEnd(16)} offset=0x${s.offset.toString(16).padStart(6, '0')}  size=${formatSize(s.size)}`);
  }
  console.log(`  LinkerDataOffset: 0x${ph.linkerDataOffset.toString(16)}`);

  console.log(`\nAllocations: ${parser.allocations.length} entries`);

  // Type registry summary
  const reg = parser.typeRegistry;
  if (reg) {
    console.log(`\nType Registry: ${reg.types.size} types, ${reg.enums.size} enums`);
  }
}

function cmdAssets(filepath: string): void {
  console.log(`\n=== Assets: ${basename(filepath)} ===\n`);

  const parser = new BLPParser(filepath);
  parser.parse();

  const counts = { texture: 0, blob: 0, gpu: 0, sound: 0 };
  const seen = new Set<string>();

  // Textures
  for (const alloc of parser.iterEntriesByType('BLP::TextureEntry')) {
    const obj = parser.deserializeAlloc(alloc);
    const name = obj.m_Name as string;
    if (!name || seen.has(name)) continue;
    seen.add(name);
    counts.texture++;
    const w = (obj.m_nWidth as number) || 0;
    const h = (obj.m_nHeight as number) || 0;
    const mips = (obj.m_nMips as number) || 1;
    const fmt = (obj.m_eFormat as number) || 0;
    const size = calcTextureSize(w, h, mips, fmt);
    console.log(`  [TEX]  ${name.padEnd(50)} ${w}x${h} mips=${mips} fmt=${dxgiName(fmt)} raw=${formatSize(size)}`);
  }

  // Blobs
  for (const alloc of parser.iterEntriesByType('BLP::BlobEntry')) {
    const obj = parser.deserializeAlloc(alloc);
    const name = obj.m_Name as string;
    if (!name || seen.has(name)) continue;
    seen.add(name);
    counts.blob++;
    const bt = (obj.m_nBlobType as number) ?? -1;
    const sz = (obj.m_nSize as number) || 0;
    const btName = BLOB_TYPES.get(bt)?.name || `type_${bt}`;
    console.log(`  [BLOB] ${name.padEnd(50)} ${btName.padEnd(16)} size=${formatSize(sz)}`);
  }

  // GPU
  for (const alloc of parser.iterEntriesByType('BLP::GpuBufferEntry')) {
    const obj = parser.deserializeAlloc(alloc);
    const name = obj.m_Name as string;
    if (!name || seen.has(name)) continue;
    seen.add(name);
    counts.gpu++;
    const bpe = (obj.m_nBytesPerElement as number) || 0;
    const ec = (obj.m_nElementCount as number) || 0;
    console.log(`  [GPU]  ${name.padEnd(50)} elements=${ec} stride=${bpe} total=${formatSize(bpe * ec)}`);
  }

  // Sounds
  for (const alloc of parser.iterEntriesByType('BLP::SoundBankEntry')) {
    const obj = parser.deserializeAlloc(alloc);
    const name = obj.m_Name as string;
    if (!name || seen.has(name)) continue;
    seen.add(name);
    counts.sound++;
    const sz = (obj.m_nSize as number) || 0;
    console.log(`  [SND]  ${name.padEnd(50)} size=${formatSize(sz)}`);
  }

  console.log(`\nTotals: ${counts.texture} textures, ${counts.blob} blobs, ${counts.gpu} gpu, ${counts.sound} sounds`);
}

function cmdTypes(filepath: string): void {
  console.log(`\n=== Types: ${basename(filepath)} ===\n`);

  const parser = new BLPParser(filepath);
  parser.parse();

  const reg = parser.typeRegistry;
  if (!reg) {
    console.log('No type registry found.');
    return;
  }

  console.log(`Types (${reg.types.size}):`);
  for (const [name, t] of reg.types) {
    console.log(`  ${name} v${t.version} size=${t.size} underlying=${t.underlyingType || 'none'}`);
    for (const f of t.fields) {
      console.log(`    .${f.name.padEnd(30)} type=${f.typeName.padEnd(20)} off=${f.offset} size=${f.size} count=${f.count}`);
    }
  }

  if (reg.enums.size > 0) {
    console.log(`\nEnums (${reg.enums.size}):`);
    for (const [name, e] of reg.enums) {
      const vals = e.constants.map(c => `${c.name}=${c.value}`).join(', ');
      console.log(`  ${name}: ${vals}`);
    }
  }
}

function cmdAlloc(filepath: string, limit?: number): void {
  console.log(`\n=== Allocations: ${basename(filepath)} ===\n`);

  const parser = new BLPParser(filepath);
  parser.parse();

  const allocs = parser.allocations;
  const show = limit ? Math.min(limit, allocs.length) : allocs.length;

  console.log(`  ${'#'.padStart(4)}  ${'Stripe'.padEnd(6)}  ${'Offset'.padEnd(10)}  ${'Size'.padEnd(10)}  ${'Count'.padEnd(6)}  ${'UserData'.padEnd(10)}  TypeName`);
  console.log(`  ${'─'.repeat(4)}  ${'─'.repeat(6)}  ${'─'.repeat(10)}  ${'─'.repeat(10)}  ${'─'.repeat(6)}  ${'─'.repeat(10)}  ${'─'.repeat(30)}`);

  for (let i = 0; i < show; i++) {
    const a = allocs[i];
    const typeName = parser.resolveTypeName(a);
    console.log(
      `  ${String(a.index).padStart(4)}  ${String(a.stripe).padEnd(6)}  ` +
      `0x${a.offset.toString(16).padStart(6, '0').padEnd(8)}  ${String(a.allocSize).padEnd(10)}  ` +
      `${String(a.elementCount).padEnd(6)}  0x${a.userData.toString(16).padEnd(8)}  ${typeName}`
    );
  }

  if (show < allocs.length) {
    console.log(`  ... ${allocs.length - show} more`);
  }
}

function cmdPreview(filepath: string, assetName: string): void {
  console.log(`\n=== Preview test: ${assetName} ===\n`);

  const parser = new BLPParser(filepath);
  parser.parse();

  // Find the texture
  let found = false;
  for (const alloc of parser.iterEntriesByType('BLP::TextureEntry')) {
    const obj = parser.deserializeAlloc(alloc);
    if (obj.m_Name !== assetName) continue;
    found = true;

    const w = (obj.m_nWidth as number) || 0;
    const h = (obj.m_nHeight as number) || 0;
    const mips = (obj.m_nMips as number) || 1;
    const fmt = (obj.m_eFormat as number) || 0;
    const rawSize = calcTextureSize(w, h, mips, fmt);

    console.log(`  Found: ${assetName}`);
    console.log(`  Dimensions: ${w}x${h}`);
    console.log(`  Mips: ${mips}`);
    console.log(`  Format: ${dxgiName(fmt)} (${fmt})`);
    console.log(`  Expected raw size: ${formatSize(rawSize)}`);

    // Check SHARED_DATA
    console.log(`\n  Checking SHARED_DATA...`);
    const gameRoot = findGameRootFromPath(filepath);
    console.log(`  Game root from path: ${gameRoot || 'NOT FOUND'}`);

    let sdDirs: string[] = [];
    if (gameRoot) {
      sdDirs = findAllSharedData(gameRoot);
    }
    if (sdDirs.length === 0) {
      sdDirs = findSharedDataCandidates();
    }
    console.log(`  SHARED_DATA dirs: ${sdDirs.length}`);

    const sdIndex = buildSharedDataIndex(sdDirs);
    console.log(`  SHARED_DATA files: ${sdIndex.size}`);

    const civbigPath = sdIndex.get(assetName);
    if (civbigPath) {
      console.log(`  CIVBIG path: ${civbigPath}`);
      try {
        const info = readCivbigInfo(civbigPath);
        console.log(`  CIVBIG dataSize: ${formatSize(info.dataSize)}`);
        console.log(`  CIVBIG typeFlag: ${info.typeFlag}`);

        const { data } = readCivbig(civbigPath);
        console.log(`  CIVBIG payload: ${formatSize(data.length)}`);
        console.log(`  First bytes: ${data.subarray(0, 16).toString('hex')}`);
        console.log(`  Oodle compressed: ${data[0] === 0x8c ? 'YES' : 'NO'}`);
      } catch (e) {
        console.log(`  CIVBIG read error: ${e}`);
      }
    } else {
      console.log(`  CIVBIG: NOT FOUND in index`);
      // Try fuzzy match
      const lower = assetName.toLowerCase();
      let fuzzy = 0;
      for (const key of sdIndex.keys()) {
        if (key.toLowerCase().includes(lower.substring(0, 20))) {
          if (fuzzy < 5) console.log(`    Similar: ${key}`);
          fuzzy++;
        }
      }
      if (fuzzy > 5) console.log(`    ... ${fuzzy - 5} more similar`);
      if (fuzzy === 0) console.log(`    No similar names found`);
    }
    break;
  }

  if (!found) {
    // Check other types
    for (const typeName of ['BLP::BlobEntry', 'BLP::GpuBufferEntry', 'BLP::SoundBankEntry']) {
      for (const alloc of parser.iterEntriesByType(typeName)) {
        const obj = parser.deserializeAlloc(alloc);
        if (obj.m_Name !== assetName) continue;
        found = true;
        console.log(`  Found as ${typeName}`);
        console.log(`  Fields:`, JSON.stringify(obj, null, 2));
        break;
      }
      if (found) break;
    }
    if (!found) {
      console.log(`  Asset "${assetName}" not found in this BLP`);
    }
  }
}

function cmdSharedData(): void {
  console.log(`\n=== SHARED_DATA Scan ===\n`);

  const gameRoot = findGameRoot();
  console.log(`Game root: ${gameRoot || 'NOT FOUND'}`);

  if (!gameRoot) {
    console.log('Trying all Steam paths...');
  }

  const dirs = gameRoot ? findAllSharedData(gameRoot) : findSharedDataCandidates();
  console.log(`Found ${dirs.length} SHARED_DATA directories:\n`);

  for (const dir of dirs) {
    console.log(`  ${dir}`);
    try {
      const { readdirSync } = require('fs');
      const entries = readdirSync(dir);
      console.log(`    ${entries.length} files`);
    } catch (e) {
      console.log(`    Error reading: ${e}`);
    }
  }

  const index = buildSharedDataIndex(dirs);
  console.log(`\nTotal indexed files: ${index.size}`);

  // Show a sample of file names
  let shown = 0;
  for (const [name] of index) {
    if (shown >= 10) break;
    console.log(`  ${name}`);
    shown++;
  }
  if (index.size > 10) console.log(`  ... ${index.size - 10} more`);
}

function cmdOodle(): void {
  console.log(`\n=== Oodle DLL Scan ===\n`);

  const candidates = findOodleCandidates();
  if (candidates.length === 0) {
    console.log('No Oodle DLL candidates found.');
    return;
  }

  for (const path of candidates) {
    console.log(`  Found: ${path}`);
    try {
      const { OodleDecompressor } = require('../src/core/oodle');
      const o = new OodleDecompressor(path);
      console.log(`    Loaded successfully!`);

      // Test compress/decompress round-trip
      const testData = Buffer.alloc(4096);
      for (let i = 0; i < testData.length; i++) testData[i] = i & 0xff;
      const compressed = o.compress(testData);
      if (compressed) {
        console.log(`    Compress test: ${testData.length} -> ${compressed.length} bytes (${((1 - compressed.length / testData.length) * 100).toFixed(1)}% reduction)`);
        const decompressed = o.decompress(compressed, testData.length);
        if (decompressed && decompressed.equals(testData)) {
          console.log(`    Round-trip: OK (decompress matches original)`);
        } else {
          console.log(`    Round-trip: FAILED (decompress mismatch)`);
        }
      } else {
        console.log(`    Compress test: FAILED (returned null)`);
      }
    } catch (e) {
      console.log(`    Load failed: ${e}`);
    }
  }
}

function cmdCivbig(filepath: string): void {
  console.log(`\n=== CIVBIG: ${basename(filepath)} ===\n`);

  try {
    const info = readCivbigInfo(filepath);
    console.log(`  Data size:   ${formatSize(info.dataSize)}`);
    console.log(`  Data offset: 0x${info.dataOffset.toString(16)}`);
    console.log(`  Type flag:   ${info.typeFlag} (${['gpu', 'texture', 'blob', 'soundbank'][info.typeFlag] || 'unknown'})`);

    const { data } = readCivbig(filepath);
    console.log(`  Payload:     ${formatSize(data.length)}`);
    console.log(`  Oodle:       ${data[0] === 0x8c ? 'YES (Kraken)' : 'NO'}`);
    console.log(`\n  Header hex:`);
    hexdump(data, 8);
  } catch (e) {
    console.log(`  Error: ${e}`);
  }
}

function cmdHexdump(filepath: string, allocIndex: number): void {
  const parser = new BLPParser(filepath);
  parser.parse();

  const alloc = parser.allocations[allocIndex];
  if (!alloc) {
    die(`Allocation ${allocIndex} not found (max: ${parser.allocations.length - 1})`);
  }

  const typeName = parser.resolveTypeName(alloc);
  console.log(`\n=== Allocation ${allocIndex}: ${typeName} ===`);
  console.log(`  Stripe: ${alloc.stripe}, Offset: 0x${alloc.offset.toString(16)}, Size: ${alloc.allocSize}, Count: ${alloc.elementCount}\n`);

  // Read the raw data for this allocation
  const pkgStart = parser.header.packageDataOffset;
  const ph = parser.pkgHeader;
  const stripeOffsets = [
    ph.resourceLinkerData.offset,
    ph.packageBlock.offset,
    ph.tempData.offset,
    ph.typeInfo.offset,
    ph.rootTypeName.offset,
  ];

  const stripeBase = alloc.stripe < stripeOffsets.length
    ? pkgStart + stripeOffsets[alloc.stripe]
    : pkgStart;

  const absOffset = stripeBase + alloc.offset;
  const data = readFileSync(filepath);
  const end = Math.min(absOffset + alloc.allocSize, data.length);
  const slice = data.subarray(absOffset, end);

  hexdump(slice, 64);

  // Try deserializing
  try {
    const obj = parser.deserializeAlloc(alloc);
    console.log(`\n  Deserialized fields:`);
    for (const [key, value] of Object.entries(obj)) {
      const v = typeof value === 'string' ? `"${value}"` :
                typeof value === 'object' ? JSON.stringify(value) :
                String(value);
      console.log(`    ${key}: ${v}`);
    }
  } catch (e) {
    console.log(`\n  Deserialization failed: ${e}`);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const [, , command, ...args] = process.argv;

if (!command) {
  console.log(`
BLP Studio CLI — debug tool for BLP parsing

Usage: npx tsx scripts/cli.ts <command> [args...]

Commands:
  info <file.blp>             BLP header, preamble, stripes, alloc count
  assets <file.blp>           List all assets with metadata
  types <file.blp>            Dump type registry (all types and fields)
  alloc <file.blp> [limit]    Allocation table dump
  preview <file.blp> <name>   Test texture preview pipeline
  shared-data                 Scan SHARED_DATA directories
  oodle                       Test Oodle DLL loading
  civbig <file>               Read CIVBIG file header
  hexdump <file.blp> <alloc#> Hex dump a specific allocation
`);
  process.exit(0);
}

try {
  switch (command) {
    case 'info':
      if (!args[0]) die('Usage: info <file.blp>');
      cmdInfo(resolve(args[0]));
      break;

    case 'assets':
      if (!args[0]) die('Usage: assets <file.blp>');
      cmdAssets(resolve(args[0]));
      break;

    case 'types':
      if (!args[0]) die('Usage: types <file.blp>');
      cmdTypes(resolve(args[0]));
      break;

    case 'alloc':
      if (!args[0]) die('Usage: alloc <file.blp> [limit]');
      cmdAlloc(resolve(args[0]), args[1] ? parseInt(args[1]) : undefined);
      break;

    case 'preview':
      if (!args[0] || !args[1]) die('Usage: preview <file.blp> <asset-name>');
      cmdPreview(resolve(args[0]), args[1]);
      break;

    case 'shared-data':
      cmdSharedData();
      break;

    case 'oodle':
      cmdOodle();
      break;

    case 'civbig':
      if (!args[0]) die('Usage: civbig <file>');
      cmdCivbig(resolve(args[0]));
      break;

    case 'hexdump':
      if (!args[0] || !args[1]) die('Usage: hexdump <file.blp> <alloc-index>');
      cmdHexdump(resolve(args[0]), parseInt(args[1]));
      break;

    default:
      die(`Unknown command: ${command}`);
  }
} catch (e) {
  console.error(`\nFATAL: ${e}`);
  if (e instanceof Error && e.stack) {
    console.error(e.stack);
  }
  process.exit(1);
}
