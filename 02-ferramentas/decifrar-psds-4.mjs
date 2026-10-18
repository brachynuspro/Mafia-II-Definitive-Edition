// decifrar-psds-4.mjs - tenta decifrar sdsconfig.bin com Gibbed TEA key em varios offsets
// Hipotese: sdsconfig.bin pode ser SDS-like mas com cifra custom
// Tambem: testa varias posicoes de inicio e parametros TEA
import { readFileSync, writeFileSync } from 'node:fs';

const KEY = [0x73766E46, 0x6D454D5A, 0x336A6D68, 0x38425072];

function teaDecrypt(data, offset, count, keys, sum, delta, rounds) {
  for (let i = offset; i + 8 <= offset + count; i += 8) {
    let v0 = data.readUInt32LE(i + 0);
    let v1 = data.readUInt32LE(i + 4);
    for (let r = 0; r < rounds; r++) {
      v1 = (v1 - (((v0 << 4) + keys[2]) ^ (v0 + sum) ^ ((v0 >>> 5) + keys[3]))) >>> 0;
      v0 = (v0 - (((v1 << 4) + keys[0]) ^ (v1 + sum) ^ ((v1 >>> 5) + keys[1]))) >>> 0;
      sum = (sum - delta) >>> 0;
    }
    data.writeUInt32LE(v0, i + 0);
    data.writeUInt32LE(v1, i + 4);
  }
}

function legibility(buf, from, to) {
  let total = 0, printable = 0;
  for (let i = from; i < to; i++) {
    const c = buf[i];
    total++;
    if (c >= 0x20 && c < 0x7f) printable++;
    else if (c === 0x09 || c === 0x0a || c === 0x0d) printable++;
  }
  return { total, printable, ratio: total > 0 ? printable / total : 0 };
}

const data = readFileSync('D:\\SteamLibrary\\steamapps\\common\\Mafia II Definitive Edition\\pc\\sds\\sdsconfig.bin');
console.log(`sdsconfig.bin: ${data.length} B`);

// Variacoes de TEA: padrao + Gibbed
const ALL_TEA_PARAMS = [
  // TEA padrao
  { name: 'std-32',  sum: 0xC6EF3720, delta: 0x9E3779B9, rounds: 32 },
  { name: 'std-16',  sum: 0xE3779B90, delta: 0x9E3779B9, rounds: 16 },
  { name: 'std-8',   sum: 0xF1BBCDC8, delta: 0x9E3779B9, rounds: 8 },
  // Gibbed
  { name: 'gibbed-5',  sum: 0x79FB0B01, delta: 0x4B989BCD, rounds: 5 },
  { name: 'gibbed-32', sum: 0xA62336C0, delta: 0x9D3119B6, rounds: 32 },
];

const OFFSETS = [
  { name: 'todo (8 ate end)', from: 8, to: data.length },
  { name: 'cabecalho (8 ate off1=668)', from: 8, to: 0x29C },
  { name: 'pulado header (12 ate end)', from: 12, to: data.length },
];

for (const off of OFFSETS) {
  for (const p of ALL_TEA_PARAMS) {
    const out = Buffer.from(data);
    teaDecrypt(out, off.from, off.to - off.from, KEY, p.sum, p.delta, p.rounds);
    const leg = legibility(out, Math.max(8, off.from), Math.min(out.length, off.from + 256));
    if (leg.ratio > 0.5) {
      const sample = out.toString('latin1', off.from, Math.min(out.length, off.from + 200)).replace(/[^\x20-\x7e\n\r\t]/g, '.');
      console.log(`[${off.name}] ${p.name}: ${(leg.ratio*100).toFixed(0)}% printable`);
      console.log(`  sample: ${sample.slice(0, 200)}`);
    }
  }
}

console.log('\n--- XOR com KEY bruta ---');
// XOR simples com KEY (4 u32 = 16 bytes) repetida
for (const off of OFFSETS) {
  const out = Buffer.from(data);
  const keyBuf = Buffer.alloc(16);
  keyBuf.writeUInt32LE(KEY[0], 0);
  keyBuf.writeUInt32LE(KEY[1], 4);
  keyBuf.writeUInt32LE(KEY[2], 8);
  keyBuf.writeUInt32LE(KEY[3], 12);
  for (let i = off.from; i < off.to; i++) {
    out[i] = data[i] ^ keyBuf[(i - off.from) % 16];
  }
  const leg = legibility(out, Math.max(8, off.from), Math.min(out.length, off.from + 256));
  if (leg.ratio > 0.3) {
    const sample = out.toString('latin1', off.from, Math.min(out.length, off.from + 200)).replace(/[^\x20-\x7e\n\r\t]/g, '.');
    console.log(`[${off.name}] XOR-KEY: ${(leg.ratio*100).toFixed(0)}%`);
    console.log(`  sample: ${sample.slice(0, 200)}`);
  }
}
