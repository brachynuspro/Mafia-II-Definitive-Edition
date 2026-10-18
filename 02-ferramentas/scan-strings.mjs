// Procura strings de chave de registro / porta MCP dentro dos DLLs
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2];
const patterns = [
  /Software\\[A-Za-z0-9_.\\ -]{3,60}/gi,
  /M2DE[A-Za-z_]{0,20}/g,
  /localhost:\d{2,5}/g,
  /127\.0\.0\.1:\d{2,5}/g,
  /\/mcp\b/g,
  /ApplicationData[\\/][A-Za-z0-9_.\\ -]{3,50}/gi,
];

const targets = readdirSync(dir).filter(f => /\.(dll|exe|json|config|xml)$/i.test(f));
for (const f of targets) {
  const buf = readFileSync(join(dir, f));
  const txt = buf.toString('utf16le') + '\n' + buf.toString('latin1');
  const hits = new Set();
  for (const re of patterns) {
    for (const m of txt.matchAll(re)) hits.add(m[0].replace(/[\x00-\x1f]+/g, '').trim());
  }
  if (hits.size) {
    console.log(`\n### ${f}`);
    [...hits].slice(0, 25).forEach(h => console.log('   ' + h));
  }
}