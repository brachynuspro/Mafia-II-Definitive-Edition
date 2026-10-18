#!/usr/bin/env node
// mesclar-traducoes.mjs
// Lê voice-map.csv e traducoes-pt.csv e junta a coluna texto_pt no voice-map.
//
// Chave de junção:
//   voice-map.wav_basename   = "fmv0303_d_Dabing_Script_03_05_03_99_04_0010.wav"
//   traducoes.sds + slot     = "fmv\fmv0303_d.sds" + "03_05_03_99_04_0010"
//
// O voice-map tem prefixo "<sds>_<dir>_" (e.g. fmv0303_d_, demo05_, apdcivblack_)
// seguido por "Dabing_Script_XX_YY_ZZ_...". O sds prefixo casa exatamente com
// o nome do .sds nos legendas.
//
// Saída: voice-map.csv (sobrescrito) com nova coluna texto_pt no final.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = String.raw`D:\SteamLibrary\steamapps\common\Mafia II Definitive Edition`;
const VMAP = join(ROOT, 'DublagemIA', '04-export', 'voice-map.csv');
const TRAD = join(ROOT, 'DublagemIA', '04-export', 'traducoes-pt.csv');

function parseCsvLine(line, delim = ',') {
  const out = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQ && line[i+1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if (c === delim && !inQ) {
      out.push(cur); cur = '';
    } else cur += c;
  }
  out.push(cur);
  return out;
}

function csvEscape(s, delim = ',') {
  s = String(s ?? '');
  if (s.includes('"') || s.includes(delim) || s.includes('\n') || s.includes('\r')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

// --- carregar traducoes ---
if (!existsSync(TRAD)) {
  console.error(`[FATAL] não achei ${TRAD} — rode traduzir-legendas.py antes.`);
  process.exit(1);
}
const tradLines = readFileSync(TRAD, 'utf8').split(/\r?\n/).filter(l => l.trim());
const tradHeader = parseCsvLine(tradLines[0], ';');
const tradIx = {
  sds: tradHeader.indexOf('sds'),
  slot: tradHeader.indexOf('slot'),
  pt: tradHeader.indexOf('texto_pt'),
};
if (tradIx.sds < 0 || tradIx.slot < 0 || tradIx.pt < 0) {
  console.error(`[FATAL] traducoes-pt.csv sem colunas esperadas. Header:`, tradHeader);
  process.exit(1);
}
const tradByKey = new Map();
let tradVazias = 0;
for (let i = 1; i < tradLines.length; i++) {
  const f = parseCsvLine(tradLines[i], ';');
  const sds = f[tradIx.sds];
  const slot = f[tradIx.slot];
  const pt = f[tradIx.pt];
  if (!sds || !slot) continue;
  // normaliza sds: "fmv\fmv0303_d.sds" -> "fmv0303_d.sds"; "..\..\demo05.sds" -> "demo05.sds"
  const sdsBase = sds.split(/[\\/]/).pop();
  if (!pt) tradVazias++;
  tradByKey.set(`${sdsBase}|${slot}`, pt);
}
console.log(`[INFO] traducoes-pt: ${tradLines.length-1} linhas, ${tradByKey.size} únicas, ${tradVazias} vazias`);

// --- carregar voice-map ---
if (!existsSync(VMAP)) {
  console.error(`[FATAL] não achei ${VMAP}`);
  process.exit(1);
}
const vmapLines = readFileSync(VMAP, 'utf8').split(/\r?\n/).filter(l => l.trim());
const vmapHeader = parseCsvLine(vmapLines[0], ',');
console.log(`[INFO] voice-map header:`, vmapHeader);
const ixWav = vmapHeader.indexOf('wav_basename');
const ixName = vmapHeader.indexOf('name');
if (ixWav < 0 || ixName < 0) {
  console.error(`[FATAL] voice-map sem colunas esperadas.`);
  process.exit(1);
}

// Adiciona coluna texto_pt se ainda não existe
let ixPt = vmapHeader.indexOf('texto_pt');
if (ixPt < 0) {
  vmapHeader.push('texto_pt');
  ixPt = vmapHeader.length - 1;
}

let matched = 0, vazios = 0, semKey = 0;
const out = [vmapHeader.map(h => csvEscape(h)).join(',')];
for (let i = 1; i < vmapLines.length; i++) {
  const f = parseCsvLine(vmapLines[i], ',');
  while (f.length < vmapHeader.length - 1) f.push('');  // expand se texto_pt não existia
  const wav = f[ixWav];
  const name = f[ixName];
  // extrai slot do name (formato limpo Dabing/<cat>/<...>/<slot>)
  //   Script:    Dabing/Script/<missao>/<cap>/<slot>          → parts[4]
  //   Cutscenes: Dabing/Cutscenes/<fmv>/<slot>                → parts[3]
  //   Generic:   Dabing/Generic/<char>/<sub>/<slot>           → parts[4]
  let slot = '';
  if (name && name.startsWith('Dabing/')) {
    const parts = name.split('/');
    if (parts[1] === 'Script' && parts.length >= 5) slot = parts[4];
    else if (parts[1] === 'Cutscenes' && parts.length >= 4) slot = parts[3];
    else if (parts[1] === 'Generic' && parts.length >= 5) slot = parts[4];
  }
  // sds prefixo: do wav_basename — tudo antes de "_Dabing_"
  const m = wav.match(/^(.+?)_Dabing_/);
  if (!m) { semKey++; f[ixPt] = ''; out.push(f.map(csvEscape).join(',')); continue; }
  const sdsPrefix = m[1];
  // Os sds têm nomes como "fmv0303_d.sds", "demo05.sds", "apdcivblack_a1.sds"
  // O prefixo do wav pode incluir sufixo tipo "_d" que o nome do sds já tem.
  // Tentativa 1: match exato "<prefix>.sds"
  // Tentativa 2: match prefixo
  let pt = '';
  for (const [k, v] of tradByKey) {
    const sdsName = k.split('|')[0];
    if (sdsName === sdsPrefix + '.sds' || sdsName === sdsPrefix) {
      if (k.split('|')[1] === slot) { pt = v; break; }
    }
  }
  // Fallback: tentar casar pelo prefixo sdsName.startsWith(sdsPrefix)
  if (!pt) {
    for (const [k, v] of tradByKey) {
      const sdsName = k.split('|')[0].replace(/\.sds$/, '');
      if (sdsName === sdsPrefix) {
        if (k.split('|')[1] === slot) { pt = v; break; }
      }
    }
  }
  if (pt) matched++;
  else if (tradByKey.size > 0) vazios++;
  f[ixPt] = pt;
  out.push(f.map(csvEscape).join(','));
}

writeFileSync(VMAP, out.join('\n'), 'utf8');
console.log(`[OK] voice-map.csv atualizado: ${matched} matched, ${vazios} sem tradução, ${semKey} sem key`);
console.log(`[OK] traducoes-pt tem ${tradByKey.size} entradas; voice-map tem ${vmapLines.length-1} linhas`);
