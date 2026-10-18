// Hex view of chosen regions - empirico, sem assumir layout
import { readFileSync } from 'node:fs';
const buf = readFileSync(process.argv[2]);
const regions = process.argv.slice(3).map(Number);
function dump(start, len) {
  console.log(`\n----- 0x${start.toString(16)} .. 0x${(start + len).toString(16)} -----`);
  for (let i = 0; i < len; i += 16) {
    const s = start + i;
    const chunk = buf.subarray(s, Math.min(s + 16, start + len));
    const hex = [...chunk].map(b => b.toString(16).padStart(2, '0')).join(' ');
    const asc = [...chunk].map(b => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '.')).join('');
    console.log(`0x${s.toString(16).padStart(6, '0')}  ${hex.padEnd(47)}  |${asc}|`);
  }
}
for (const r of regions) dump(r, 0x100);