// converter-fsb5.mjs - converte todos os FSB5 em wav-fsb5 para WAV usando Fsb5ToWav
// output em 04-export/wav/
import { readdirSync, statSync, mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { join, dirname, relative, basename, extname } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.argv[2] || 'D:\\SteamLibrary\\steamapps\\common\\Mafia II Definitive Edition';
const fsb5Root = process.argv[3] || join(root, 'DublagemIA', '04-export', 'wav-fsb5');
const wavRoot = process.argv[4] || join(root, 'DublagemIA', '04-export', 'wav');
const exe = process.argv[5] || join(root, 'DublagemIA', '06-fmod', 'Fsb5ToWav', 'bin', 'Release', 'net8.0', 'Fsb5ToWav.exe');

if (!existsSync(exe)) {
  console.error('nao achei: ' + exe);
  process.exit(1);
}

const logPath = join(wavRoot, '_conversao.log');
mkdirSync(wavRoot, { recursive: true });

// lista todos os FSB5
const all = [];
function walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.fsb5')) all.push(p);
  }
}
walk(fsb5Root);
console.log('FSB5 files: ' + all.length);

const t0 = Date.now();
let ok = 0, fail = 0, skipped = 0;
for (let i = 0; i < all.length; i++) {
  const fsb5 = all[i];
  const rel = relative(fsb5Root, fsb5);
  const wavName = rel.replace(/\.fsb5$/, '.wav').replace(/[\\/]/g, '__');
  const wavOut = join(wavRoot, wavName);
  if (existsSync(wavOut)) { skipped++; continue; }
  const r = spawnSync(exe, [fsb5, wavOut], { encoding: 'utf8', timeout: 15000 });
  if (r.status === 0) {
    ok++;
  } else {
    fail++;
  }
  if ((i + 1) % 50 === 0) {
    const dt = (Date.now() - t0) / 1000;
    console.log(`[${i+1}/${all.length}] ok=${ok} fail=${fail} skip=${skipped} dt=${dt.toFixed(0)}s`);
  }
}
const dt = (Date.now() - t0) / 1000;
console.log(`TOTAL: ok=${ok} fail=${fail} skip=${skipped} dt=${dt.toFixed(0)}s`);
console.log(`saida: ${wavRoot}`);
