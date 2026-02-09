/**
 * Civilization VII BLP Format Parser
 *
 * Reverse-engineered specification for the CIVBLP binary package format.
 * All integers are little-endian. Uses Node.js Buffer for binary reads.
 *
 * Based on the Civ6 BLP wiki spec and extended with Civ7-specific changes.
 */

import { readFileSync } from 'fs';
import { basename } from 'path';
import type {
  BLPField,
  BLPEnumConstant,
  BLPEnum,
  BLPType,
} from './type-registry';
import { TypeRegistry } from './type-registry';

// Re-export type-registry items so consumers can import from a single module
export type {
  BLPField,
  BLPEnumConstant,
  BLPEnum,
  BLPType,
} from './type-registry';
export { TypeRegistry } from './type-registry';

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface BLPHeader {
  magic: string;
  version: number;
  packageDataOffset: number;
  packageDataSize: number;
  bigDataOffset: number;
  bigDataCount: number;
  fileSize: number;
}

export interface PackagePreamble {
  packageVersion: number;
  sizeofVoidPointer: number;
  alignof64Bit: number;
  sizeofPackageHeader: number;
  endianField: number;
}

export interface StripeInfo {
  offset: number;
  size: number;
}

export interface PackageHeader {
  resourceLinkerData: StripeInfo;
  packageBlock: StripeInfo;
  tempData: StripeInfo;
  typeInfo: StripeInfo;
  rootTypeName: StripeInfo;
  linkerDataOffset: number;
  extraFields: number[];
}

export interface PackageAllocation {
  index: number;
  stripe: number;
  offset: number;
  allocSize: number;
  elementCount: number;
  userData: number;
  typeNamePtr: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PREAMBLE_SIZE = 16;
const ALLOC_ENTRY_SIZE = 40;

type FundamentalReader = (buf: Buffer, offset: number) => number | boolean | Buffer;

interface FundamentalDef {
  size: number;
  reader: FundamentalReader;
}

const FUNDAMENTAL_READERS: Record<string, FundamentalDef> = {
  uint8:  { size: 1, reader: (b, o) => b.readUInt8(o) },
  uint16: { size: 2, reader: (b, o) => b.readUInt16LE(o) },
  uint32: { size: 4, reader: (b, o) => b.readUInt32LE(o) },
  uint64: { size: 8, reader: (b, o) => Number(b.readBigUInt64LE(o)) },
  int32:  { size: 4, reader: (b, o) => b.readInt32LE(o) },
  float:  { size: 4, reader: (b, o) => b.readFloatLE(o) },
  bool:   { size: 1, reader: (b, o) => b[o] !== 0 },
  char:   { size: 1, reader: (b, o) => b.subarray(o, o + 1) },
};

// ---------------------------------------------------------------------------
// Static parse helpers
// ---------------------------------------------------------------------------

function parseBLPHeader(buf: Buffer): BLPHeader {
  const magic = buf.toString('ascii', 0, 6);
  const version = buf.readUInt16LE(6);
  const packageDataOffset = buf.readUInt32LE(8);
  const packageDataSize = buf.readUInt32LE(12);
  const bigDataOffset = buf.readUInt32LE(16);
  const bigDataCount = buf.readUInt32LE(20);
  const fileSize = buf.readUInt32LE(24);
  return { magic, version, packageDataOffset, packageDataSize, bigDataOffset, bigDataCount, fileSize };
}

function parsePreamble(buf: Buffer, offset: number): PackagePreamble {
  const packageVersion = buf.readUInt32LE(offset);
  const sizeofVoidPointer = buf.readUInt16LE(offset + 4);
  const alignof64Bit = buf.readUInt16LE(offset + 6);
  const sizeofPackageHeader = buf.readUInt32LE(offset + 8);
  const endianField = buf.readUInt32LE(offset + 12);
  return { packageVersion, sizeofVoidPointer, alignof64Bit, sizeofPackageHeader, endianField };
}

function parseStripeInfo(buf: Buffer, offset: number): StripeInfo {
  return {
    offset: buf.readUInt32LE(offset),
    size: buf.readUInt32LE(offset + 4),
  };
}

function parsePackageHeader(buf: Buffer, offset: number): PackageHeader {
  const stripes: StripeInfo[] = [];
  for (let i = 0; i < 5; i++) {
    stripes.push(parseStripeInfo(buf, offset + i * 8));
  }
  const trailingOffset = offset + 40;
  const trailing: number[] = [];
  for (let i = 0; i < 8; i++) {
    trailing.push(buf.readUInt32LE(trailingOffset + i * 4));
  }
  return {
    resourceLinkerData: stripes[0],
    packageBlock: stripes[1],
    tempData: stripes[2],
    typeInfo: stripes[3],
    rootTypeName: stripes[4],
    linkerDataOffset: trailing[0],
    extraFields: trailing.slice(1),
  };
}

function parseAllocation(buf: Buffer, offset: number, index: number): PackageAllocation {
  const stripe = Number(buf.readBigUInt64LE(offset));
  const allocOffset = buf.readUInt32LE(offset + 8);
  const allocSize = buf.readUInt32LE(offset + 12);
  const elementCount = buf.readUInt32LE(offset + 16);
  const userData = Number(buf.readBigUInt64LE(offset + 24));
  const typeNamePtr = Number(buf.readBigUInt64LE(offset + 32));
  return { index, stripe, offset: allocOffset, allocSize, elementCount, userData, typeNamePtr };
}

// ---------------------------------------------------------------------------
// BLPParser
// ---------------------------------------------------------------------------

export class BLPParser {
  public readonly filepath: string;
  public readonly filename: string;

  private readonly data: Buffer;

  private _header: BLPHeader | null = null;
  private _preamble: PackagePreamble | null = null;
  private _pkgHeader: PackageHeader | null = null;
  private _allocations: PackageAllocation[] = [];
  private _typeRegistry: TypeRegistry | null = null;
  private _allocTypeCache: Map<number, string> = new Map();

  constructor(filepath: string) {
    this.filepath = filepath;
    this.filename = basename(filepath);
    this.data = readFileSync(filepath);
  }

  // -- Public accessors -----------------------------------------------------

  get header(): BLPHeader {
    if (!this._header) throw new Error('BLP file not parsed yet. Call parse() first.');
    return this._header;
  }

  get preamble(): PackagePreamble {
    if (!this._preamble) throw new Error('BLP file not parsed yet. Call parse() first.');
    return this._preamble;
  }

  get pkgHeader(): PackageHeader {
    if (!this._pkgHeader) throw new Error('BLP file not parsed yet. Call parse() first.');
    return this._pkgHeader;
  }

  get allocations(): PackageAllocation[] {
    return this._allocations;
  }

  get typeRegistry(): TypeRegistry | null {
    return this._typeRegistry;
  }

  // -- Parse pipeline -------------------------------------------------------

  parse(): void {
    this._parseHeader();
    this._parsePreamble();
    this._parsePackageHeader();
    this._parseAllocations();
    this._parseTypeRegistry();
  }

  private _parseHeader(): void {
    this._header = parseBLPHeader(this.data);
    if (this._header.magic !== 'CIVBLP') {
      throw new Error(`Bad magic: ${this._header.magic}`);
    }
  }

  private _parsePreamble(): void {
    this._preamble = parsePreamble(this.data, this.header.packageDataOffset);
  }

  private _parsePackageHeader(): void {
    const hdrOffset = this.header.packageDataOffset + PREAMBLE_SIZE;
    this._pkgHeader = parsePackageHeader(this.data, hdrOffset);
  }

  private _parseAllocations(): void {
    const tempAbs = this.header.packageDataOffset + this.pkgHeader.tempData.offset;
    const allocAbs = tempAbs + this.pkgHeader.linkerDataOffset;
    const remaining = this.pkgHeader.tempData.size - this.pkgHeader.linkerDataOffset;
    const numAllocs = Math.floor(remaining / ALLOC_ENTRY_SIZE);

    this._allocations = [];
    for (let i = 0; i < numAllocs; i++) {
      const off = allocAbs + i * ALLOC_ENTRY_SIZE;
      if (off + ALLOC_ENTRY_SIZE > this.data.length) break;
      this._allocations.push(parseAllocation(this.data, off, i));
    }
  }

  private _parseTypeRegistry(): void {
    const tiAbs = this.pkgStart + this.pkgHeader.typeInfo.offset;
    const tiSize = this.pkgHeader.typeInfo.size;
    const ti = this.data.subarray(tiAbs, tiAbs + tiSize);

    // Nested preamble + header (same layout as outer)
    const nhOff = 16;
    const nStripes: StripeInfo[] = [];
    for (let i = 0; i < 5; i++) {
      nStripes.push(parseStripeInfo(ti, nhOff + i * 8));
    }
    const nLinker = ti.readUInt32LE(nhOff + 40);

    // Nested stripe offsets within ti buffer
    const nPbOff = nStripes[1].offset; // PackageBlock
    const nTdOff = nStripes[2].offset; // TempData

    // Parse nested allocations
    const nAllocStart = nTdOff + nLinker;
    const nAllocBytes = nStripes[2].size - nLinker;
    const nNumAllocs = Math.floor(nAllocBytes / ALLOC_ENTRY_SIZE);

    interface NAlloc {
      stripe: number;
      offset: number;
      size: number;
      count: number;
      typePtr: number;
    }

    const nAllocs: NAlloc[] = [];
    for (let i = 0; i < nNumAllocs; i++) {
      const off = nAllocStart + i * ALLOC_ENTRY_SIZE;
      if (off + ALLOC_ENTRY_SIZE > ti.length) break;
      nAllocs.push({
        stripe: Number(ti.readBigUInt64LE(off)),
        offset: ti.readUInt32LE(off + 8),
        size: ti.readUInt32LE(off + 12),
        count: ti.readUInt32LE(off + 16),
        typePtr: Number(ti.readBigUInt64LE(off + 32)),
      });
    }

    // Helper: read data for a nested allocation
    function nRead(a: NAlloc): Buffer {
      const base = a.stripe === 0 ? nPbOff : nTdOff;
      return ti.subarray(base + a.offset, base + a.offset + a.size);
    }

    // Helper: resolve a pointer to a string in the nested package
    function nStr(ptr: number): string {
      if (ptr === 0 || ptr - 1 >= nAllocs.length) return '';
      const raw = nRead(nAllocs[ptr - 1]);
      return raw.toString('ascii').replace(/\0/g, '');
    }

    // Helper: get type name for a nested allocation
    function nTypeName(a: NAlloc): string {
      return nStr(a.typePtr);
    }

    const registry = new TypeRegistry();

    for (const a of nAllocs) {
      const tn = nTypeName(a);

      if (tn === 'TypeInfoStripe::TypeVersion') {
        const tvData = nRead(a);
        const entrySize = Math.floor(a.size / Math.max(a.count, 1));

        for (let i = 0; i < a.count; i++) {
          const eoff = i * entrySize;
          const e = tvData.subarray(eoff, eoff + entrySize);

          const namePtr = Number(e.readBigUInt64LE(0));
          const underlyingPtr = Number(e.readBigUInt64LE(8));
          const fieldsPtr = Number(e.readBigUInt64LE(16));
          const version = e.readUInt32LE(32);
          const size = e.readUInt32LE(36);
          const traitFlags = e.readUInt32LE(40);

          const fields: BLPField[] = [];
          if (fieldsPtr > 0 && fieldsPtr - 1 < nAllocs.length) {
            const fa = nAllocs[fieldsPtr - 1];
            const faData = nRead(fa);
            const faEs = Math.floor(fa.size / Math.max(fa.count, 1));
            for (let fi = 0; fi < fa.count; fi++) {
              const fe = faData.subarray(fi * faEs, (fi + 1) * faEs);
              fields.push({
                name: nStr(Number(fe.readBigUInt64LE(0))),
                typeName: nStr(Number(fe.readBigUInt64LE(8))),
                version: fe.readUInt32LE(16),
                address: fe.readUInt32LE(20),
              });
            }
          }

          registry.addType({
            name: nStr(namePtr),
            underlyingName: nStr(underlyingPtr),
            fields,
            version,
            size,
            traitFlags,
            isFundamental: (traitFlags & 0x04) !== 0,
            isPointer: (traitFlags & 0x02) !== 0,
            isArray: (traitFlags & 0x01) !== 0,
            isPolymorphic: (traitFlags & 0x10) !== 0,
          });
        }
      } else if (tn === 'TypeInfoStripe::EnumVersion') {
        const evData = nRead(a);
        const entrySize = Math.floor(a.size / Math.max(a.count, 1));

        for (let i = 0; i < a.count; i++) {
          const eoff = i * entrySize;
          const e = evData.subarray(eoff, eoff + entrySize);
          const namePtr = Number(e.readBigUInt64LE(0));
          const constsPtr = Number(e.readBigUInt64LE(8));
          const eVer = e.readUInt32LE(16);

          const constants: BLPEnumConstant[] = [];
          if (constsPtr > 0 && constsPtr - 1 < nAllocs.length) {
            const ca = nAllocs[constsPtr - 1];
            const caData = nRead(ca);
            const caEs = Math.floor(ca.size / Math.max(ca.count, 1));
            for (let ci = 0; ci < ca.count; ci++) {
              const ce = caData.subarray(ci * caEs, (ci + 1) * caEs);
              constants.push({
                name: nStr(Number(ce.readBigUInt64LE(0))),
                value: ce.readInt32LE(8),
              });
            }
          }

          registry.addEnum({
            name: nStr(namePtr),
            constants,
            version: eVer,
          });
        }
      }
    }

    this._typeRegistry = registry;
  }

  // -- Computed properties --------------------------------------------------

  get pkgStart(): number {
    return this.header.packageDataOffset;
  }

  get pkgblockAbs(): number {
    return this.pkgStart + this.pkgHeader.packageBlock.offset;
  }

  get tempdataAbs(): number {
    return this.pkgStart + this.pkgHeader.tempData.offset;
  }

  // -- Data access helpers --------------------------------------------------

  stripeAbs(stripeId: number): number {
    if (stripeId === 0) return this.pkgblockAbs;
    if (stripeId === 1) return this.tempdataAbs;
    return this.pkgblockAbs;
  }

  allocDataAbs(alloc: PackageAllocation): number {
    return this.stripeAbs(alloc.stripe) + alloc.offset;
  }

  readAllocData(alloc: PackageAllocation): Buffer {
    const absOff = this.allocDataAbs(alloc);
    return this.data.subarray(absOff, absOff + alloc.allocSize);
  }

  resolvePtr(ptr: number): PackageAllocation | null {
    if (ptr === 0) return null;
    const idx = ptr - 1;
    if (idx >= 0 && idx < this._allocations.length) {
      return this._allocations[idx];
    }
    return null;
  }

  resolveTypeName(alloc: PackageAllocation): string {
    const cached = this._allocTypeCache.get(alloc.index);
    if (cached !== undefined) return cached;

    if (alloc.typeNamePtr === 0) return '<null>';

    const typeAlloc = this.resolvePtr(alloc.typeNamePtr);
    if (!typeAlloc) return `<ptr${alloc.typeNamePtr}>`;

    const raw = this.readAllocData(typeAlloc);
    let name: string;
    try {
      name = raw.toString('ascii').replace(/\0/g, '');
    } catch {
      name = `<binary@${typeAlloc.offset}>`;
    }

    this._allocTypeCache.set(alloc.index, name);
    return name;
  }

  readStringAlloc(alloc: PackageAllocation): string {
    const raw = this.readAllocData(alloc);

    // Detect the u32+u32 string header pattern (String::BasicT)
    if (raw.length >= 12) {
      const len1 = raw.readUInt32LE(0);
      const len2 = raw.readUInt32LE(4);
      if (len1 > 0 && len2 === len1 - 1 && 8 + len1 <= raw.length + 1) {
        return raw.toString('ascii', 8, 8 + len2);
      }
    }

    // Fallback: strip trailing nulls
    let end = raw.length;
    while (end > 0 && raw[end - 1] === 0) end--;
    return raw.toString('ascii', 0, end);
  }

  getRootTypeName(): string {
    const si = this.pkgHeader.rootTypeName;
    const absOff = this.pkgStart + si.offset;
    const raw = this.data.subarray(absOff, absOff + si.size);
    let end = raw.length;
    while (end > 0 && raw[end - 1] === 0) end--;
    return raw.toString('ascii', 0, end);
  }

  // -- Object deserialization -----------------------------------------------

  deserializeAlloc(alloc: PackageAllocation): Record<string, unknown> {
    const typeName = this.resolveTypeName(alloc);
    const blpType = this._typeRegistry?.get(typeName);

    if (!blpType || blpType.fields.length === 0) {
      return { _type: typeName, _raw: this.readAllocData(alloc).toString('hex') };
    }

    const raw = this.readAllocData(alloc);
    const result: Record<string, unknown> = { _type: typeName };

    const sortedFields = [...blpType.fields].sort((a, b) => a.address - b.address);
    for (const f of sortedFields) {
      result[f.name] = this._readField(raw, f, alloc);
    }

    return result;
  }

  private _readField(
    raw: Buffer,
    f: BLPField,
    parentAlloc: PackageAllocation | null,
  ): unknown {
    const off = f.address;
    const ft = f.typeName;

    if (off >= raw.length) return null;

    // Fundamental types
    const fundamental = FUNDAMENTAL_READERS[ft];
    if (fundamental) {
      const { size: fsize, reader } = fundamental;
      if (off + fsize <= raw.length) {
        try {
          return reader(raw, off);
        } catch {
          return null;
        }
      }
    }

    // Pointer types (ptr64<T>, PackagePtr64<T>)
    if (ft.startsWith('ptr64<') || ft.startsWith('PackagePtr64<')) {
      if (off + 8 <= raw.length) {
        const ptr = Number(raw.readBigUInt64LE(off));
        return ptr ? `ptr(${ptr})` : null;
      }
    }

    // String type
    if (ft.startsWith('String::BasicT<')) {
      if (off + 8 <= raw.length) {
        const ptr = Number(raw.readBigUInt64LE(off));
        if (ptr) {
          const strAlloc = this.resolvePtr(ptr);
          if (strAlloc) return this.readStringAlloc(strAlloc);
        }
        return '';
      }
    }

    // BLPPtr<T>
    if (ft.startsWith('BLP::BLPPtr<')) {
      if (off + 8 <= raw.length) {
        const ptr = Number(raw.readBigUInt64LE(off));
        if (ptr) {
          const targetAlloc = this.resolvePtr(ptr);
          if (targetAlloc) return this.deserializeAlloc(targetAlloc);
        }
        return null;
      }
    }

    // RuntimePtrVoid
    if (ft === 'BLP::RuntimePtrVoid') {
      if (off + 8 <= raw.length) {
        const ptr = Number(raw.readBigUInt64LE(off));
        return ptr ? `runtimeptr(${ptr})` : null;
      }
    }

    // BLPVector<T>
    if (ft.startsWith('BLP::BLPVector<')) {
      if (off + 16 <= raw.length) {
        const ptr = Number(raw.readBigUInt64LE(off));
        const nElements = raw.readUInt32LE(off + 8);
        if (ptr && nElements > 0) {
          const arrAlloc = this.resolvePtr(ptr);
          if (arrAlloc) return this._deserializeArray(arrAlloc, nElements);
        }
        return [];
      }
    }

    // Types::Vector<T>
    if (ft.startsWith('Types::Vector<')) {
      if (off + 16 <= raw.length) {
        const ptr = Number(raw.readBigUInt64LE(off));
        const nElements = raw.readUInt32LE(off + 8);
        if (ptr && nElements > 0) {
          const arrAlloc = this.resolvePtr(ptr);
          if (arrAlloc) return this._deserializeArray(arrAlloc, nElements);
        }
        return [];
      }
    }

    // ExtensibleCollection
    if (ft === 'BLP::ExtensibleCollection') {
      if (off + 16 <= raw.length) {
        const ptr = Number(raw.readBigUInt64LE(off));
        const nElements = raw.readUInt32LE(off + 8);
        if (ptr && nElements > 0) {
          const arrAlloc = this.resolvePtr(ptr);
          if (arrAlloc) return this._deserializeArray(arrAlloc, nElements);
        }
        return [];
      }
    }

    // Ptr64Support::Storage<T>
    if (ft.startsWith('Ptr64Support::Storage<')) {
      if (off + 8 <= raw.length) {
        const ptr = Number(raw.readBigUInt64LE(off));
        return ptr ? `ptr(${ptr})` : null;
      }
    }

    // Array types like uint8[4]
    if (ft === 'uint8[4]') {
      if (off + 4 <= raw.length) {
        return Array.from(raw.subarray(off, off + 4));
      }
    }

    // Struct types with known fields
    const blpType = this._typeRegistry?.get(ft);
    if (blpType && blpType.fields.length > 0) {
      const sub: Record<string, unknown> = {};
      const sortedFields = [...blpType.fields].sort((a, b) => a.address - b.address);
      for (const sf of sortedFields) {
        if (off + sf.address < raw.length) {
          sub[sf.name] = this._readField(
            raw,
            { name: sf.name, typeName: sf.typeName, version: sf.version, address: off + sf.address },
            parentAlloc,
          );
        }
      }
      return sub;
    }

    // Fallback: raw hex bytes
    const end = Math.min(off + 16, raw.length);
    return raw.subarray(off, end).toString('hex');
  }

  private _deserializeArray(alloc: PackageAllocation, count: number): unknown[] {
    const typeName = this.resolveTypeName(alloc);
    const raw = this.readAllocData(alloc);

    if (count === 0) return [];

    const elemSize = Math.floor(alloc.allocSize / Math.max(alloc.elementCount, 1));
    const effectiveCount = Math.min(count, alloc.elementCount);

    // If element type is BLPPtr<T>, each element is a ptr64
    if (typeName.startsWith('BLP::BLPPtr<')) {
      const results: unknown[] = [];
      for (let i = 0; i < effectiveCount; i++) {
        const ptr = Number(raw.readBigUInt64LE(i * 8));
        if (ptr) {
          const target = this.resolvePtr(ptr);
          if (target) {
            results.push(this.deserializeAlloc(target));
          } else {
            results.push(`ptr(${ptr})`);
          }
        } else {
          results.push(null);
        }
      }
      return results;
    }

    // Known types - deserialize each element
    const blpType = this._typeRegistry?.get(typeName);
    if (blpType && blpType.fields.length > 0) {
      const results: Record<string, unknown>[] = [];
      const sortedFields = [...blpType.fields].sort((a, b) => a.address - b.address);
      for (let i = 0; i < effectiveCount; i++) {
        const elemRaw = raw.subarray(i * elemSize, (i + 1) * elemSize);
        const elem: Record<string, unknown> = { _type: typeName };
        for (const f of sortedFields) {
          elem[f.name] = this._readField(elemRaw, f, alloc);
        }
        results.push(elem);
      }
      return results;
    }

    // Fundamental type arrays
    const fundamental = FUNDAMENTAL_READERS[typeName];
    if (fundamental) {
      const { reader } = fundamental;
      const results: unknown[] = [];
      for (let i = 0; i < effectiveCount; i++) {
        try {
          results.push(reader(raw, i * elemSize));
        } catch {
          break;
        }
      }
      return results;
    }

    // Fallback: hex strings per element
    const results: string[] = [];
    for (let i = 0; i < effectiveCount; i++) {
      results.push(raw.subarray(i * elemSize, (i + 1) * elemSize).toString('hex'));
    }
    return results;
  }

  // -- Enumeration methods --------------------------------------------------

  *iterEntriesByType(typeName: string): Generator<PackageAllocation> {
    for (const alloc of this._allocations) {
      if (this.resolveTypeName(alloc) === typeName) {
        yield alloc;
      }
    }
  }

  getEntryMap(): Array<{ hash: number; entryPtr: number }> {
    const results: Array<{ hash: number; entryPtr: number }> = [];
    for (const alloc of this.iterEntriesByType('BLP::Package::EntryMap')) {
      const raw = this.readAllocData(alloc);
      for (let i = 0; i < alloc.elementCount; i++) {
        const eoff = i * 16;
        if (eoff + 16 > raw.length) break;
        const hash = raw.readUInt32LE(eoff);
        const entryPtr = Number(raw.readBigUInt64LE(eoff + 8));
        results.push({ hash, entryPtr });
      }
    }
    return results;
  }

  getPackageObject(): Record<string, unknown> {
    const blpPkg = this._typeRegistry?.get('BLP::Package');
    if (!blpPkg) return {};

    // Find the allocation for BLP::Package
    for (const alloc of this._allocations) {
      if (this.resolveTypeName(alloc) === 'BLP::Package') {
        return this.deserializeAlloc(alloc);
      }
    }

    // Fallback: read from TempData start
    const tdAbs = this.tempdataAbs;
    const raw = this.data.subarray(tdAbs, tdAbs + blpPkg.size);
    const result: Record<string, unknown> = { _type: 'BLP::Package' };
    const sortedFields = [...blpPkg.fields].sort((a, b) => a.address - b.address);
    for (const f of sortedFields) {
      result[f.name] = this._readField(raw, f, null);
    }
    return result;
  }
}
