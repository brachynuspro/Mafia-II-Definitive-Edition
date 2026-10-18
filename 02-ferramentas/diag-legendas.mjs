// Diagnostico: em quantos .sds existe tabela de legendas e em que estado?
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.toLowerCase().endsWith('.sds')) out.push(p);
  }
  return out;
}
const MARK = Buffer.from('/tables/Speech/', 'latin1');
const BOM = Buffer.from([0xef, 0xbb, 0xbf]);
const roots = process.argv.slice(2);
const files = roots.flatMap(r => { try { return walk(r); } catch { return []; } });

let comMark = 0, comBOM = 0, soMarcador = 0, naoLegendado = 0;
const exemplos = [];
for (const f of files) {
  let buf; try { buf = readFileSync(f); } catch { continue; }
  const p = buf.indexOf(MARK);
  if (p === -1) { naoLegendado++; continue; }
  comMark++;
  const end = buf.indexOf(0x00, p);
  const bom = buf.indexOf(BOM, end);
  if (bom !== -1 && bom < end + 64) { comBOM++; if (exemplos.length < 3) exemplos.push(f + ' (legenda em texto puro)'); }
  else if (exemplos.length < 6) exemplos.push(f + ' (legenda COMPRIMIDA/ofuscada)');
}
console.log(`arquivos varridos        : ${files.length}`);
console.log(`sem marcador de legenda  : ${naoLegendado}`);
console.log(`com /tables/Speech/      : ${comMark}`);
console.log(`  legendas em texto puro : ${comBOM}`);
console.log(`  legendas comprimidas   : ${comMark - comBOM}`);
console.log('\namostras:'); exemplos.forEach(e => console.log('  ' + e));