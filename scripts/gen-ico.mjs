/**
 * Convert resources/icon.png to resources/icon.ico (Windows ICO format)
 * Simple ICO wrapper around the PNG data.
 */

import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pngPath = join(__dirname, '..', 'resources', 'icon.png');
const icoPath = join(__dirname, '..', 'resources', 'icon.ico');

const pngData = readFileSync(pngPath);

// Parse PNG IHDR to get dimensions
// PNG signature (8 bytes) + IHDR length (4) + "IHDR" (4) + width (4) + height (4)
const width = pngData.readUInt32BE(16);
const height = pngData.readUInt32BE(20);

// ICO header (6 bytes)
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);  // reserved
header.writeUInt16LE(1, 2);  // type: 1 = ICO
header.writeUInt16LE(1, 4);  // count: 1 image

// ICO directory entry (16 bytes)
const entry = Buffer.alloc(16);
entry[0] = width >= 256 ? 0 : width;   // width (0 = 256)
entry[1] = height >= 256 ? 0 : height; // height (0 = 256)
entry[2] = 0;  // color palette
entry[3] = 0;  // reserved
entry.writeUInt16LE(1, 4);  // color planes
entry.writeUInt16LE(32, 6); // bits per pixel
entry.writeUInt32LE(pngData.length, 8);  // data size
entry.writeUInt32LE(22, 12);  // data offset (6 + 16 = 22)

const ico = Buffer.concat([header, entry, pngData]);
writeFileSync(icoPath, ico);
console.log(`ICO written to ${icoPath} (${ico.length} bytes, ${width}x${height})`);
