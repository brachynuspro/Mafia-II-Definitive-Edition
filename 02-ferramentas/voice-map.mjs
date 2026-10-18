// voice-map.mjs — classifica personagem -> voz e gera voice-map.csv
// Entrada: DublagemIA/04-export/wav-fsb5/_extracao.csv (campo `name`)
// Saida:   DublagemIA/04-export/voice-map.csv
//
// Colunas do output: wav_basename,name,key,gender,voice_id,voice_name,prosody
// Cada linha mapeia um arquivo WAV (wav_basename) a uma voz/prosody.
// Hash deterministico: mesma chave -> mesma voz sempre.

import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename } from 'node:path';

const root = String.raw`D:\SteamLibrary\steamapps\common\Mafia II Definitive Edition`;

const CSV_IN = `${root}\\DublagemIA\\04-export\\wav-fsb5\\_extracao.csv`;
const CSV_OUT = `${root}\\DublagemIA\\04-export\\voice-map.csv`;

// Vozes disponiveis (apos discovery Edge TTS):
//   pt-BR-AntonioNeural (M, unica voz masculina disponivel)
//   pt-BR-FranciscaNeural (F)
//   pt-BR-ThalitaNeural (F)
// + SAPI5 local: Microsoft Maria Desktop (F, pt-BR)
//
// Pool de 5 vozes finais com prosody variants para simular 3+ vozes masculinas:
const VOICES = [
  { voice_id: 'sapi:Maria',     voice_name: 'Microsoft Maria Desktop (pt-BR F)',  engine: 'sapi',  prosody: '',         gender: 'F', label: 'V0_maria' },
  { voice_id: 'edge:Francisca',voice_name: 'pt-BR-FranciscaNeural',               engine: 'edge',  prosody: '',         gender: 'F', label: 'V1_francisca' },
  { voice_id: 'edge:Antonio:p0',voice_name: 'pt-BR-AntonioNeural (default)',     engine: 'edge',  prosody: 'rate=+0%,pitch=+0Hz',  gender: 'M', label: 'V2_antonio' },
  { voice_id: 'edge:Antonio:p1',voice_name: 'pt-BR-AntonioNeural (grave)',       engine: 'edge',  prosody: 'rate=-10%,pitch=-3Hz', gender: 'M', label: 'V3_antonio_grave' },
  { voice_id: 'edge:Antonio:p2',voice_name: 'pt-BR-AntonioNeural (agudo)',       engine: 'edge',  prosody: 'rate=+15%,pitch=+2Hz', gender: 'M', label: 'V4_antonio_agudo' },
];
const VOICES_F = VOICES.filter(v => v.gender === 'F').map(v => v.voice_id);
const VOICES_M = VOICES.filter(v => v.gender === 'M').map(v => v.voice_id);

// Classificacao de personagens por genero.
// Lista manual baseada em:
//   - Conhecimento de personagens de Mafia II (Vito, Joe, Harry, Derek, Giuseppe sao masculinos)
//   - Sufixos / prefixos do nome (Female, Male, Civ* etc.)
//   - Lista de NPCs vendor (nomes genericos, "VendorMona" eh feminino em PT, etc.)
const FEMALE_CHARS = new Set([
  // nomes explicitos
  'CivilFemale', 'APDCivFemale', 'BasicFemale',
  // nomes femininos em PT
  'VendorMona', 'VendorTara', 'VendorIllia',
  'Mona', 'Tara', 'Illia',
]);

// Sufixos que indicam feminino (case-insensitive, aplicado ao Char do path)
const FEMALE_SUFFIXES = ['female', 'mona', 'tara', 'illia', 'monagossip', 'taragossip', 'illiagossip',
                         'monaspecial', 'taraspecial', 'illiaspecial', 'drivingangela'];

const MALE_KNOWN_CHARS = new Set([
  // personagens principais e secundarios
  'Vito', 'Joe', 'Harry', 'Derek', 'Giuseppe', 'Brusky',
  'Marty', 'Henry', 'Steve', 'Frank', 'Rocco', 'Tony', 'Eddie', 'JoeDriving',
  // civs explicitamente masculinos
  'CivilMale', 'APDCivMale', 'CivilNormal', 'CivilItalian', 'CivilIrish', 'CivilWorker',
  'CivilChinese', 'CivilBlack', 'CivilFemale'.toLowerCase ? 'CivilFemale' : 'CivilFemale',
  // combatentes genericos
  'Policeman', 'PoliceRadio', 'PoliceFight',
  // DLC fighters (todos homens no game)
  'APDCivItalian', 'APDCivBlack', 'APDCivIrish', 'APDCivChinese',
  'APDGangItalian', 'APDGangIrish', 'APDGangBlack', 'APDGangGreaser',
  'APHotdog', 'APHomground', 'APShoeclean', 'APShoecleanGossip',
]);

function parseCsvLine(line) {
  const out = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQ && line[i+1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if (c === ',' && !inQ) {
      out.push(cur);
      cur = '';
    } else cur += c;
  }
  out.push(cur);
  return out;
}

function sha1Mod(s, mod) {
  const h = createHash('sha1').update(s, 'utf8').digest();
  return h[0] % mod; // 0..mod-1
}

function isFemaleChar(charLower) {
  if (FEMALE_CHARS.has(charLower)) return true;
  // remove prefixos Vendor/Generic prefix e testa sufixos
  for (const suf of FEMALE_SUFFIXES) {
    if (charLower === suf) return true;
    if (charLower.endsWith(suf)) return true;
  }
  // "VendorMonaGossip" -> base "Mona" apos strip
  if (charLower.startsWith('vendor')) {
    const rest = charLower.slice(6);
    if (['mona', 'tara', 'illia'].some(n => rest === n || rest.startsWith(n))) return true;
  }
  // DrivingXxx (Angela = female), SpecialDriving...
  if (charLower.includes('angela')) return true;
  return false;
}

function isMaleChar(charLower) {
  if (MALE_KNOWN_CHARS.has(charLower)) return true;
  // Sufixos / prefixos claros
  if (charLower.endsWith('male') || charLower.includes('civmale')) return true;
  if (charLower.includes('gangster') || charLower.includes('policeman') || charLower.includes('police')) return true;
  if (charLower.startsWith('vendor') && !isFemaleChar(charLower)) return true;
  if (charLower.includes('fighter') || charLower.includes('special')) return true;
  if (['sicily', 'sicilyfighter', 'sicilysoldier'].some(p => charLower.includes(p))) return true;
  return false;
}

// Decidir voz para uma linha de extracao
function classify(name) {
  if (!name || !name.startsWith('Dabing/')) return null;
  const parts = name.split('/');
  if (parts.length < 3) return null;
  const category = parts[1]; // Generic/Script/Cutscenes/...
  const charLower = (parts[2] || '').toLowerCase();

  let gender = 'M'; // default
  let key;
  if (category === 'Generic') {
    key = parts[2]; // character name
    if (isFemaleChar(key.toLowerCase())) gender = 'F';
    else gender = 'M';
  } else if (category === 'Script') {
    // sem info do personagem -> chave eh o slot completo
    // distribui entre todas as 5 vozes (80% M, 20% F — alinhado com proporcao do jogo)
    key = parts.slice(2).join('/');
    // bias pra masculino (90% no jogo), apenas shuffle
    // Decidir: 20% female, 80% male
    const r = sha1Mod('g:' + key, 100);
    gender = r < 20 ? 'F' : 'M';
  } else if (category === 'Cutscenes') {
    key = parts.slice(2).join('/');
    // mesma logica
    const r = sha1Mod('c:' + key, 100);
    gender = r < 20 ? 'F' : 'M';
  } else {
    // outros (eg generic deeper paths, fallback)
    key = name;
    gender = 'M';
  }

  // Distribuir
  const pool = gender === 'F' ? VOICES_F : VOICES_M;
  const idx = sha1Mod('v:' + key, pool.length);
  const v = VOICES.find(x => x.voice_id === pool[idx]);
  return { key, gender, voice_id: v.voice_id, voice_name: v.voice_name, prosody: v.prosody, label: v.label };
}

// Main
console.log(`Lendo ${CSV_IN} ...`);
const txt = readFileSync(CSV_IN, 'utf8');
const lines = txt.split(/\r?\n/).filter(l => l.trim());
console.log(`Total linhas (excluindo header): ${lines.length - 1}`);

const header = parseCsvLine(lines[0]);
const nameIdx = header.indexOf('name');
const outPathIdx = header.indexOf('out_path');
console.log(`  name idx=${nameIdx}  out_path idx=${outPathIdx}`);

if (nameIdx < 0 || outPathIdx < 0) {
  console.error('Cabecalho nao contem name/out_path');
  process.exit(1);
}

const out = ['wav_basename,name,key,gender,voice_id,voice_name,prosody,label'];
let n = 0, nF = 0, nM = 0, skipped = 0;
const counts = new Map();
for (let i = 1; i < lines.length; i++) {
  const fields = parseCsvLine(lines[i]);
  const name = fields[nameIdx];
  const outPath = fields[outPathIdx];
  if (!name || !outPath) { skipped++; continue; }
  const wavBase = basename(outPath).replace(/\.fsb5$/, '.wav');
  const cls = classify(name);
  if (!cls) { skipped++; continue; }
  out.push([
    wavBase,
    JSON.stringify(name),
    JSON.stringify(cls.key),
    cls.gender,
    cls.voice_id,
    JSON.stringify(cls.voice_name),
    JSON.stringify(cls.prosody || ''),
    cls.label
  ].join(','));
  if (cls.gender === 'F') nF++; else nM++;
  counts.set(cls.label, (counts.get(cls.label) || 0) + 1);
  n++;
}
console.log(`Classificadas: ${n}  (F=${nF}  M=${nM})  skipped=${skipped}`);
console.log('Distribuicao por voz:');
for (const [label, cnt] of [...counts.entries()].sort()) console.log(`  ${label.padEnd(22)} ${cnt}`);

writeFileSync(CSV_OUT, out.join('\n'), 'utf8');
console.log(`Escrito em ${CSV_OUT}`);
