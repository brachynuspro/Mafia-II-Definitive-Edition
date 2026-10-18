// varredura-binaria.mjs - conta ocorrencias de uma lista de strings num binario PE/SDS/FSB
// uso: node varredura-binaria.mjs <arquivo> <string1> [string2 ...]
import { readFileSync } from 'node:fs';

const path = process.argv[2];
const keys = process.argv.slice(3);
const buf = readFileSync(path);

console.log(`arquivo: ${path}`);
console.log(`tamanho: ${buf.length} bytes`);
console.log('');

for (const key of keys) {
  const enc = Buffer.from(key, 'latin1');
  let count = 0;
  let first = -1;
  let pos = 0;
  while ((pos = buf.indexOf(enc, pos)) !== -1) { count++; if (first < 0) first = pos; pos++; }
  console.log(`  ${key.padEnd(24)} ascii8: count=${count}${first>=0?` first=0x${first.toString(16)}`:''}`);

  // tambem procura em UTF-16LE (strings .NET costumam estar wide)
  const wide = Buffer.alloc(key.length * 2);
  for (let i = 0; i < key.length; i++) wide[i*2] = key.charCodeAt(i) & 0xff;
  let wcount = 0; let wfirst = -1; let wpos = 0;
  while ((wpos = buf.indexOf(wide, wpos)) !== -1) { wcount++; if (wfirst < 0) wfirst = wpos; wpos += 2; }
  console.log(`  ${key.padEnd(24)} utf16: count=${wcount}${wfirst>=0?` first=0x${wfirst.toString(16)}`:''}`);
}
