// extrair-strings.mjs - extrai todas as strings ASCII imprimiveis de um binario com offset
// uso: node extrair-strings.mjs <arquivo> [minlen] [maxlen]
import { readFileSync } from 'node:fs';

const path = process.argv[2];
const minLen = Number(process.argv[3] || 6);
const maxLen = Number(process.argv[4] || 200);
const filter = process.argv[5] ? new RegExp(process.argv[5], 'i') : null;

const buf = readFileSync(path);
let cur = '';
let start = 0;
const out = [];
for (let i = 0; i < buf.length; i++) {
  const c = buf[i];
  if (c >= 0x20 && c < 0x7f) {
    if (!cur) start = i;
    cur += String.fromCharCode(c);
  } else if (c === 0) {
    if (cur.length >= minLen) out.push([start, cur]);
    cur = '';
  } else {
    if (cur.length >= minLen) out.push([start, cur]);
    cur = '';
  }
}
const filtered = filter ? out.filter(([,s]) => filter.test(s)) : out;
console.log(`total strings >= ${minLen}: ${out.length}${filter ? `, casando filtro: ${filtered.length}` : ''}`);
for (const [off, s] of (filter ? filtered : out).slice(0, 2000)) {
  if (s.length > maxLen) continue;
  console.log(`0x${off.toString(16).padStart(8,'0')}  ${s.length.toString().padStart(4)}  ${s}`);
}
