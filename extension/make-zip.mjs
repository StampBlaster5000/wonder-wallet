/* Minimal, dependency-free ZIP writer (deflate) — used to repackage extension/dist into the
   downloadable public/wonder-wallet-extension.zip on every build. No archiver/adm-zip needed
   (this env prunes devDeps in prod, so we avoid adding a runtime-adjacent dependency). */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { join, relative, sep } from 'path';
import { deflateRawSync } from 'zlib';

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c >>> 0; }
  return t;
})();
function crc32(buf) { let c = 0xFFFFFFFF; for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }

function walk(dir, out = []) {
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}

// Fixed DOS timestamp (1980-01-01) so the archive is reproducible build-to-build.
const DOSTIME = 0, DOSDATE = 0x21;

export function makeZip(srcDir, outPath, prefix = '') {
  const files = walk(srcDir);
  const locals = [], central = [];
  let offset = 0;
  for (const f of files) {
    const rel = (prefix ? prefix + '/' : '') + relative(srcDir, f).split(sep).join('/');
    const nameBuf = Buffer.from(rel, 'utf8');
    const data = readFileSync(f);
    const crc = crc32(data);
    const comp = deflateRawSync(data, { level: 9 });

    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0, 6); lh.writeUInt16LE(8, 8);
    lh.writeUInt16LE(DOSTIME, 10); lh.writeUInt16LE(DOSDATE, 12);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26); lh.writeUInt16LE(0, 28);
    locals.push(lh, nameBuf, comp);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6); cd.writeUInt16LE(0, 8); cd.writeUInt16LE(8, 10);
    cd.writeUInt16LE(DOSTIME, 12); cd.writeUInt16LE(DOSDATE, 14);
    cd.writeUInt32LE(crc, 16); cd.writeUInt32LE(comp.length, 20); cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28); cd.writeUInt16LE(0, 30); cd.writeUInt16LE(0, 32);
    cd.writeUInt16LE(0, 34); cd.writeUInt16LE(0, 36); cd.writeUInt32LE(0, 38); cd.writeUInt32LE(offset, 42);
    central.push(cd, nameBuf);

    offset += lh.length + nameBuf.length + comp.length;
  }
  const localPart = Buffer.concat(locals);
  const centralPart = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(0, 4); eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8); eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralPart.length, 12); eocd.writeUInt32LE(localPart.length, 16); eocd.writeUInt16LE(0, 20);
  writeFileSync(outPath, Buffer.concat([localPart, centralPart, eocd]));
  return { files: files.length, bytes: localPart.length + centralPart.length + eocd.length };
}
