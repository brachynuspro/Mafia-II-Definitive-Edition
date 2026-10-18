// manifesto.mjs - cruza dabing_resources.xml com os FSB5 extraidos em 04-export/wav-fsb5/
// produz 04-export/manifesto-final.csv com o mapeamento completo.
//
// uso: node manifesto.mjs <dabing_resources.xml> <pasta-wav-fsb5> <saida.csv>
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, basename, dirname, relative, sep } from 'node:path';

const xmlPath = process.argv[2] || 'D:\\SteamLibrary\\steamapps\\common\\Mafia II Definitive Edition\\pc\\sds_br\\dabing_resources.xml';
const fsb5Root = process.argv[3] || 'D:\\SteamLibrary\\steamapps\\common\\Mafia II Definitive Edition\\DublagemIA\\04-export\\wav-fsb5';
const wavRoot = 'D:\\SteamLibrary\\steamapps\\common\\Mafia II Definitive Edition\\DublagemIA\\04-export\\wav';
const outCsv = process.argv[4] || 'D:\\SteamLibrary\\steamapps\\common\\Mafia II Definitive Edition\\DublagemIA\\04-export\\manifesto-final.csv';

// parser simples de XML sem dependencia externa
function parseSdssList(xml) {
  // dabing_resources.xml tem formato: <sdss><sds name="..."><resources><resource name="..."/>...
  // Os paths tem prefixo: c:\p4v\buildmachine_luciano_rye_development\mafia2\edit\sounds\dabing\
  const PREFIX = 'c:\\p4v\\buildmachine_luciano_rye_development\\mafia2\\edit\\sounds\\dabing\\';
  const result = [];
  // regex simples: <sds name="..."> ... ate </sds>
  const sdsRegex = /<sds\s+name="([^"]+)"\s*>([\s\S]*?)<\/sds>/g;
  const resRegex = /<resource\s+name="([^"]+)"\s*\/>/g;
  let m;
  while ((m = sdsRegex.exec(xml)) !== null) {
    const sdsName = m[1];
    const body = m[2];
    const resources = [];
    let rm;
    const innerResRegex = /<resource\s+name="([^"]+)"\s*\/>/g;
    while ((rm = innerResRegex.exec(body)) !== null) {
      let p = rm[1];
      if (p.toLowerCase().startsWith(PREFIX)) p = p.slice(PREFIX.length);
      else if (p.toLowerCase().startsWith('c:\\p4v\\buildmachine_luciano_rye_development\\mafia2\\edit\\sounds\\')) p = p.slice(85);
      resources.push(p);
    }
    result.push({ sds: sdsName, resources });
  }
  return result;
}

const xmlText = readFileSync(xmlPath, 'utf8');
const list = parseSdssList(xmlText);
console.log(`SDS no manifesto: ${list.length}`);
const total = list.reduce((a, s) => a + s.resources.length, 0);
console.log(`recursos totais: ${total}`);

// mapeia cada resource path (relativo dabing/) para o FSB5 extraido
// o FSB5 esta em fsb5Root/<sds_dir>/<sds_basename>/<sds_basename>_<name>.fsb5
function findFsb5(rel, sdsName) {
  const sdsBase = sdsName.replace(/\.xml$/, '.sds');
  const sdsDir = dirname(sdsName);
  const sdsFileBase = basename(sdsBase, '.sds');
  // rel = "script\05\04\05_04_0010.wav" — caminho relativo apos strip do prefixo
  // O FSB5 name no disco preserva o casing original (Script em MAIUSCULO, vindo do EN sound resource)
  // entao montamos o nome do FSB5 com o casing original Script
  const relNorm = rel.replace(/^Dabing[\\/]/, '').replace(/\\/g, '/').replace(/\.wav$/, '');
  const variants = [];
  for (const prefix of ['Dabing/', '']) {
    for (const seg of [relNorm, relNorm.replace(/^script\//i, 'Script/'), relNorm.replace(/^generic\//i, 'Generic/'), relNorm.replace(/^cutscene\//i, 'Cutscene/')]) {
      variants.push((prefix + seg).replace(/\//g, '_'));
    }
  }
  const sdsDirAbs = join(fsb5Root, sdsDir);
  if (!existsSync(sdsDirAbs)) {
    // fallback: wav dir direto (Fsb5Batch naming)
    for (const v of variants) {
      for (const ext of ['.fsb5', '.wav']) {
        const c = join(wavRoot, `${sdsFileBase}_${v.replace(/^Dabing_/, 'Dabing_')}${ext}`);
        if (existsSync(c)) return relative(wavRoot, c);
      }
    }
    return null;
  }
  const sdsFileDir = join(sdsDirAbs, sdsFileBase);
  if (!existsSync(sdsFileDir)) {
    // fallback
    for (const v of variants) {
      for (const ext of ['.fsb5', '.wav']) {
        const c = join(wavRoot, `${sdsFileBase}_${v.replace(/^Dabing_/, 'Dabing_')}${ext}`);
        if (existsSync(c)) return relative(wavRoot, c);
      }
    }
    return null;
  }
  // exact match por variantes
  for (const v of variants) {
    for (const ext of ['.fsb5', '.bin']) {
      const c = join(sdsFileDir, `${sdsFileBase}_${v}${ext}`);
      if (existsSync(c)) return relative(fsb5Root, c);
    }
  }
  // tenta variantes + extensao .wav (caso o nome esteja em wav dir, fallback)
  for (const v of variants) {
    for (const ext of ['.wav', '.fsb5']) {
      const c = join(wavRoot, `${sdsFileBase}_${v}${ext}`);
      if (existsSync(c)) return relative(wavRoot, c);
    }
  }
  // tenta o r0 fallback
  const target = basename(relNorm);
  for (const f of readdirSync(sdsFileDir)) {
    if (f.endsWith('.fsb5') && f.toLowerCase().includes(target.toLowerCase())) return relative(fsb5Root, join(sdsFileDir, f));
  }
  return null;
}

let present = 0, missing = 0;
const out = ['sds_xml,sds_path,sds_dir,sds_basename,mission,chapter,slot,original_path,fsb5_path,status'];
for (const sds of list) {
  const sdsDir = dirname(sds.sds);
  const sdsBase = basename(sds.sds, '.xml');
  for (const rel of sds.resources) {
    const parts = rel.replace(/\.wav$/, '').split(/[\\\/]/);
    let mission = '', chapter = '', slot = '';
    if (parts.length >= 3) { mission = parts[parts.length-3]; chapter = parts[parts.length-2]; slot = parts[parts.length-1]; }
    else if (parts.length === 2) { mission = parts[0]; chapter = ''; slot = parts[1]; }
    else { slot = parts[0]; }
    const fsb5 = findFsb5(rel, sds.sds);
    const status = fsb5 ? 'en' : 'missing';
    if (fsb5) present++; else missing++;
    out.push([sds.sds, `pc\\\\sds\\\\${sds.sds.replace(/\\.xml$/, '.sds')}`.replace(/\\\\/g, '\\\\'), sdsDir, sdsBase, mission, chapter, slot, rel, fsb5 || '', status].map(v => `"${v}"`).join(','));
  }
}
writeFileSync(outCsv, out.join('\n'));
console.log(`ok: ${present}  missing: ${missing}`);
console.log(`saida: ${outCsv}`);
