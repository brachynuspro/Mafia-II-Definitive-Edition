// extrair-sds-batch.mjs - extrai todos os .sds de voz e salva em 04-export/extraidos/<pasta>/<arquivo>
// usa o extrator local (zlib + adler32) para o conteudo bruto; o FSB5 dentro do Sound resource
// sera decodificado depois por FmodProbe (FMOD 5.x).
//
// uso: node extrair-sds-batch.mjs <pasta-jogo> <pasta-saida> [limite]
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, basename, relative, sep } from 'node:path';
import { inflateSync } from 'node:zlib';

const root = process.argv[2] || 'D:\\SteamLibrary\\steamapps\\common\\Mafia II Definitive Edition';
const outRoot = process.argv[3] || join(root, 'DublagemIA', '04-export', 'extraidos');
const limit = Number(process.argv[4] || Infinity);

function adler32(b) {
  let s1 = 1, s2 = 0;
  for (let i = 0; i < b.length; i++) { s1 = (s1 + b[i]) % 65521; s2 = (s2 + s1) % 65521; }
  return ((s2 << 16) | s1) >>> 0;
}

function findZlibEnd(buf, start) {
  const MAX = Math.min(buf.length, start + 4 * 1024 * 1024);  // limite maior
  let firstOk = -1, lastOk = -1;
  for (let end = start + 2; end <= MAX; end += 256) {
    let d = null;
    try { d = inflateSync(buf.subarray(start, end)); } catch { continue; }
    if (firstOk < 0) firstOk = end;
    lastOk = end;
    if (d.length >= 16384) break;  // ja temos um bloco grande suficiente
  }
  if (firstOk < 0) return { end: start + 2, decompSize: 0, error: 'nenhum end descompacta' };
  const from = Math.max(start + 2, firstOk - 256);
  for (let end = from; end <= lastOk; end++) {
    let d = null;
    try { d = inflateSync(buf.subarray(start, end)); } catch { continue; }
    if (adler32(d) === buf.readUInt32BE(end - 4)) {
      return { end, decompSize: d.length };
    }
  }
  return { end: firstOk, decompSize: 0, error: 'adler32 nao bateu' };
}

function extractSDS(path) {
  const buf = readFileSync(path);
  if (buf.subarray(0,4).toString('latin1') !== 'SDS\0') return { error: 'nao-SDS', blocks: 0 };
  const results = [];
  let pos = 0x1C;
  for (let n = 0; n < 1000; n++) {
    if (pos >= buf.length) break;
    let zpos = -1;
    for (let i = pos; i < buf.length - 1; i++) {
      if (buf[i] === 0x78 && (buf[i+1] === 0x9c || buf[i+1] === 0x01 || buf[i+1] === 0xda)) {
        try {
          const d = inflateSync(buf.subarray(i, Math.min(buf.length, i + 65536)));
          if (d.length >= 256) { zpos = i; break; }
        } catch {}
      }
    }
    if (zpos < 0) break;
    const r = findZlibEnd(buf, zpos);
    if (r.decompSize > 0) {
      try {
        const decomp = inflateSync(buf.subarray(zpos, r.end));
        results.push({ offset: zpos, end: r.end, decomp });
      } catch {}
    }
    pos = r.end + 32;
  }
  return { blocks: results.length, results };
}

function* walkSds(rootDir) {
  const dirs = ['script_sounds', 'speech', 'speech_shops', 'fmv'];
  for (const d of dirs) {
    const full = join(rootDir, 'pc', 'sds', d);
    if (!existsSync(full)) continue;
    yield* walkDir(full, d);
  }
}

function* walkDir(dir, prefix) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      yield* walkDir(p, join(prefix, e.name));
    } else if (e.name.endsWith('.sds')) {
      yield { path: p, rel: join(prefix, e.name) };
    }
  }
}

const sdsList = [...walkSds(root)];
console.log(`SDS de voz: ${sdsList.length}`);
const useList = sdsList.slice(0, limit);

mkdirSync(outRoot, { recursive: true });
const t0 = Date.now();
let total = 0, totalBytes = 0, withFsb5 = 0;
for (const { path, rel } of useList) {
  const outDir = join(outRoot, dirname(rel));
  mkdirSync(outDir, { recursive: true });
  const x = extractSDS(path);
  if (x.error) continue;
  for (let i = 0; i < x.results.length; i++) {
    const r = x.results[i];
    const out = join(outDir, basename(rel, '.sds') + `_r${i}_${r.decomp.length}B.bin`);
    writeFileSync(out, r.decomp);
    // checa magic: RIFF (WAV) ou FSB5 ou EU/Dabing
    const m = r.decomp.subarray(0, 4).toString('latin1');
    if (m === 'FSB5' || r.decomp.indexOf('FSB5') >= 0) withFsb5++;
    total++;
    totalBytes += r.decomp.length;
  }
  if ((total + 0) % 50 === 0) {
    const dt = (Date.now() - t0) / 1000;
    console.log(`  ${total} blocos  ${(totalBytes/1e6).toFixed(1)} MB  ${dt.toFixed(0)}s  fsb5=${withFsb5}`);
  }
}
const dt = (Date.now() - t0) / 1000;
console.log(`TOTAL: ${total} blocos, ${(totalBytes/1e6).toFixed(1)} MB, ${dt.toFixed(0)}s, fsb5=${withFsb5}`);
console.log(`saida: ${outRoot}`);
