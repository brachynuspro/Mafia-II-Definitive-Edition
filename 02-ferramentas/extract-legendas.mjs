// Extrai as tabelas de legenda (*_subtitles.bin) embutidas nos .sds do jogo.
// Heuristico: localiza o marcador "/tables/Speech/", acha o BOM UTF-8 e le
// texto UTF-8 valido ate o primeiro byte nao-textual.
// Formato da linha: <slot_id>:<personagem>:<texto>
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';

const OUT = process.argv[2];
const roots = process.argv.slice(3);
mkdirSync(OUT, { recursive: true });

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

function isTextByte(b) {
  return (b >= 0x20 && b < 0x7f) || b === 0x09 || b === 0x0a || b === 0x0d || b >= 0xc2;
}

const rows = [];
const files = roots.flatMap((r) => { try { return walk(r); } catch { return []; } });
console.log(`arquivos .sds a varrer: ${files.length}`);
let done = 0;

for (const f of files) {
  let buf;
  try { buf = readFileSync(f); } catch { continue; }
  let pos = 0;
  while ((pos = buf.indexOf(MARK, pos)) !== -1) {
    // nome do recurso = do inicio da string ate o terminador
    let nameStart = pos;
    while (nameStart > 0 && buf[nameStart - 1] !== 0x00) nameStart--;
    const nameEnd = buf.indexOf(0x00, pos);
    const resource = buf.toString('latin1', nameStart, nameEnd);
    // procura o BOM depois do nome
    const bom = buf.indexOf(BOM, nameEnd);
    if (bom === -1 || bom > nameEnd + 64) { pos = pos + MARK.length; continue; }
    // le texto ate byte nao-textual
    let i = bom + 3;
    const start = i;
    while (i < buf.length && isTextByte(buf[i])) i++;
    const text = buf.toString('utf8', start, i);
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line) continue;
      const m = /^(\d{2}_\d{2}_\d{2}_\d{4,6}):([^:]*):(.*)$/.exec(line);
      if (m) rows.push({ arquivo: basename(f), recurso: resource, slot: m[1], personagem: m[2], texto: m[3] });
    }
    pos = i;
  }
  done++;
}

const cols = ['arquivo', 'recurso', 'slot', 'personagem', 'texto'];
const csv = [cols.join(';')]
  .concat(rows.map(r => cols.map(c => `"${String(r[c]).replace(/"/g, '""')}"`).join(';')))
  .join('\n');
const outFile = join(OUT, 'falas-originais.csv');
writeFileSync(outFile, '\ufeff' + csv, 'utf8');

const uniq = new Set(rows.map(r => r.slot));
const chars = new Map();
for (const r of rows) if (r.personagem) chars.set(r.personagem, (chars.get(r.personagem) || 0) + 1);

console.log(`arquivos varridos : ${done}`);
console.log(`linhas de fala    : ${rows.length}`);
console.log(`slots unicos      : ${uniq.size}`);
console.log(`personagens       : ${chars.size}`);
console.log(`saida             : ${outFile}`);
console.log('\n=== top 25 personagens ===');
[...chars.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25)
  .forEach(([k, v]) => console.log(`  ${String(v).padStart(6)}  ${k}`));