// validar-multivoice.mjs — valida qualidade do TTS multi-voice
import { readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';

const ROOT = String.raw`D:\SteamLibrary\steamapps\common\Mafia II Definitive Edition`;
const VMAP = `${ROOT}\\DublagemIA\\04-export\\voice-map.csv`;
const TTROOT = `${ROOT}\\DublagemIA\\04-export\\tts-pt`;
const DURACOES = `${ROOT}\\DublagemIA\\04-export\\duracoes.csv`;

function parseLine(line) {
  const out = []; let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { if (inQ && line[i+1] === '"') { cur += '"'; i++; } else inQ = !inQ; }
    else if (c === ',' && !inQ) { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur); return out;
}

function hash(b) { return createHash('sha1').update(b).digest('hex').substring(0, 8); }

// carrega voice-map
const vmLines = readFileSync(VMAP, 'utf8').split(/\r?\n/).filter(l => l.trim());
const header = parseLine(vmLines[0]);
const vix = n => header.indexOf(n);
const vmap = new Map();
for (let i = 1; i < vmLines.length; i++) {
  const f = parseLine(vmLines[i]);
  vmap.set(f[vix('wav_basename')], {
    label: f[vix('label')],
    voice_id: f[vix('voice_id')],
    gender: f[vix('gender')],
  });
}

// carrega duracoes
const durLines = readFileSync(DURACOES, 'utf8').split(/\r?\n/).filter(l => l.trim());
const durMap = new Map();
for (let i = 1; i < durLines.length; i++) {
  const f = parseLine(durLines[i]);
  durMap.set(f[1], { dur: Number(f[2]), rate: Number(f[4]) });
}

// Amostra por voz
const N = 5;
const samples = {};
for (const [wav, v] of vmap) {
  if (samples[v.label] === undefined) samples[v.label] = [];
  if (samples[v.label].length < N) samples[v.label].push(wav);
}

console.log('=== Amostras por voz ===');
for (const [label, list] of Object.entries(samples)) {
  console.log(`\n${label} (${list.length}):`);
  for (const wav of list) {
    const full = `${TTROOT}\\${wav}`;
    let info;
    try {
      const buf = readFileSync(full);
      const sz = buf.length;
      const h = hash(buf);
      const dur = durMap.get(wav);
      info = `size=${sz} sha1_8=${h}`;
    } catch (e) {
      info = `MISSING (${e.message})`;
    }
    console.log(`  ${wav.substring(0, 80).padEnd(80)}  ${info}`);
  }
}

// Total por voz
console.log('\n=== Cobertura por voz ===');
const stats = {};
for (const [wav, v] of vmap) {
  if (!stats[v.label]) stats[v.label] = { total: 0, done: 0, missing: 0 };
  stats[v.label].total++;
  try { statSync(`${TTROOT}\\${wav}`); stats[v.label].done++; } catch { stats[v.label].missing++; }
}
for (const [label, s] of Object.entries(stats)) {
  console.log(`  ${label.padEnd(20)} total=${s.total.toString().padStart(5)} done=${s.done.toString().padStart(5)} missing=${s.missing}`);
}

// Verifica arquivos femeas (Maria SAPI5) tem 115726 bytes (caracteristico)
console.log('\n=== Tam. Maria files ===');
const mariaFiles = [...vmap.entries()].filter(([_, v]) => v.label === 'V0_maria').map(([k]) => k);
let mCount = 0, mOther = 0;
for (const wav of mariaFiles.slice(0, 50)) {
  try {
    const sz = statSync(`${TTROOT}\\${wav}`).size;
    if (sz === 115726) mCount++;
    else mOther++;
  } catch { mOther++; }
}
console.log(`  Maria (sample 50): expected_size=115726  match=${mCount}  other=${mOther}`);

// Verifica arquivos Antonio tem tamanhos variados
console.log('\n=== Tam. Antonio files (variado) ===');
const antonioFiles = [...vmap.entries()].filter(([_, v]) => v.label.startsWith('V')).filter(([_, v]) => v.label !== 'V0_maria' && v.label !== 'V1_francisca').map(([k]) => k);
const sizes = new Map();
for (const wav of antonioFiles.slice(0, 500)) {
  try {
    const sz = statSync(`${TTROOT}\\${wav}`).size;
    sizes.set(sz, (sizes.get(sz) || 0) + 1);
  } catch {}
}
const sorted = [...sizes.entries()].sort((a, b) => b[1] - a[1]);
console.log('  Top 10 sizes:');
for (const [sz, cnt] of sorted.slice(0, 10)) console.log(`    ${sz.toString().padStart(8)} bytes: ${cnt} arquivos`);

console.log('\n=== Done ===');
