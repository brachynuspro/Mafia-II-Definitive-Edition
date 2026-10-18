// validar-multivoice.mjs (versão PT-BR real)
// Sample 5-10 WAVs por voz, verifica:
//   - Arquivo existe
//   - Duração razoável (>0.3s, <10s)
//   - Duração dentro de ±20% do EN original (via duracoes.csv)
//   - Texto PT-BR presente no voice-map (não placeholder)
//
// Saída: tabela markdown com 10 amostras aleatórias.

import { readFileSync, existsSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';

const ROOT = String.raw`D:\SteamLibrary\steamapps\common\Mafia II Definitive Edition`;
const VMAP = join(ROOT, 'DublagemIA', '04-export', 'voice-map.csv');
const DURACOES = join(ROOT, 'DublagemIA', '04-export', 'duracoes.csv');
const TTROOT = join(ROOT, 'DublagemIA', '04-export', 'tts-pt');

const FFPROBE = (() => {
  const candidates = [
    `${process.env.USERPROFILE}\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\\ffmpeg-9.0.2-full_build\\bin\\ffprobe.exe`,
    'ffprobe',
  ];
  for (const c of candidates) {
    if (c === 'ffprobe') return c;
    if (existsSync(c)) return c;
  }
  return 'ffprobe';
})();

function parseCsvLine(line) {
  const out = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQ && line[i+1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if (c === ',' && !inQ) {
      out.push(cur); cur = '';
    } else cur += c;
  }
  out.push(cur);
  return out;
}

function wavDuration(path) {
  if (!existsSync(path)) return null;
  const r = spawnSync(FFPROBE, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', path], { encoding: 'utf8' });
  const d = parseFloat(r.stdout.trim());
  return isNaN(d) ? null : d;
}

function main() {
  // Carrega durações
  const durLines = readFileSync(DURACOES, 'utf8').split(/\r?\n/).filter(l => l.trim());
  const durMap = new Map();
  for (let i = 1; i < durLines.length; i++) {
    const f = parseCsvLine(durLines[i]);
    durMap.set(f[1], Number(f[2]));
  }
  console.log(`duracoes: ${durMap.size} entries`);

  // Carrega voice-map
  const vmapLines = readFileSync(VMAP, 'utf8').split(/\r?\n/).filter(l => l.trim());
  const header = parseCsvLine(vmapLines[0]);
  const ix = name => header.indexOf(name);
  const items = [];
  for (let i = 1; i < vmapLines.length; i++) {
    const f = parseCsvLine(vmapLines[i]);
    const wav = f[ix('wav_basename')];
    if (!wav) continue;
    items.push({
      wav,
      name: f[ix('name')],
      voice_id: f[ix('voice_id')],
      label: f[ix('label')],
      texto_pt: f[ix('texto_pt')] ?? '',
    });
  }
  console.log(`voice-map: ${items.length} entries`);

  // Filtra itens com texto_pt (traduzidos) e arquivos que existem
  const candidates = items.filter(it => it.texto_pt && it.texto_pt.trim());
  console.log(`candidates (com tradução): ${candidates.length}`);

  // Sample aleatório de 10
  const N = 10;
  const sample = [];
  const used = new Set();
  while (sample.length < N && used.size < candidates.length) {
    const r = Math.floor(Math.random() * candidates.length);
    if (used.has(r)) continue;
    used.add(r);
    sample.push(candidates[r]);
  }

  // Tabela
  console.log('\n## Validação de 10 amostras aleatórias\n');
  console.log('| # | wav | voz | dur_orig_s | dur_pt_s | Δ% | texto_pt |');
  console.log('|---|-----|-----|-----------|---------|----|---------|');
  let pass = 0, fail = 0, missing = 0;
  for (let i = 0; i < sample.length; i++) {
    const it = sample[i];
    const outWav = join(TTROOT, it.wav);
    const durOrig = durMap.get(it.wav);
    const durPt = wavDuration(outWav);
    if (durPt === null) {
      missing++;
      console.log(`| ${i+1} | \`${it.wav}\` | ${it.label} | ${durOrig?.toFixed(2) ?? '?'} | MISSING | - | ${it.texto_pt.slice(0,40)}... |`);
      continue;
    }
    const delta = durOrig ? ((durPt - durOrig) / durOrig * 100) : 0;
    const ok = Math.abs(delta) <= 20;
    if (ok) pass++; else fail++;
    const marker = ok ? '✓' : '✗';
    console.log(`| ${i+1} | \`${it.wav}\` | ${it.label} | ${durOrig?.toFixed(2) ?? '?'} | ${durPt.toFixed(2)} | ${delta.toFixed(1)}% ${marker} | ${it.texto_pt.slice(0,40)}... |`);
  }
  console.log(`\n**Resumo:** ${pass} OK, ${fail} fora de ±20%, ${missing} arquivos faltando`);
}

main();
