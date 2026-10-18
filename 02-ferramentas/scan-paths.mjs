// Procura padroes de caminho esperados na validacao de pasta do jogo
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
const dir = process.argv[2];
const want = /pc[\\/]|sds[\\/]|Mafia2Launcher|\\.exe|Executable|Correct executable/i;
for (const f of readdirSync(dir).filter(x => /\.(dll|exe)$/i.test(x))) {
  const b = readFileSync(join(dir, f));
  const hits = new Set();
  for (const enc of ['utf16le', 'latin1']) {
    const t = b.toString(enc);
    for (const m of t.matchAll(/[\x20-\x7e]{5,90}/g)) {
      if (want.test(m[0]) && /pc|exe|sds|Executable/i.test(m[0])) hits.add(m[0]);
    }
  }
  if (hits.size) {
    console.log(`\n### ${f}  (${hits.size})`);
    [...hits].sort().slice(0, 45).forEach(s => console.log('   ' + s));
  }
}