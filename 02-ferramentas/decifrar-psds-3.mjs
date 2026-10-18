// decifrar-psds-3.mjs - decifra sdsconfig.bin usando TEA customizada do Gibbed.Illusion
// Replica EXATA de ArchiveEncryption.cs + TEA.cs do Gibbed.Mafia2.FileFormats
// https://github.com/gibbed/Gibbed.Illusion
//
// uso: node decifrar-psds-3.mjs [input] [output]
import { readFileSync, writeFileSync } from 'node:fs';

const KEY = [0x73766E46, 0x6D454D5A, 0x336A6D68, 0x38425072];
const SETTINGS = [
  { sum: 0x79FB0B01, delta: 0x4B989BCD, rounds: 5 },
  { sum: 0xA62336C0, delta: 0x9D3119B6, rounds: 32 },
];

// TEA decrypt: decripta array de bytes (cada 8 bytes) usando sum/delta/rounds variantes
function teaDecrypt(data, offset, count, keys, sum, delta, rounds) {
  for (let i = offset; i + 8 <= offset + count; i += 8) {
    let v0 = data.readUInt32LE(i + 0);
    let v1 = data.readUInt32LE(i + 4);
    for (let r = 0; r < rounds; r++) {
      // >>> NOTA: Gibbed usa >> 5 e >> 4 (não >>> 5 e <<< 4); uint32 wraps
      v1 = (v1 - (((v0 << 4) + keys[2]) ^ (v0 + sum) ^ ((v0 >>> 5) + keys[3]))) >>> 0;
      v0 = (v0 - (((v1 << 4) + keys[0]) ^ (v1 + sum) ^ ((v1 >>> 5) + keys[1]))) >>> 0;
      sum = (sum - delta) >>> 0;
    }
    data.writeUInt32LE(v0, i + 0);
    data.writeUInt32LE(v1, i + 4);
  }
}

// FNV32 hash do Gibbed.Illusion.FileFormats.Hashing.FNV32
function fnv32(data, offset, length) {
  const FNV_OFFSET = 0x811C9DC5;
  const FNV_PRIME = 0x01000193;
  let hash = FNV_OFFSET >>> 0;
  for (let i = 0; i < length; i++) {
    hash = (hash ^ data[offset + i]) >>> 0;
    hash = (Math.imul(hash, FNV_PRIME)) >>> 0;
  }
  return hash >>> 0;
}

// FNV64 hash
function fnv64(data, offset, length) {
  const FNV_OFFSET = 0xCBF29CE484222325n;
  const FNV_PRIME = 0x100000001B3n;
  const MASK = 0xFFFFFFFFn;
  let hash = FNV_OFFSET;
  for (let i = 0; i < length; i++) {
    hash = (hash ^ BigInt(data[offset + i])) & MASK;
    hash = (hash * FNV_PRIME) & MASK;
  }
  return hash;
}

const inputPath = process.argv[2] || 'D:\\SteamLibrary\\steamapps\\common\\Mafia II Definitive Edition\\pc\\sds\\sdsconfig.bin';
const outputPath = process.argv[3] || `${process.env.TEMP || '.'}\\sdsconfig_decrypted.bin`;

const data = readFileSync(inputPath);
console.log(`arquivo: ${inputPath} (${data.length} B)`);
console.log(`magic: ${data.subarray(0, 4).toString('latin1')}`);

// Validacao: bytes em 0x90..0x9E devem casar com FNV64("tables/fsfh.bin")
const FSFH_HASH = 0x39DD22E69C74EC6Fn;
const fsfh = data.subarray(0x90, 0x90 + 15);
console.log(`fsfh (0x90..0x9F): "${fsfh.toString('latin1')}"`);
const fsfhHash = fnv64(data, 0x90, 15);
console.log(`FNV64(fsfh) = 0x${fsfhHash.toString(16)}  (esperado 0x${FSFH_HASH.toString(16)})`);
if (fsfhHash !== FSFH_HASH) {
  console.error('ERRO: bytes em 0x90 nao sao "tables/fsfh.bin". SDS nao esta cifrado com este algoritmo.');
  process.exit(1);
}

// Header cifrado a partir de 0x10000
const encHeader = data.subarray(0x10000, 0x10000 + 16);
console.log(`encrypted header (0x10000..0x10010): ${[...encHeader].map(x => x.toString(16).padStart(2, '0')).join(' ')}`);

// Tenta cada setting
let success = false;
for (const setting of SETTINGS) {
  const hdrTest = Buffer.from(encHeader);
  teaDecrypt(hdrTest, 0, 16, KEY, setting.sum, setting.delta, setting.rounds);
  const magicLE = hdrTest.readUInt32LE(0);
  const magicBE = hdrTest.readUInt32BE(0);
  const hashLE = hdrTest.readUInt32LE(12);
  const hashBE = hdrTest.readUInt32BE(12);
  const fnvHash = fnv32(hdrTest, 0, 12);
  console.log(`\nsettings (sum=0x${setting.sum.toString(16)}, delta=0x${setting.delta.toString(16)}, rounds=${setting.rounds}):`);
  console.log(`  decrypted header: ${[...hdrTest].map(x => x.toString(16).padStart(2, '0')).join(' ')}`);
  console.log(`  magic (LE) = 0x${magicLE.toString(16)}  (BE) = 0x${magicBE.toString(16)}  (esperado 0x53445300 = 'SDS\\0')`);
  console.log(`  hash (LE) = 0x${hashLE.toString(16)}  (BE) = 0x${hashBE.toString(16)}  FNV32 = 0x${fnvHash.toString(16)}`);

  if (magicBE === 0x53445300 && hashBE === fnvHash) {
    console.log(`  >>> MATCH! Decifrando arquivo completo com este setting...`);
    const out = Buffer.from(data);
    teaDecrypt(out, 0x10000, data.length - 0x10000, KEY, setting.sum, setting.delta, setting.rounds);
    writeFileSync(outputPath, out);
    console.log(`  >> sdsconfig_decrypted.bin salvo em ${outputPath} (${out.length} B)`);
    // Tenta interpretar como texto
    const txt = out.toString('latin1', 0x10000, Math.min(out.length, 0x10000 + 4096)).replace(/[^\x20-\x7e\n\r\t]/g, '.');
    console.log(`\n  >> primeiros 4 KB apos decifragem:`);
    console.log(`  ${txt.slice(0, 2000)}`);
    success = true;
    break;
  } else if (magicLE === 0x53445300 && hashLE === fnvHash) {
    console.log(`  >>> MATCH (LE)! Decifrando...`);
    const out = Buffer.from(data);
    teaDecrypt(out, 0x10000, data.length - 0x10000, KEY, setting.sum, setting.delta, setting.rounds);
    writeFileSync(outputPath, out);
    console.log(`  >> sdsconfig_decrypted.bin salvo em ${outputPath}`);
    success = true;
    break;
  }
}

if (!success) {
  console.log('\nNenhum setting decifrou. O arquivo pode estar em outro formato.');
}
