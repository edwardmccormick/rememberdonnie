// Zips a single bundled file as index.js at the root of a Lambda deployment package.
// Usage: node scripts/zip-lambda.mjs <input.js> <output.zip>
// Dependency-free so it runs the same on Windows (Git Bash) and in GitHub Actions.

import { readFileSync, writeFileSync } from 'node:fs';
import { crc32, deflateRawSync } from 'node:zlib';

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.error('usage: node scripts/zip-lambda.mjs <input.js> <output.zip>');
  process.exit(1);
}

const name = Buffer.from('index.js');
const data = readFileSync(input);
const compressed = deflateRawSync(data, { level: 9 });
const checksum = crc32(data);

// Fixed timestamp (1980-01-01) keeps the zip byte-for-byte reproducible.
const DOS_TIME = 0;
const DOS_DATE = (0 << 9) | (1 << 5) | 1;

const local = Buffer.alloc(30);
local.writeUInt32LE(0x04034b50, 0);
local.writeUInt16LE(20, 4); // version needed
local.writeUInt16LE(0, 6); // flags
local.writeUInt16LE(8, 8); // deflate
local.writeUInt16LE(DOS_TIME, 10);
local.writeUInt16LE(DOS_DATE, 12);
local.writeUInt32LE(checksum, 14);
local.writeUInt32LE(compressed.length, 18);
local.writeUInt32LE(data.length, 22);
local.writeUInt16LE(name.length, 26);
local.writeUInt16LE(0, 28);

const central = Buffer.alloc(46);
central.writeUInt32LE(0x02014b50, 0);
central.writeUInt16LE(0x031e, 4); // made by: unix, 3.0
central.writeUInt16LE(20, 6);
central.writeUInt16LE(0, 8);
central.writeUInt16LE(8, 10);
central.writeUInt16LE(DOS_TIME, 12);
central.writeUInt16LE(DOS_DATE, 14);
central.writeUInt32LE(checksum, 16);
central.writeUInt32LE(compressed.length, 20);
central.writeUInt32LE(data.length, 24);
central.writeUInt16LE(name.length, 28);
central.writeUInt16LE(0, 30); // extra
central.writeUInt16LE(0, 32); // comment
central.writeUInt16LE(0, 34); // disk
central.writeUInt16LE(0, 36); // internal attrs
central.writeUInt32LE((0o100644 << 16) >>> 0, 38); // -rw-r--r--
central.writeUInt32LE(0, 42); // local header offset

const centralOffset = local.length + name.length + compressed.length;
const centralSize = central.length + name.length;

const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(1, 8);
end.writeUInt16LE(1, 10);
end.writeUInt32LE(centralSize, 12);
end.writeUInt32LE(centralOffset, 16);

writeFileSync(output, Buffer.concat([local, name, compressed, central, name, end]));
console.log(`${output}: ${(data.length / 1024).toFixed(0)} KiB -> ${((centralOffset + centralSize + 22) / 1024).toFixed(0)} KiB`);
