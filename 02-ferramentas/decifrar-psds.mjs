// decifrar-psds.mjs - tenta decifrar sdsconfig.bin (magic 'psds') com TEA e varias chaves
// uso: node decifrar-psds.mjs <sdsconfig.bin> [maxTentativas]
import { readFileSync } from 'node:fs';

const path = process.argv[2];
const maxTries = Number(process.argv[3] || 2000);
const buf = readFileSync(path);

console.log(`arquivo: ${path}  tamanho: ${buf.length} bytes`);
console.log(`magic:   ${buf.toString('latin1', 0, 4)}`);
console.log(`n_sec:   ${buf.readUInt32LE(4)}`);
console.log(`offset1: 0x${buf.readUInt32LE(8).toString(16)}`);
console.log('');

// ---------- TEA decryption (8 bytes por bloco, chave de 16 bytes) ----------
function teaDecrypt(v, k) {
  let v0 = v[0], v1 = v[1];
  let sum = 0xC6EF3720;  // delta * 32
  const delta = 0x9E3779B9;
  for (let i = 0; i < 32; i++) {
    v1 = (v1 - (((v0 << 4) + k[2]) ^ (v0 + sum) ^ ((v0 >>> 5) + k[3]))) >>> 0;
    v0 = (v0 - (((v1 << 4) + k[0]) ^ (v1 + sum) ^ ((v1 >>> 5) + k[1]))) >>> 0;
    sum = (sum - delta) >>> 0;
  }
  return [v0 >>> 0, v1 >>> 0];
}

function tryKey(key) {
  // Decifra do offset 8 ate offset1 (ou ate maxTries)
  const out = Buffer.from(buf);
  const off1 = out.readUInt32LE(8);
  for (let p = 8; p + 8 <= Math.min(out.length, off1); p += 8) {
    const v = [out.readUInt32LE(p), out.readUInt32LE(p+4)];
    const d = teaDecrypt(v, key);
    out.writeUInt32LE(d[0], p);
    out.writeUInt32LE(d[1], p+4);
  }
  // Verifica se parece texto ASCII valido
  let printable = 0, total = 0;
  for (let i = 8; i < Math.min(out.length, off1); i++) {
    total++;
    const c = out[i];
    if ((c >= 0x20 && c < 0x7f) || c === 0x0a || c === 0x0d || c === 0x09) printable++;
  }
  return { printable, total, ratio: printable / total, text: out.toString('latin1', 8, Math.min(out.length, 8 + 200)) };
}

// Tenta varias chaves candidatas
const candidates = [
  [0,0,0,0],
  [1,1,1,1],
  [0x706F6473, 0x70726F63, 0x65737369, 0x6E672073],  // 'pods proc essing s'
  [0x70736473, 0x00000002, 0x00000000, 0x00000000],  // 'psds' + n_sec
  [0x70736473, 0x70736473, 0x70736473, 0x70736473],  // 'psds' repetido
  [0x504F4432, 0x4D415846, 0x49413132, 0x00000000],  // 'POD2 MAXF IA12\0\0\0\0'
  [0x00000000, 0x00000000, 0x00000000, 0x00000000],  // zeros
];

for (const k of candidates) {
  const r = tryKey(k);
  const khex = k.map(x => x.toString(16).padStart(8,'0')).join(' ');
  console.log(`chave ${khex}: printable=${r.printable}/${r.total} (${(r.ratio*100).toFixed(1)}%)`);
  if (r.ratio > 0.5) {
    console.log(`  >>> TEXTO DECIFRADO:`);
    console.log(`  ${r.text.replace(/[^\x20-\x7e\n\r\t]/g, '.')}`);
  }
}

// Tentativa adicional: cifra XTEA (variante)
function xteaDecrypt(v, k) {
  let v0 = v[0], v1 = v[1];
  let sum = 0xC6EF3720;
  const delta = 0x9E3779B9;
  for (let i = 0; i < 32; i++) {
    v1 = (v1 - ((((v0 << 4) ^ (v0 >>> 5)) + v0) ^ (sum + k[(sum >>> 11) & 3]))) >>> 0;
    sum = (sum - delta) >>> 0;
    v0 = (v0 - ((((v1 << 4) ^ (v1 >>> 5)) + v1) ^ (sum + k[sum & 3]))) >>> 0;
  }
  return [v0 >>> 0, v1 >>> 0];
}

function tryKeyXtea(key) {
  const out = Buffer.from(buf);
  const off1 = out.readUInt32LE(8);
  for (let p = 8; p + 8 <= Math.min(out.length, off1); p += 8) {
    const v = [out.readUInt32LE(p), out.readUInt32LE(p+4)];
    const d = xteaDecrypt(v, key);
    out.writeUInt32LE(d[0], p);
    out.writeUInt32LE(d[1], p+4);
  }
  let printable = 0, total = 0;
  for (let i = 8; i < Math.min(out.length, off1); i++) {
    total++;
    const c = out[i];
    if ((c >= 0x20 && c < 0x7f) || c === 0x0a || c === 0x0d || c === 0x09) printable++;
  }
  return { printable, total, ratio: printable / total, text: out.toString('latin1', 8, Math.min(out.length, 8 + 200)) };
}

console.log('\n--- XTEA ---');
for (const k of candidates) {
  const r = tryKeyXtea(k);
  const khex = k.map(x => x.toString(16).padStart(8,'0')).join(' ');
  console.log(`chave ${khex}: printable=${r.printable}/${r.total} (${(r.ratio*100).toFixed(1)}%)`);
  if (r.ratio > 0.5) {
    console.log(`  >>> TEXTO DECIFRADO:`);
    console.log(`  ${r.text.replace(/[^\x20-\x7e\n\r\t]/g, '.')}`);
  }
}
