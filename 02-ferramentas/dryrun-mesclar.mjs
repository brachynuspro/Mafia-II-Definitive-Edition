// dryrun-mesclar.mjs — testa a junção sem escrever
import { readFileSync, existsSync } from 'node:fs';

const ROOT = String.raw`D:\SteamLibrary\steamapps\common\Mafia II Definitive Edition`;
const VMAP = ROOT + '\\DublagemIA\\04-export\\voice-map.csv';
const TRAD = ROOT + '\\DublagemIA\\04-export\\traducoes-pt.csv';

function parseCsvLine(line, delim = ',') {
  const out = []; let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQ && line[i+1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if (c === delim && !inQ) { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur); return out;
}

// Carrega traducoes
const tradLines = readFileSync(TRAD, 'utf8').split(/\r?\n/).filter(l => l.trim());
const tradHeader = parseCsvLine(tradLines[0], ';');
const tradIx = { sds: tradHeader.indexOf('sds'), slot: tradHeader.indexOf('slot'), pt: tradHeader.indexOf('texto_pt') };
const tradByKey = new Map();
for (let i = 1; i < tradLines.length; i++) {
  const f = parseCsvLine(tradLines[i], ';');
  const sds = f[tradIx.sds], slot = f[tradIx.slot], pt = f[tradIx.pt];
  if (!sds || !slot) continue;
  const sdsBase = sds.split(/[\\/]/).pop();
  if (!pt) continue;
  tradByKey.set(`${sdsBase}|${slot}`, pt);
}
console.log(`traducoes: ${tradLines.length-1} linhas, ${tradByKey.size} com PT`);

// Itera voice-map e simula junção
const vmapLines = readFileSync(VMAP, 'utf8').split(/\r?\n/).filter(l => l.trim());
const header = parseCsvLine(vmapLines[0]);
const ixWav = header.indexOf('wav_basename');
const ixName = header.indexOf('name');

let matched = 0, miss = 0, byCat = {Script: [0,0], Cutscenes: [0,0], Generic: [0,0], other: [0,0]};
for (let i = 1; i < vmapLines.length; i++) {
  const f = parseCsvLine(vmapLines[i]);
  const wav = f[ixWav], name = f[ixName];
  // extrai sdsPrefix e slot
  const m = wav.match(/^(.+?)_Dabing_/);
  if (!m) { byCat.other[1]++; continue; }
  const sdsPrefix = m[1];
  let slot = '', cat = 'other';
  if (name && name.startsWith('Dabing/')) {
    const parts = name.split('/');
    cat = parts[1];
    if (parts[1] === 'Script' && parts.length >= 5) slot = parts[4];
    else if (parts[1] === 'Cutscenes' && parts.length >= 4) slot = parts[3];
    else if (parts[1] === 'Generic' && parts.length >= 5) slot = parts[4];
  }
  // Procura no tradByKey
  let found = '';
  for (const [k, v] of tradByKey) {
    const sdsName = k.split('|')[0].replace(/\.sds$/, '');
    if (sdsName === sdsPrefix && k.split('|')[1] === slot) { found = v; break; }
  }
  if (found) { matched++; byCat[cat] && byCat[cat][0]++; }
  else { miss++; byCat[cat] && byCat[cat][1]++; }
}
console.log(`Matched: ${matched}/${vmapLines.length-1} (${(matched/(vmapLines.length-1)*100).toFixed(1)}%)`);
console.log(`Por categoria:`);
for (const k in byCat) {
  const [m, t] = byCat[k];
  if (m+t > 0) console.log(`  ${k}: ${m} matched / ${t} missed`);
}
