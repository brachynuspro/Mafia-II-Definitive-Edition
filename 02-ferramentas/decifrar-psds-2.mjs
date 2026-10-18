// decifrar-psds-2.mjs - tenta cifras alternativas para sdsconfig.bin
// Adiciona: XOR keystream (varias chaves), RC4, XOR com bytes do .exe
// uso: node decifrar-psds-2.mjs
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const cfg = readFileSync('D:\\SteamLibrary\\steamapps\\common\\Mafia II Definitive Edition\\pc\\sds\\sdsconfig.bin');
const exe = readFileSync('D:\\SteamLibrary\\steamapps\\common\\Mafia II Definitive Edition\\pc\\Mafia II Definitive Edition.exe');

console.log(`tamanho sdsconfig.bin: ${cfg.length} bytes`);
console.log(`magic: ${cfg.toString('latin1', 0, 4)}`);
const nSec = cfg.readUInt32LE(4);
const off1 = cfg.readUInt32LE(8);
console.log(`n_sec=${nSec} off1=0x${off1.toString(16)} (${off1})`);
console.log(`off1 limite real: ${Math.min(off1, cfg.length)} bytes do header (8 ate off1) cifrados?`);

// Funcao para medir legibilidade
function legibility(buf, from, to) {
  let total = 0, printable = 0, ascii = 0;
  for (let i = from; i < to; i++) {
    const c = buf[i];
    total++;
    if (c >= 0x20 && c < 0x7f) { printable++; ascii++; }
    else if (c === 0x09 || c === 0x0a || c === 0x0d) { printable++; }
  }
  return { total, printable, ascii, ratio: printable / total };
}

// =========== TESTE 1: XOR com chaves simples / strings do .exe ===========
const keyStrings = [
  'psds',
  'psds\x02\x00\x00\x00',
  'sdsconfig',
  'sdsconfig.bin',
  'Brazilian',
  'audio_hash_value',
  'full',
  'Mafia',
  'Illusion',
  'Illusion Engine',
  'Gibbed',
  'SDS',
  'sds_en',
  'en',
  'br',
  '\x00\x00\x00\x00\x00\x00\x00\x00',
  'POD2',
  'MAXF',
  'NCS',
  'NCSOFT',
  'IllusionSoftworks',
];

console.log('\n=== XOR keystream com strings como chave ===');
for (const key of keyStrings) {
  const kb = Buffer.from(key, 'latin1');
  const out = Buffer.from(cfg);
  for (let p = 8; p < off1; p++) {
    out[p] = cfg[p] ^ kb[(p - 8) % kb.length];
  }
  const leg = legibility(out, 8, Math.min(64, off1));
  if (leg.ratio > 0.3) {
    const sample = out.toString('latin1', 8, Math.min(8 + 64, off1)).replace(/[^\x20-\x7e]/g, '.');
    console.log(`  key='${key.slice(0, 30)}' printable=${(leg.ratio*100).toFixed(0)}% sample="${sample}"`);
  }
}

// =========== TESTE 2: XOR com bytes derivados do .exe ===========
console.log('\n=== XOR com bytes extraidos do .exe ===');

// Tentar XOR com primeiros 16 bytes de regiao 0x3EFA40 (call site da cifra)
const callSite = exe.subarray(0x3EFA40, 0x3EFA40 + 16);
{
  const out = Buffer.from(cfg);
  for (let p = 8; p < off1; p++) out[p] = cfg[p] ^ callSite[(p-8) % 16];
  const leg = legibility(out, 8, Math.min(64, off1));
  console.log(`  XOR call-site 0x3EFA40: ${(leg.ratio*100).toFixed(0)}%`);
}

// Tentar XOR com primeiros 16 bytes do string 'sdsconfig' no exe (0x186E259)
const sdsConfigStr = exe.subarray(0x186E259, 0x186E259 + 16);
{
  const out = Buffer.from(cfg);
  for (let p = 8; p < off1; p++) out[p] = cfg[p] ^ sdsConfigStr[(p-8) % 16];
  const leg = legibility(out, 8, Math.min(64, off1));
  console.log(`  XOR pointer string 0x186E259: ${(leg.ratio*100).toFixed(0)}%`);
}

// Tentar XOR com 16 bytes de varios offsets onde ha strings conhecidas
const candidateOffsets = [
  0x18525B0, // 'full'
  0x18526B0, // 'Brazilian'
  0x186E318, // 'sdsNameTable.txt'
  0x184DC6C, // 'sds_*'
  0x184DC78, // '__sds_base_id'
];
for (const off of candidateOffsets) {
  const ks = exe.subarray(off, off + 16);
  const out = Buffer.from(cfg);
  for (let p = 8; p < off1; p++) out[p] = cfg[p] ^ ks[(p-8) % 16];
  const leg = legibility(out, 8, Math.min(64, off1));
  if (leg.ratio > 0.2) {
    const sample = out.toString('latin1', 8, Math.min(8 + 64, off1)).replace(/[^\x20-\x7e]/g, '.');
    console.log(`  XOR exe[0x${off.toString(16)}] ("${exe.toString('latin1', off, off+10).replace(/\0/g, '')}"): ${(leg.ratio*100).toFixed(0)}% sample="${sample}"`);
  }
}

// =========== TESTE 3: ADD/SUB com chave ===========
console.log('\n=== ADD (subtracao) com chave simples ===');
for (const key of ['psds', 'SDS\0', 'SDS19', 'brazilian']) {
  const kb = Buffer.from(key, 'latin1');
  const out = Buffer.from(cfg);
  for (let p = 8; p < off1; p++) out[p] = (cfg[p] - kb[(p-8) % kb.length] + 256) & 0xff;
  const leg = legibility(out, 8, Math.min(64, off1));
  if (leg.ratio > 0.3) {
    const sample = out.toString('latin1', 8, Math.min(8 + 64, off1)).replace(/[^\x20-\x7e]/g, '.');
    console.log(`  ADD('${key}'): ${(leg.ratio*100).toFixed(0)}% sample="${sample}"`);
  }
}

// =========== TESTE 4: RC4 com varias chaves ===========
console.log('\n=== RC4 (KSA + PRGA) com chaves candidatas ===');
function rc4(key, data) {
  // KSA
  const S = new Uint8Array(256);
  for (let i = 0; i < 256; i++) S[i] = i;
  let j = 0;
  for (let i = 0; i < 256; i++) {
    j = (j + S[i] + key[i % key.length]) & 0xff;
    [S[i], S[j]] = [S[j], S[i]];
  }
  // PRGA
  const out = Buffer.alloc(data.length);
  let ii = 0, jj = 0;
  for (let n = 0; n < data.length; n++) {
    ii = (ii + 1) & 0xff;
    jj = (jj + S[ii]) & 0xff;
    [S[ii], S[jj]] = [S[jj], S[ii]];
    out[n] = data[n] ^ S[(S[ii] + S[jj]) & 0xff];
  }
  return out;
}

for (const key of keyStrings) {
  const kb = Buffer.from(key, 'latin1');
  const dec = rc4(kb, cfg.subarray(8, off1));
  const leg = legibility(dec, 0, Math.min(64, dec.length));
  if (leg.ratio > 0.5) {
    const sample = dec.toString('latin1', 0, Math.min(64, dec.length)).replace(/[^\x20-\x7e]/g, '.');
    console.log(`  RC4('${key.slice(0, 30)}'): ${(leg.ratio*100).toFixed(0)}% sample="${sample}"`);
  }
}

// =========== TESTE 5: Brute-force TEA com 4-byte rolling key ===========
console.log('\n=== Brute-force TEA com u32 LE key from mid-range ===');
function teaDecryptFull(buf, key, from, to) {
  const out = Buffer.from(buf);
  const delta = 0x9E3779B9;
  for (let p = from; p + 8 <= to; p += 8) {
    let v0 = out.readUInt32LE(p);
    let v1 = out.readUInt32LE(p + 4);
    let sum = 0xC6EF3720;
    for (let i = 0; i < 32; i++) {
      v1 = (v1 - (((v0 << 4) + key[2]) ^ (v0 + sum) ^ ((v0 >>> 5) + key[3]))) >>> 0;
      v0 = (v0 - (((v1 << 4) + key[0]) ^ (v1 + sum) ^ ((v1 >>> 5) + key[1]))) >>> 0;
      sum = (sum - delta) >>> 0;
    }
    out.writeUInt32LE(v0, p);
    out.writeUInt32LE(v1, p + 4);
  }
  return out;
}

// Tentar chaves de 4 u32 derivados do proprio sdsconfig.bin (8 bytes do header depois de psds)
const headerKey = [cfg.readUInt32LE(8), cfg.readUInt32LE(12), cfg.readUInt32LE(16), cfg.readUInt32LE(20)];
const dec = teaDecryptFull(cfg, headerKey, 8, off1);
const leg = legibility(dec, 8, Math.min(64, off1));
console.log(`  TEA c/ primeiros 16B do proprio payload como key: ${(leg.ratio*100).toFixed(0)}%`);

console.log('\n--- fim ---');
