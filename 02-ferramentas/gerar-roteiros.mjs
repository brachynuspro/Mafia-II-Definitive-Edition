// gerar-roteiros.mjs - cria um roteiro de dublagem por SDS (03-legendas\roteiros\<sds>.csv)
// a partir das LEGENDAS OFICIAIS PT-BR do jogo (pc\sds_br\text\text_default.sds -> TextDatabase.dat).
//   Cutscenes: chave = id do audio (01_01_00_1000)
//   Script:    audio MM_99_CC_SSSS -> chave numerica 3MMCCSSSS
//   Generic (falas de rua): sem legenda -> ficam para transcricao + traducao por IA
// Regras: "f_" (fala estrangeira, ex. italiano) -> "=" (mantem original); tags/prefixos removidos.
// uso: node gerar-roteiros.mjs
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';
import { spawnSync } from 'node:child_process';

const RAIZ = String.raw`D:\SteamLibrary\steamapps\common\Mafia II Definitive Edition`;
const DUB = join(RAIZ, 'DublagemIA');
const SDSTOOL = join(DUB, '08-repack', 'SdsTool', 'bin', 'Release', 'net8.0-windows', 'SdsTool.exe');
const OUT = join(DUB, '03-legendas', 'roteiros');
const VOZ = { V0_maria: 'francisca', V1_francisca: 'francisca', V2_antonio: 'antonio', V3_antonio_grave: 'antonio_grave', V4_antonio_agudo: 'antonio_agudo' };

// 1) legendas oficiais
const trab = join(DUB, '08-repack', '_trabalho', 'text_default_br');
const db = join(trab, 'extracted', 'text_default.sds', 'tables', 'TextDatabase.dat');
if (!existsSync(db)) spawnSync(SDSTOOL, ['unpack', join(RAIZ, 'pc', 'sds_br', 'text', 'text_default.sds'), trab]);
const leg = new Map();
for (const m of readFileSync(db).toString('utf8').matchAll(/([A-Za-z0-9_]+):([^\r\n\0]*)/g)) if (!leg.has(m[1])) leg.set(m[1], m[2]);
writeFileSync(join(DUB, '03-legendas', 'legendas-oficiais-pt.csv'), '\uFEFFchave;texto\r\n' + [...leg].map(([k, v]) => `${k};${v.replace(/;/g, ',')}`).join('\r\n'));

// interjeicoes/onomatopeias: se a fala so tem isso, o audio original (atuado) e melhor que o TTS
const INTERJ = /^(a+h*|a+i+|ah+|aa+h+|u+r*g+h+|ug+h+|ar+g+h+|hm+|hum+|h[aã]+|eh+|ei+|oh+|o+u+|u+[ií]+|eca+|epa+|opa+|ui+|ai+|hein|uau+|haha+|hahaha+|ha+|he+|hehe+|xi+u*|psiu+|shh+|ufa+|ops+|nossa+)$/i;
function limpar(t) {
  t = t.replace(/<[^>]*>/g, ' ').replace(/\[[A-Z_]+\]/g, ' ').replace(/^n_/, '')
       .replace(/\([^)]*\)/g, ' ')                 // rubricas: (bebendo), (roncando), (cantando)...
       .replace(/\s+/g, ' ').replace(/;/g, ',').trim();
  const palavras = t.toLowerCase().match(/[a-zà-ú]+/g) || [];
  if (!palavras.length || palavras.every(p => INTERJ.test(p))) return '';   // -> '=' (mantem original)
  return t.replace(/^[.\s…]+/, '').trim();
}
function legendaDe(nome) {               // nome = Dabing/<Cat>/.../<id>
  const p = nome.split('/'), id = p.at(-1), cat = p[1];
  let t;
  const chaveScript = () => { const s = id.split('_'); return leg.get('3' + s[0] + s[2] + s[3]) ?? leg.get(String(Number(s[0])) + s[2] + s[3]); };
  if (cat === 'Cutscenes') t = leg.get(id) ?? (/^\d+_99_\d+_\d+$/.test(id) ? chaveScript() : undefined);   // cutscenes das DLCs usam chave de script
  else if (cat === 'Script') t = chaveScript();
  if (t === undefined) return null;
  if (t.startsWith('f_')) return '=';
  return limpar(t) || '=';
}

// 2) voz pelo tom (F0) medido no audio EN original (estimar-tom.py); sem medida -> antonio
const tom = new Map();
const tomCsv = join(DUB, '04-export', 'tom-falas.csv');
if (existsSync(tomCsv)) for (const l of readFileSync(tomCsv, 'utf8').split(/\r?\n/).slice(1)) { const [w, f0] = l.split(';'); if (w) tom.set(w.split('__').pop(), Number(f0)); }
// voz do ator (agrupar-atores.py) tem prioridade sobre o tom da fala isolada
const vozAtor = new Map(), atorDe = new Map();
const atCsv = join(DUB, '04-export', 'atores.csv');
if (existsSync(atCsv)) for (const l of readFileSync(atCsv, 'utf8').split(/\r?\n/).slice(1)) { const [w, a, , v] = l.split(';'); if (w) { vozAtor.set(w.split('__').pop(), v); atorDe.set(w.split('__').pop(), a); } }
// elenco (10-tts-local\elenco.csv): ator -> papel com voz propria (idade/timbre do personagem); vale mais que a voz do grupo
const elenco = new Map();
const elCsv = join(DUB, '10-tts-local', 'elenco.csv');
if (existsSync(elCsv)) for (const l of readFileSync(elCsv, 'utf8').replace(/^﻿/, '').split(/\r?\n/).slice(1)) { const [a, p] = l.split(';').map(s => (s ?? '').trim()); if (a && p) elenco.set(a, p); }
function vozPorTom(f0) {
  if (!f0) return 'antonio';
  if (f0 < 105) return 'antonio_grave';
  if (f0 < 145) return 'antonio';
  if (f0 < 190) return 'antonio_agudo';   // homens gritando sobem muito: so vira voz feminina acima de 190 Hz
  if (f0 < 230) return 'francisca';
  return 'thalita';
}
// falas de rua: transcricao EN (Whisper) + traducao por IA (03-legendas\traducao-rua-ia\*.tsv, colunas en<TAB>pt)
const transcr = new Map();
const trDirW = join(DUB, '09-transcricao');
for (const trCsv of readdirSync(trDirW).filter(f => /^transcricoes-en.*\.csv$/.test(f)).map(f => join(trDirW, f))) for (const l of readFileSync(trCsv, 'utf8').split(/\r?\n/).slice(1)) {
  const p = l.split(';'); if (p.length < 4) continue;
  transcr.set(p[0].split('__').pop(), p.slice(2, -1).join(';').replace(/^"|"$/g, '').trim());
}
const trad = new Map();
const trDir = join(DUB, '03-legendas', 'traducao-rua-ia');
if (existsSync(trDir)) for (const f of readdirSync(trDir).filter(f => f.endsWith('.tsv')).sort())
  for (const l of readFileSync(join(trDir, f), 'utf8').replace(/^﻿/, '').split(/\r?\n/).slice(1)) {
    const [en, pt] = l.split('\t'); if (en && pt !== undefined) trad.set(en.trim().toLowerCase(), pt.trim().replace(/;/g, ','));
  }

// ajustes manuais da dublagem (03-legendas\ajustes-dublagem.tsv: id<TAB>texto<TAB>voz): texto mais curto p/ caber
// no tempo, voz trocada etc. Campo vazio = mantem o calculado; texto '=' = mantem o audio original.
const ajustes = new Map();
const ajCsv = join(DUB, '03-legendas', 'ajustes-dublagem.tsv');
if (existsSync(ajCsv)) for (const l of readFileSync(ajCsv, 'utf8').replace(/^﻿/, '').split(/\r?\n/).slice(1)) {
  const [id, texto, voz] = l.split('\t').map(s => (s ?? '').trim());
  if (id && !id.startsWith('#')) ajustes.set(id, { texto: texto.replace(/;/g, ','), voz });
}

const linhas = readFileSync(join(DUB, '04-export', 'voice-map.csv'), 'utf8').split(/\r?\n/).slice(1);
const porSds = new Map(); const fonteSds = new Map(); const incompletos = new Set();
let ok = 0, semLeg = 0, rua = 0, ruaOk = 0; const semLegLista = [];
for (const l of linhas) {
  const m = l.match(/^([^,]+),"([^"]+)",.*,(V\d_[a-z_]+)\s*$/) || l.match(/^([^,]+),"([^"]+)",.*?,(V\d_[a-z_]+)/);
  if (!m) continue;
  const [, wav, nome] = m; const sds = wav.split('_Dabing_')[0];
  let texto;
  if (nome.split('/')[1] === 'Generic') {
    rua++;
    const en = transcr.get(wav);
    if (en === undefined || (en && !trad.has(en.toLowerCase()))) { incompletos.add(sds); continue; }
    texto = en ? (trad.get(en.toLowerCase()) || '=') : '=';   // transcricao vazia = sem fala -> mantem original
    ruaOk++; fonteSds.set(sds, 'ia');
  } else {
    texto = legendaDe(nome);
    if (texto === null) {   // sem legenda oficial: usa transcricao + traducao por IA, se ja houver
      const en = transcr.get(wav);
      if (en !== undefined && (!en || trad.has(en.toLowerCase()))) texto = en ? (trad.get(en.toLowerCase()) || '=') : '=';
      else { semLeg++; semLegLista.push(wav); continue; }
    }
    ok++;
  }
  const fid = nome.split('/').at(-1).replace(/\\u0000|\0/g, ''), aj = ajustes.get(fid);   // alguns nomes vem com NUL no fim
  if (aj?.texto) texto = aj.texto;
  let voz = texto === '=' ? '-' : (elenco.get(atorDe.get(wav)) ?? vozAtor.get(wav) ?? vozPorTom(tom.get(wav)));
  if (aj?.voz && texto !== '=') voz = aj.voz;
  if (!porSds.has(sds)) porSds.set(sds, new Map());
  porSds.get(sds).set(fid, { voz, texto, f0: tom.get(wav) ?? 0, ator: atorDe.get(wav) ?? '' });
}
for (const s of incompletos) if (fonteSds.get(s) === 'ia') porSds.delete(s);   // SDS de rua so entra completo

// 3) localiza o .sds no jogo
const idx = new Map();
(function walk(d) { for (const e of readdirSync(d, { withFileTypes: true })) { const p = join(d, e.name); if (e.isDirectory()) walk(p); else if (e.name.endsWith('.sds') && !idx.has(e.name)) idx.set(e.name, p); } })(join(RAIZ, 'pc', 'sds'));
// DLCs de historia: o SDS so existe la, ou a copia do pc\sds e vazia (so cabecalho) -> usa a copia sds_br da DLC.
// (As copias de DLC de SDS que tambem existem no jogo base sao dubladas a parte: dublar-copias-dlc.ps1)
for (const dlc of ['cnt_joes_adventures', 'cnt_jimmys_vendetta', 'cnt_betrayal_of_jimmy']) {
  const raiz = join(RAIZ, 'pc', 'dlcs', dlc, 'sds_br');
  if (!existsSync(raiz)) continue;
  (function walk(d) { for (const e of readdirSync(d, { withFileTypes: true })) { const p = join(d, e.name); if (e.isDirectory()) walk(p); else if (e.name.endsWith('.sds')) {
    const atual = idx.get(e.name);
    if (!atual || (statSync(atual).size < 8192 && statSync(p).size >= 8192)) idx.set(e.name, p);
  } } })(raiz);
}
mkdirSync(OUT, { recursive: true });
const lista = ['sds;caminho;falas;dubladas'];
for (const [sds, falas] of porSds) {
  const caminho = idx.get(sds + '.sds') ?? '';
  const fonte = fonteSds.get(sds) ?? 'oficial';
  const corpo = [...falas].sort().map(([id, f]) => `${id};${f.voz};${f.texto};${fonte};${f.f0.toFixed(0)};${f.ator}`);
  const conteudo = '\uFEFFid;voz;texto_pt;fonte;f0;ator\r\n' + corpo.join('\r\n') + '\r\n';
  const arq = join(OUT, sds + '.csv');
  // so regrava se mudou: o lote refaz SDS cujo roteiro e mais novo que a saida
  if (!existsSync(arq) || readFileSync(arq, 'utf8') !== conteudo) writeFileSync(arq, conteudo);
  lista.push(`${sds};${caminho};${falas.size};${[...falas.values()].filter(f => f.texto !== '=').length}`);
}
writeFileSync(join(OUT, '_lista.csv'), '\uFEFF' + lista.join('\r\n'));
writeFileSync(join(OUT, '_sem-legenda.txt'), semLegLista.join('\r\n'));   // falas de missao/cutscene p/ transcrever
console.log(`legendas=${leg.size} falas com roteiro=${ok} sem legenda=${semLeg} falas de rua=${rua} (traduzidas e completas: ${ruaOk}, SDS de rua pendentes: ${[...incompletos].length}) traducoes IA=${trad.size} sds=${porSds.size} sem caminho=${lista.filter(l => l.split(';')[1] === '').length}`);



