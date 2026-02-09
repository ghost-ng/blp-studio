# BLP Format Specification

## Overview

BLP (Binary Library Package) is Civilization VII's primary asset packaging format. It serves as a manifest system that describes game assets and their locations, rather than containing the asset data directly.

### Key Characteristics

- **Manifest-based architecture**: BLP files describe assets but don't contain the bulk data
- **External storage**: Actual asset data lives in CIVBIG container files stored in flat SHARED_DATA directories
- **Self-describing format**: Embedded type system (reflection data) eliminates the need for hardcoded struct layouts
- **Version**: Current format version is 1 (file header) with package preamble version 5
- **Endianness**: All multi-byte fields are little-endian

### Purpose

BLP files act as indices that map asset names to their physical locations in CIVBIG containers. This architecture enables:
- Efficient asset streaming and loading
- Shared asset storage across multiple packages
- Dynamic asset resolution at runtime
- Memory-efficient asset management

## File Structure

A BLP file consists of three major sections:

1. **File Header** (1024 bytes) - Format identification and top-level offsets
2. **Package Data** (variable size) - Type system, object data, and allocation tables
3. **BigData** (optional) - Embedded asset payloads for some BLP types

## File Header

The file header occupies the first 1024 bytes (0x400) of every BLP file.

### Header Layout

```
Offset  Size  Type   Field                Description
------  ----  ----   -----                -----------
0x00    6     char   magic                "CIVBLP" (ASCII, not null-terminated)
0x06    2     -      padding              Reserved/padding bytes
0x08    4     u32    packageDataOffset    Offset to package data (always 0x400)
0x0C    4     u32    packageDataSize      Size of package data section in bytes
0x10    4     u32    bigDataOffset        Offset to embedded BigData section (0 if none)
0x14    4     u32    bigDataCount         Number of BigData entries
0x18    4     u32    fileSize             Total file size in bytes
0x1C    996   -      padding              Zero-padding to reach 1024 bytes
```

### Field Descriptions

- **magic**: File format identifier. Must be exactly "CIVBLP" (6 bytes, ASCII)
- **packageDataOffset**: Always 0x400 (1024 decimal), indicating package data starts after header
- **packageDataSize**: Length of the package data section, used for validation and parsing
- **bigDataOffset**: File offset to embedded BigData section. Zero if no embedded data present
- **bigDataCount**: Number of embedded asset entries. Zero for files that reference external CIVBIG files only
- **fileSize**: Total file size, used for integrity checks

## Package Data Layout

Package data begins at offset 0x400 and contains the core BLP structure: type definitions, serialized objects, and linking metadata.

### Preamble (16 bytes)

The package data section starts with a 16-byte preamble:

```
Offset  Size  Type   Field         Description
------  ----  ----   -----         -----------
0x00    4     u32    version       Package format version (observed: 5)
0x04    4     u32    ptr_size      Pointer size in bytes (always 8 for 64-bit)
0x08    4     u32    alignment     Memory alignment requirement (8 bytes)
0x0C    4     u32    header_size   Size of package header (72 bytes)
```

### Package Header (72 bytes)

Following the preamble, the package header defines five "stripes" (data segments):

```
Stripe Index  Name              Purpose
------------  ----              -------
0             RootTypeName      Root type name string (e.g., "BLP::Package")
1             TypeInfoStripe    Type system reflection data
2             PackageBlock      Serialized object data
3             TempData          Allocation table and linker metadata
4             ResourceLinker    Resource linking data (empty in observed files)
```

Each stripe is described by an 8-byte entry:

```
Offset  Size  Type   Field   Description
------  ----  ----   -----   -----------
0x00    4     u32    offset  Byte offset from start of package data
0x04    4     u32    size    Size of stripe in bytes
```

The 72-byte header layout:

```
Offset  Stripe
------  ------
0x00    RootTypeName (offset + size)
0x08    TypeInfoStripe (offset + size)
0x10    PackageBlock (offset + size)
0x18    TempData (offset + size)
0x20    ResourceLinker (offset + size)
0x28    Reserved/padding (32 bytes)
```

### Stripe Details

#### Stripe 0: RootTypeName

Contains a single null-terminated ASCII string identifying the root type, typically "BLP::Package".

#### Stripe 1: TypeInfoStripe

Binary-encoded type system definitions (reflection data). Contains serialized type descriptors that define:
- Struct layouts (TypeVersion)
- Enumerations (EnumVersion)
- Field definitions (FieldVersion)

This self-describing system allows parsers to interpret PackageBlock data without hardcoded struct definitions.

#### Stripe 2: PackageBlock

Serialized binary object data. Contains the actual package contents: asset entries, metadata, and nested objects. Structure is interpreted using the type definitions from TypeInfoStripe.

#### Stripe 3: TempData

Contains the allocation table and linker metadata. The allocation table begins at offset `TempData.offset + linkerDataOffset` where `linkerDataOffset` is read from the TempData stripe's header.

#### Stripe 4: ResourceLinker

Reserved for resource linking data. Empty (size = 0) in all observed Civilization VII BLP files.

## Allocation Table

The allocation table is the core linking mechanism that enables pointer resolution and cross-references between objects.

### Location

Located within the TempData stripe at offset `TempData.offset + linkerDataOffset`.

The number of entries can be calculated from the TempData stripe metadata.

### Entry Structure

Each allocation entry is exactly 40 bytes:

```
Offset  Size  Type   Field          Description
------  ----  ----   -----          -----------
0x00    8     u64    stripeIndex    Target stripe (low byte = stripe number)
0x08    4     u32    byteOffset     Offset within target stripe
0x0C    4     u32    size           Size of allocation in bytes
0x10    4     u32    count          Number of array elements (1 for single objects)
0x14    4     u32    padding        Reserved/padding
0x18    8     u64    userData       Additional metadata
0x20    8     u64    typeNamePtr    Pointer to type name (1-based alloc index)
```

### Field Descriptions

- **stripeIndex**: 64-bit value where the low byte indicates which stripe this allocation points to (0-4)
- **byteOffset**: Offset from the beginning of the target stripe to the data
- **size**: Total size of the allocation in bytes
- **count**: Number of elements if this is an array allocation (1 for single objects)
- **userData**: Application-specific metadata
- **typeNamePtr**: 1-based index into the allocation table pointing to the type name string

### Pointer Resolution

The allocation table enables a 1-based pointer indexing system:

- A 64-bit pointer field with value `N` (where N > 0) refers to allocation entry `N-1`
- Value 0 represents a null pointer
- Example: Pointer value `5` means "allocation entry at index 4"

This indirection allows efficient serialization of complex object graphs without absolute memory addresses.

## Type System (TypeInfoStripe)

The TypeInfoStripe contains binary-encoded reflection data that describes all types used in the package. This self-describing system has three primary definition kinds:

### TypeVersion

Defines a struct/class type with its fields:

- Type name (string)
- Field count
- Total size in bytes
- List of FieldVersion definitions

### EnumVersion

Defines an enumeration type:

- Enum name (string)
- Underlying integer type
- List of named values (name + integer value pairs)

### FieldVersion

Describes a single field within a struct:

- Field name (string)
- Type name (string)
- Byte offset within the struct
- Size in bytes
- Flags (array, pointer, etc.)

### Type Name Examples

Common types found in BLP files:

- `BLP::Package` - Root package object
- `BLP::TextureEntry` - GPU texture descriptor
- `BLP::BlobEntry` - Binary blob descriptor
- `BLP::GpuBufferEntry` - Vertex/index buffer descriptor
- `BLP::SoundBankEntry` - Wwise sound bank descriptor

## Entry Types

BLP files contain various entry types that describe different asset categories. Each type has specific fields that describe the asset and its location.

### BLP::TextureEntry

Describes GPU texture assets.

#### Key Fields

| Field | Type | Description |
|-------|------|-------------|
| m_Name | string | Asset name/identifier |
| m_nWidth | u32 | Texture width in pixels |
| m_nHeight | u32 | Texture height in pixels |
| m_nMips | u32 | Number of mipmap levels |
| m_eFormat | enum | Pixel format (BC1, BC3, BC7, etc.) |
| m_nSize | u32 | Compressed size in bytes |
| m_nOffset | u64 | Offset in CIVBIG container |

### BLP::BlobEntry

Describes binary blob assets (models, animations, scripts, etc.).

#### Key Fields

| Field | Type | Description |
|-------|------|-------------|
| m_Name | string | Asset name/identifier |
| m_nBlobType | u32 | Blob type identifier |
| m_nSize | u32 | Blob size in bytes |
| m_mFlags | u32 | Flags describing blob properties |

### BLP::GpuBufferEntry

Describes GPU buffer assets (vertex buffers, index buffers).

#### Key Fields

| Field | Type | Description |
|-------|------|-------------|
| m_Name | string | Asset name/identifier |
| m_nBytesPerElement | u32 | Size of each element in bytes |
| m_nElementCount | u32 | Number of elements in buffer |

### BLP::SoundBankEntry

Describes Wwise sound bank assets.

#### Key Fields

| Field | Type | Description |
|-------|------|-------------|
| m_Name | string | Sound bank name/identifier |
| m_nSize | u32 | Sound bank size in bytes |

## CIVBIG Container Format

CIVBIG files are the actual storage containers for asset data referenced by BLP manifests. Each CIVBIG file stores a single asset payload.

### File Layout

```
Offset  Size  Type   Field         Description
------  ----  ----   -----         -----------
0x00    6     char   magic         "CIVBIG" (ASCII, not null-terminated)
0x06    2     -      padding       Reserved/padding
0x08    4     u32    payloadSize   Size of payload data in bytes
0x0C    2     u16    dataOffset    Offset to payload data (always 0x10)
0x0E    2     u16    typeFlag      Asset type identifier
0x10    ...   -      payload       Raw asset data
```

### Type Flags

| Value | Type | Description |
|-------|------|-------------|
| 0 | GPU | GPU buffer data (vertex/index buffers) |
| 1 | Texture | Texture data (DDS-format, often compressed) |
| 2 | Blob | Binary blob data (models, animations, etc.) |
| 3 | SoundBank | Wwise sound bank data |

### Compression

Payloads may be compressed using Oodle Kraken compression. Compressed data can be identified by:
- First byte of payload = 0x8C (Oodle Kraken signature)
- Requires Oodle decompression library to extract

Uncompressed payloads contain raw asset data (e.g., DDS texture data, binary mesh data).

## BLP File Families

Civilization VII organizes BLP files into families based on asset type and quality level.

### Family Overview

| Family | Count | BigData Mode | Primary Contents |
|--------|-------|--------------|------------------|
| Material | 16 | External | PBR material textures (albedo, normal, roughness) |
| Material_Low | 16 | External | Low-quality material textures |
| StandardAsset | 8 | Embedded | Meshes, animations, GPU buffers |
| StandardAsset_High | 8 | Embedded | High-quality meshes and buffers |
| StandardAsset_Low | 8 | Embedded | Low-quality meshes and buffers |
| Script | 1 | Embedded | Lua scripts and compiled bytecode |
| UI | 1 | External | User interface textures and layouts |
| UISlugs | 1 | External | UI icon and thumbnail textures |
| VFX | 1 | External | Visual effects textures and data |
| VFX_High | 1 | External | High-quality VFX assets |
| VFX_Low | 1 | External | Low-quality VFX assets |

### BigData Modes

- **External**: Asset data stored in separate CIVBIG files in SHARED_DATA directories
- **Embedded**: Asset data included directly in the BLP file's BigData section

## SHARED_DATA Statistics

The base game's SHARED_DATA directories contain approximately 41,569 CIVBIG container files distributed across asset types.

### Asset Distribution

| Asset Type | Count | Percentage |
|------------|-------|------------|
| Textures | 18,186 | 43.7% |
| GPU Buffers | 13,112 | 31.5% |
| Blobs | 8,099 | 19.5% |
| Sound Banks | 2,172 | 5.2% |

### Storage Patterns

- **Material families**: Heavy texture usage, external storage for streaming efficiency
- **StandardAsset families**: Mixed content with embedded storage for faster access
- **VFX families**: Specialized textures with quality-level variants

## Parsing Workflow

To fully parse a BLP file:

1. **Read file header** (1024 bytes)
   - Validate magic "CIVBLP"
   - Extract packageDataOffset, packageDataSize, bigDataOffset, bigDataCount

2. **Parse package preamble** (16 bytes at offset 0x400)
   - Read version, ptr_size, alignment, header_size

3. **Parse package header** (72 bytes)
   - Extract offsets and sizes for all 5 stripes

4. **Read RootTypeName stripe**
   - Extract root type name string

5. **Parse TempData stripe**
   - Locate allocation table
   - Parse all allocation entries (40 bytes each)

6. **Parse TypeInfoStripe**
   - Deserialize type definitions (TypeVersion, EnumVersion, FieldVersion)
   - Build type system lookup tables

7. **Parse PackageBlock**
   - Use type definitions to interpret serialized objects
   - Resolve pointers using allocation table
   - Extract asset entries (TextureEntry, BlobEntry, etc.)

8. **Process BigData (if present)**
   - Parse embedded asset payloads
   - Match to entries via offset/size

9. **Resolve external references**
   - Map asset names to CIVBIG file paths
   - Load and decompress CIVBIG payloads as needed

## Implementation Notes

### Common Pitfalls

1. **Endianness**: All fields are little-endian. Do not assume big-endian anywhere.

2. **Allocation indexing**: Pointers use 1-based indexing, not 0-based. Pointer value N refers to allocation[N-1].

3. **Stripe index extraction**: The stripeIndex field is u64, but only the low byte matters for determining which stripe (0-4).

4. **Header size**: BLP file header is 1024 bytes, not 512 (Civ6 used 512).

5. **Type system parsing**: TypeInfoStripe is binary-encoded, not text. Requires careful parsing of type definition records.

### Performance Considerations

- **Lazy loading**: Parse only the allocation table and entry descriptors initially, defer BigData extraction
- **Memory mapping**: Use memory-mapped file I/O for large BLP files
- **Caching**: Cache parsed type definitions across multiple BLP files (types are consistent)
- **Parallel processing**: CIVBIG extraction can be parallelized since files are independent

### Compatibility

This specification describes the format observed in Civilization VII version 1.0. Future game updates may introduce:
- New package preamble versions
- Additional stripe types
- New entry types
- Extended field definitions

Always validate version fields before parsing to ensure compatibility.

## References

- Civilization VI BLP format (predecessor, different header size and field layouts)
- Oodle compression library documentation (for CIVBIG payload decompression)
- DirectDraw Surface (DDS) format specification (for texture payloads)
- Wwise audio engine documentation (for sound bank structure)

## Glossary

- **Allocation**: A reference entry in the allocation table that maps pointers to actual data locations
- **BigData**: Embedded or external binary asset payload data
- **CIVBIG**: Container file format for storing individual asset payloads
- **Package**: A BLP file containing multiple asset descriptors
- **Stripe**: Named data segment within package data (e.g., TypeInfoStripe, PackageBlock)
- **Type system**: Self-describing reflection data that defines struct layouts and field types
