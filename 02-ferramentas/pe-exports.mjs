// Le a tabela de export de uma DLL PE e lista os nomes/ordinais
import { readFileSync } from 'node:fs';
const b = readFileSync(process.argv[2]);
const e_lfanew = b.readUInt32LE(0x3c);
const pe = e_lfanew;
const numSections = b.readUInt16LE(pe + 6);
const optSize = b.readUInt16LE(pe + 20);
const opt = pe + 24;
const magic = b.readUInt16LE(opt);
const pe32plus = magic === 0x20b;
const exportRva = pe32plus ? b.readUInt32LE(opt + 112) : b.readUInt32LE(opt + 96);
const secStart = opt + optSize;
const secs = [];
for (let i = 0; i < numSections; i++) {
  const o = secStart + i * 40;
  secs.push({ va: b.readUInt32LE(o + 12), vsz: b.readUInt32LE(o + 8), raw: b.readUInt32LE(o + 20), rsz: b.readUInt32LE(o + 16) });
}
const rva2off = (rva) => {
  for (const s of secs) if (rva >= s.va && rva < s.va + Math.max(s.vsz, s.rsz)) return s.raw + (rva - s.va);
  return -1;
};
if (!exportRva) { console.log('sem diretorio de export'); process.exit(0); }
const eo = rva2off(exportRva);
const numNames = b.readUInt32LE(eo + 24);
const namesRva = b.readUInt32LE(eo + 32);
const ordinalsRva = b.readUInt32LE(eo + 36);
const no = rva2off(namesRva), oo = rva2off(ordinalsRva);
console.log(`${process.argv[2]}: ${numNames} exports por nome`);
const want = process.argv[3] ? new RegExp(process.argv[3]) : /^FMOD_[A-Z]/;
let shown = 0;
for (let i = 0; i < numNames; i++) {
  const nptr = b.readUInt32LE(no + i * 4);
  const noff = rva2off(nptr);
  let e = noff; while (b[e] !== 0) e++;
  const name = b.toString('latin1', noff, e);
  if (want.test(name) && shown < 60) { console.log(`  ${String(b.readUInt16LE(oo + i * 2)).padStart(6)}  ${name}`); shown++; }
}
console.log(`total exports: ${numNames}, casaram: ${shown}`);
if (shown === 0) { console.log('nenhum export com "FMOD" no nome; mostrando os 40 primeiros:'); for (let i = 0; i < Math.min(40, numNames); i++) { const nptr = b.readUInt32LE(no + i * 4); const noff = rva2off(nptr); let e = noff; while (b[e] !== 0) e++; console.log(`  ${String(b.readUInt16LE(oo + i * 2)).padStart(6)}  ${b.toString('latin1', noff, e)}`); } }