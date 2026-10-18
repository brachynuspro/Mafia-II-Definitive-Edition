// extrair-sds.mjs - extrai recursos de containers SDS v19 (Mafia II / DE)
// Scanner robusto: encontra cada bloco zlib, descompacta ate o fim,
// avanca pos para logo apos o adler32 e refaz a busca.
//
// uso: node extrair-sds.mjs <arquivo.sds> [pasta-saida] [max-recursos]
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { inflateSync, inflateRawSync } from 'node:zlib';
import { basename, dirname, join } from 'node:path';

const input = process.argv[2];
const outDir = process.argv[3] || join(dirname(input), basename(input, '.sds'));
const maxN = Number(process.argv[4] || 1000);
const buf = readFileSync(input);

function u32(o) { return buf.readUInt32LE(o); }
function ascii(o, len) { return buf.toString('latin1', o, o+len).replace(/\0+$/g, ''); }

console.log(`=== ${basename(input)} (${buf.length} B) ===`);
if (buf.toString('latin1', 0, 4) !== 'SDS\0') { console.log('nao e SDS'); process.exit(1); }
const ver = u32(4);
const nSlots = u32(16);
const strTblSize = u32(20);
const dataOff = u32(24);
const recOff = u32(28);
console.log(`n_slots=${nSlots}  strTblSize=${strTblSize}  dataOff=0x${dataOff.toString(16)}  recOff=0x${recOff.toString(16)}`);

if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

// Calcula adler32 do output descomprimido
function adler32(buf) {
  let s1 = 1, s2 = 0;
  for (let i = 0; i < buf.length; i++) {
    s1 = (s1 + buf[i]) % 65521;
    s2 = (s2 + s1) % 65521;
  }
  return ((s2 << 16) | s1) >>> 0;
}

// Encontra o final de um bloco zlib a partir de 'start'.
// Estrategia: busca linear com step adaptativo.
//   Fase 1: step 256, guardar firstOk e lastOk.
//   Fase 2: refinar com step 1 entre firstOk-256 e lastOk.
function findZlibEnd(start) {
  const MAX = Math.min(buf.length, start + 2 * 1024 * 1024);
  let firstOk = -1, lastOk = -1;
  for (let end = start + 2; end <= MAX; end += 256) {
    let d = null;
    try { d = inflateSync(buf.subarray(start, end)); } catch { continue; }
    if (firstOk < 0) firstOk = end;
    lastOk = end;
  }
  if (firstOk < 0) return { end: start + 2, decompSize: 0, error: 'nenhum end descompacta' };

  // Fase 2: refinar entre firstOk-256 e lastOk, step 1
  const from = Math.max(start + 2, firstOk - 256);
  const to = lastOk;
  for (let end = from; end <= to; end++) {
    let d = null;
    try { d = inflateSync(buf.subarray(start, end)); } catch { continue; }
    const calc = adler32(d);
    const stored = buf.readUInt32BE(end - 4);
    if (calc === stored) {
      return { end, decompSize: d.length };
    }
  }
  return { end: firstOk, decompSize: 0, error: 'nenhum adler32 bate' };
}

let pos = 0x1C;  // comeca a varrer logo apos o header
let ok = 0, fail = 0, totalBytes = 0;

for (let n = 0; n < maxN; n++) {
  if (pos >= buf.length) break;
  // Procura proximo magic zlib a partir de pos, validando que descomprime >= 256 B
  let zpos = -1;
  for (let i = pos; i < buf.length - 1; i++) {
    if (buf[i] === 0x78 && (buf[i+1] === 0x9c || buf[i+1] === 0x01 || buf[i+1] === 0xda)) {
      // Validacao rapida: tenta descompactar ate 16 KB adiante
      try {
        const d = inflateSync(buf.subarray(i, Math.min(buf.length, i + 16384)));
        if (d.length >= 256) { zpos = i; break; }
      } catch {}
    }
  }
  if (zpos < 0) break;

  const result = findZlibEnd(zpos);
  if (result.decompSize > 0) {
    try {
      const decomp = inflateSync(buf.subarray(zpos, result.end));
      const m = decomp.subarray(0, 4).toString('latin1');
      let ext = 'bin';
      if (m === 'RIFF') ext = 'wav';
      else if (m === 'DDS ') ext = 'dds';
      else if (m === '\x89PNG') ext = 'png';
      const name = `r${n.toString().padStart(3,'0')}_${decomp.length}B.${ext}`;
      writeFileSync(join(outDir, name), decomp);
      ok++; totalBytes += decomp.length;
      if (n < 10) console.log(`  r${n}: 0x${zpos.toString(16)}-0x${result.end.toString(16)} (${result.end - zpos} B comp) -> ${decomp.length} B ${m}`);
    } catch (e) {
      fail++;
      if (fail < 5) console.log(`  r${n}: 0x${zpos.toString(16)} -> inflate falhou: ${e.message}`);
    }
  } else {
    fail++;
    if (fail < 5) console.log(`  r${n}: 0x${zpos.toString(16)} -> sem descompactacao: ${result.error || '?'}`);
  }
  pos = result.end + 32;  // 32 bytes de gap = registro do proximo recurso
}

console.log(`ok=${ok}  fail=${fail}  totalBytes=${totalBytes}`);
console.log(`saida: ${outDir}`);
