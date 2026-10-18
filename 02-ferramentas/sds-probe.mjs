// Sonda empirica do container SDS (Mafia II, versao 19) - descobre o layout
// lendo bytes reais, sem assumir o formato.
import { readFileSync } from 'node:fs';

const path = process.argv[2];
const buf = readFileSync(path);
const u32 = (o) => buf.readUInt32LE(o);

console.log(`arquivo : ${path}`);
console.log(`tamanho : ${buf.length} bytes`);
console.log(`sig     : ${JSON.stringify(buf.toString('latin1', 0, 4))}`);
console.log(`versao  : ${u32(4)}`);
console.log(`plataforma: ${JSON.stringify(buf.toString('latin1', 8, 12))}`);
console.log('\n=== primeiros 16 DWORD apos o cabecalho ===');
for (let i = 12; i < 12 + 16 * 4; i += 4) {
  console.log(`  0x${i.toString(16).padStart(2, '0')}  ${String(u32(i)).padStart(12)}  (0x${u32(i).toString(16)})`);
}

// Procura a tabela de nomes: sequencias ASCII impressas separadas por \0
function asciiRuns(from, to, minLen = 3) {
  const out = [];
  let cur = '';
  let start = 0;
  for (let i = from; i < to; i++) {
    const c = buf[i];
    if (c >= 0x20 && c < 0x7f) {
      if (!cur) start = i;
      cur += String.fromCharCode(c);
    } else if (c === 0 && cur.length >= minLen) {
      out.push([start, cur]);
      cur = '';
    } else {
      cur = '';
    }
  }
  return out;
}

const head = asciiRuns(0, Math.min(buf.length, 8192));
console.log(`\n=== strings ASCII nos primeiros 8 KB: ${head.length} ===`);
head.slice(0, 40).forEach(([off, s]) => console.log(`  0x${off.toString(16).padStart(5, '0')}  ${s}`));

// Detecta magic de audio/texto dentro do arquivo
const markers = [
  [0x52494646, 'RIFF'],
  [0x57415645, 'WAVE (ascii)'],
  [0x666d7420, 'fmt '],
  [0x4f676753, 'OggS'],
  [0x1a45dfa3, 'EBML/Matroska'],
];
console.log('\n=== marcadores de midia encontrados ===');
for (const [magic, label] of markers) {
  const pat = Buffer.alloc(4);
  pat.writeUInt32BE(magic);
  const idx = [];
  let pos = 0;
  while ((pos = buf.indexOf(pat, pos)) !== -1 && idx.length < 5) { idx.push(pos); pos++; }
  if (idx.length) console.log(`  ${label.padEnd(12)} ${idx.length}+ ocorrencia(s): ${idx.map(p => '0x' + p.toString(16)).join(', ')}`);
}

// Zlib 0x78 0x9C/0x78 0x01/0x78 0xDA
const zlibCount = [];
for (let i = 0; i < buf.length - 1; i++) {
  if (buf[i] === 0x78 && (buf[i + 1] === 0x9c || buf[i + 1] === 0x01 || buf[i + 1] === 0xda)) zlibCount.push(i);
  if (zlibCount.length > 200) break;
}
console.log(`\n=== posibles blocos zlib (0x78 0x9C/01/DA): ${zlibCount.length}${zlibCount.length ? ' primeiros: ' + zlibCount.slice(0, 15).map(p => '0x' + p.toString(16)).join(', ') : ''} ===`);

// Oodle: procura a assinatura do stream header
const ooMarkers = [Buffer.from('OVrd', 'latin1'), Buffer.from('OVrb', 'latin1'), Buffer.from('RAWc', 'latin1')];
for (const m of ooMarkers) {
  const p = buf.indexOf(m);
  console.log(`Oodle ${m.toString('latin1')}: ${p >= 0 ? '0x' + p.toString(16) : 'nao encontrado'}`);
}