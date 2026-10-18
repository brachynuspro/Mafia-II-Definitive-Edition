// Limpa o indice de bancos: extrai o slot_id puro do caminho e consolida por slot
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const IN = process.argv[2];
const OUT = process.argv[3];
const rows = readFileSync(IN, 'utf8').replace(/^\ufeff/, '').split('\n').slice(1)
  .map(l => { const c = []; let cur = '', q = false; for (let i = 0; i < l.length; i++) { const ch = l[i]; if (ch === '"') { if (q && l[i + 1] === '"') { cur += '"'; i++; } else q = !q; } else if (ch === ';' && !q) { c.push(cur); cur = ''; } else cur += ch; } c.push(cur); return c; });

const map = new Map();
let dup = 0;
for (const r of rows) {
  const [sds, idx, pth] = r;
  if (!sds) continue;
  const m = /(\d{2}_\d{2}_\d{2}_\d{3,6})/.exec(pth || '');
  const slot = m ? m[1] : '';
  if (!slot) continue;
  if (map.has(slot)) dup++; else map.set(slot, { sds, idx, slot, dataSize: r[9] });
}
const cols = ['slot', 'sds', 'idx', 'dataSize'];
writeFileSync(join(OUT, 'bancos-voz-limpo.csv'), '\ufeff' + [cols.join(';')]
  .concat([...map.values()].map(o => cols.map(c => `"${o[c] ?? ''}"`).join(';'))).join('\n'), 'utf8');

const byFolder = new Map();
for (const v of map.values()) { const s = v.sds.split('\\')[0]; byFolder.set(s, (byFolder.get(s) || 0) + 1); }
const sizes = [...map.values()].map(v => +v.dataSize || 0);
const tot = sizes.reduce((a, b) => a + b, 0);
console.log(`bancos com slot legivel : ${map.size}  (duplicados ignorados: ${dup})`);
console.log(`total de audio          : ${(tot / 1024 / 1024).toFixed(1)} MB`);
console.log(`tamanho medio por fala   : ${Math.round(tot / map.size / 1024)} KB`);
console.log('\n=== por subpasta ===');
for (const [k, v] of [...byFolder].sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(6)}  ${k}`);
console.log('\n=== amostra de slots ===');
[...map.keys()].slice(0, 8).forEach(k => console.log('  ' + k));