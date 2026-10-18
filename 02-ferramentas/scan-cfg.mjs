// Varre strings UTF-16 e Latin1 procurando termos de configuracao
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
const dir = process.argv[2];
const terms = /Software\\|Greaves|M2DE|SelectedGame|GameDirectory|CurrentUser|Registry|HKEY|\.xml|Settings/i;
for (const f of readdirSync(dir).filter(x => /\.(dll|exe)$/i.test(x))) {
  const b = readFileSync(join(dir, f));
  const u = b.toString('utf16le');
  const l = b.toString('latin1');
  const found = new Set();
  for (const m of u.matchAll(/[\x20-\x7e]{6,80}/g)) if (terms.test(m[0])) found.add(m[0]);
  for (const m of l.matchAll(/[\x20-\x7e]{6,80}/g)) if (terms.test(m[0])) found.add(m[0]);
  if (found.size) {
    console.log(`\n### ${f}  (${found.size})`);
    [...found].sort().slice(0, 40).forEach(s => console.log('   ' + s));
  }
}