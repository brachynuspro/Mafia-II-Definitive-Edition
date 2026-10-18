// decifrar-psds-5.mjs - aplica NOT byte na string table do sdsconfig.bin
// Implementa exatamente SdsConfigFile.cs do Gibbed.Illusion
import { readFileSync, writeFileSync } from 'node:fs';

const cfg = readFileSync('D:\\SteamLibrary\\steamapps\\common\\Mafia II Definitive Edition\\pc\\sds\\sdsconfig.bin');
console.log(`sdsconfig.bin: ${cfg.length} B`);

// Header Gibbed SdsConfigFile:
//   u32 magic 'psds' LE
//   u32 version (2)
//   u32 stringTableSize
//   byte[stringTableSize] stringTable (NOT bitwise)
//   u16 unk0 (count de entries)
let p = 0;
const magic = cfg.readUInt32LE(p); p += 4;
console.log(`magic: 0x${magic.toString(16)} (esperado 0x73647370 'psds')`);
const version = cfg.readUInt32LE(p); p += 4;
console.log(`version: ${version}`);
const stringTableSize = cfg.readUInt32LE(p); p += 4;
console.log(`stringTableSize: ${stringTableSize} (0x${stringTableSize.toString(16)})`);
const strTblRaw = cfg.subarray(p, p + stringTableSize); p += stringTableSize;
const strTbl = Buffer.alloc(stringTableSize);
for (let i = 0; i < stringTableSize; i++) strTbl[i] = ~strTblRaw[i] & 0xFF;

console.log(`\nString table (decoded, ${stringTableSize} B):`);
const strs = strTbl.toString('latin1').split('\0').filter(s => s.length > 0);
for (let i = 0; i < strs.length; i++) {
  console.log(`  [${i.toString().padStart(4)}] "${strs[i]}"`);
}

// Parse unk0
const unk0 = cfg.readUInt16LE(p); p += 2;
console.log(`\nunk0 entries: ${unk0}`);

for (let i = 0; i < unk0; i++) {
  const unk1 = cfg.readUInt16LE(p); p += 2;
  const name1 = strs[unk1] || `<unk@${unk1}>`;
  console.log(`\nEntry ${i}: "${name1}"`);
  const unk2 = cfg.readUInt16LE(p); p += 2;
  console.log(`  unk2 (count): ${unk2}`);
  for (let j = 0; j < unk2; j++) {
    const unk3 = cfg.readUInt16LE(p); p += 2;
    const unk4 = cfg.readUInt16LE(p); p += 2;
    const unk5 = cfg.readUInt16LE(p); p += 2;
    const unk6 = cfg.readUInt16LE(p); p += 2;
    const unk7 = cfg.readUInt32LE(p); p += 4;
    const unk8 = cfg.readUInt32LE(p); p += 4;
    console.log(`    sub: "${strs[unk3] || `<unk@${unk3}>`}" unk4=${unk4} unk5=${unk5} unk6=${unk6} unk7=0x${unk7.toString(16)} unk8=0x${unk8.toString(16)}`);
  }
  const unk9 = cfg.readUInt16LE(p); p += 2;
  console.log(`  unk9: ${unk9}`);
  for (let k = 0; k < unk9; k++) {
    const unk10 = cfg.readUInt16LE(p); p += 2;
    const name3 = strs[unk10] || `<unk@${unk10}>`;
    const unk11 = cfg.readUInt32LE(p); p += 4;
    const unk12 = cfg.readUInt32LE(p); p += 4;
    console.log(`    script: "${name3}" unk11=0x${unk11.toString(16)} unk12=0x${unk12.toString(16)}`);
    const unk13 = cfg.readUInt16LE(p); p += 2;
    for (let l = 0; l < unk13; l++) {
      const unk14 = cfg.readUInt16LE(p); p += 2;
      const name4 = strs[unk14] || `<unk@${unk14}>`;
      const unk15 = cfg.readUInt32LE(p); p += 4;
      const unk16 = cfg.readUInt32LE(p); p += 4;
      const unk17 = cfg.readUInt8(p); p += 1;
      console.log(`      line: "${name4}" unk15=0x${unk15.toString(16)} unk16=0x${unk16.toString(16)} unk17=${unk17}`);
      const unk18 = cfg.readUInt16LE(p); p += 2;
      for (let m = 0; m < unk18; m++) {
        const unk19 = cfg.readUInt16LE(p); p += 2;
        const unk20 = cfg.readUInt16LE(p); p += 2;
        const unk21 = cfg.readUInt16LE(p); p += 2;
        const unk22 = cfg.readUInt16LE(p); p += 2;
        const unk23 = cfg.readUInt32LE(p); p += 4;
        const unk24 = cfg.readUInt32LE(p); p += 4;
        console.log(`        item: unk19=${unk19} unk20=${unk20} unk21=${unk21} unk22=${unk22} unk23=0x${unk23.toString(16)} unk24=0x${unk24.toString(16)}`);
      }
    }
  }
}
console.log(`\ntotal lido: ${p} B de ${cfg.length} B`);
