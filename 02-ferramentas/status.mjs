// status.mjs - gera relatorio de status em 04-export/_status.txt
import { readFileSync, writeFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
const root = process.argv[2] || 'D:\\SteamLibrary\\steamapps\\common\\Mafia II Definitive Edition';
const out = process.argv[3] || join(root, 'DublagemIA', '04-export', '_status.txt');
const fsb5Root = join(root, 'DublagemIA', '04-export', 'wav-fsb5');
const logPath = join(fsb5Root, '_extracao.csv');
const manifestoPath = join(root, 'DublagemIA', '04-export', 'manifesto-final.csv');

const lines = [];
const ts = new Date().toISOString();
lines.push('# Status extracao — ' + ts);
lines.push('');

// conta FSB5 por categoria (sem listar tudo)
const cats = { script_sounds: 0, speech: 0, speech_shops: 0, fmv: 0, script: 0, other: 0 };
let totalFsb5 = 0;
for (const c of readdirSync(fsb5Root, { withFileTypes: true })) {
  if (!c.isDirectory()) continue;
  const c2 = join(fsb5Root, c.name);
  let n = 0;
  try { n = readdirSync(c2, { recursive: true, withFileTypes: true }).filter(e => e.isFile() && e.name.endsWith('.fsb5')).length; } catch {}
  cats[c.name] = (cats[c.name] || 0);
  // melhor: contar recursivo abaixo
}
function countFsb5(dir) {
  let n = 0;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) n += countFsb5(p);
    else if (e.name.endsWith('.fsb5')) n++;
  }
  return n;
}
const catCounts = {};
for (const c of readdirSync(fsb5Root, { withFileTypes: true })) {
  if (!c.isDirectory()) continue;
  catCounts[c.name] = countFsb5(join(fsb5Root, c.name));
}
totalFsb5 = Object.values(catCounts).reduce((a, b) => a + b, 0);
lines.push('## FSB5 extraidos: ' + totalFsb5);
for (const [k, v] of Object.entries(catCounts).sort()) lines.push('  - ' + k + ': ' + v);
lines.push('');

if (existsSync(logPath)) {
  const sz = statSync(logPath).size;
  let lastLine = '';
  const fd = readFileSync(logPath, 'utf8');
  const arr = fd.split('\n');
  // pega o ultimo bloco TOTAL
  for (let i = arr.length - 1; i >= 0; i--) {
    if (arr[i].startsWith('TOTAL:')) { lastLine = arr[i]; break; }
  }
  lines.push('## Log: ' + logPath);
  lines.push('  size: ' + sz + ' B  lines: ' + arr.length);
  if (lastLine) lines.push('  last TOTAL: ' + lastLine);
  lines.push('');
}

if (existsSync(manifestoPath)) {
  const sz = statSync(manifestoPath).size;
  const txt = readFileSync(manifestoPath, 'utf8');
  const rows = txt.split('\n').filter(l => l.trim());
  const ok = rows.filter(l => l.includes('"en"')).length;
  const miss = rows.filter(l => l.includes('missing')).length;
  lines.push('## Manifesto: ' + manifestoPath);
  lines.push('  size: ' + sz + ' B  rows: ' + rows.length);
  lines.push('  matched: ' + ok + '  missing: ' + miss + '  match%: ' + (rows.length > 0 ? (ok / (rows.length - 1) * 100).toFixed(1) : '0'));
  // agrupa missing por SDS
  const groups = new Map();
  for (const l of rows) {
    if (!l.includes('missing')) continue;
    const sds = l.split('","')[0].replace(/^"/, '');
    groups.set(sds, (groups.get(sds) || 0) + 1);
  }
  if (groups.size) {
    lines.push('  missing por SDS (top 10):');
    const sorted = [...groups.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
    for (const [s, c] of sorted) lines.push('    ' + c + '\t' + s);
  }
}
writeFileSync(out, lines.join('\n'));
console.log('gravado: ' + out);
console.log('---');
console.log(lines.join('\n'));
