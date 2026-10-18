// dublar-sds.mjs - dubla um .sds de fala: TTS PT-BR -> encaixe na duracao original -> volume igual ao original
//                  -> FSB5 PCM16 -> repack.
// uso: node dublar-sds.mjs <sds-original> <roteiro.csv> [pasta-saida]
//   roteiro.csv (UTF-8, ';', com cabecalho): id;voz;texto_pt[;...]   (id = nome do recurso sem .fsb)
//   texto_pt vazio ou "=" mantem o audio original.
//   vozes: definidas em 10-tts-local\vozes.json (motor kokoro local ou edge).
// Com o jogo em PT-BR o motor carrega pc\sds_br\<x> quando existe (mesmo audio EN + legendas), entao
// a base preferida e a copia BR. Saida: <pasta-saida>\pc\sds_br\... (ou pc\sds\...). Nunca escreve em pc\.
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, rmSync, copyFileSync } from 'node:fs';
import { join, dirname, basename, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { lerWav, montarFsb5 } from './wav-para-fsb5.mjs';

const RAIZ = String.raw`D:\SteamLibrary\steamapps\common\Mafia II Definitive Edition`;
const DUB = join(RAIZ, 'DublagemIA');
const SDSTOOL = join(DUB, '08-repack', 'SdsTool', 'bin', 'Release', 'net8.0-windows', 'SdsTool.exe');
const FSB2WAV = join(DUB, '06-fmod', 'Fsb5ToWav', 'bin', 'Release', 'net8.0', 'Fsb5ToWav.exe');
const FFMPEG_WINGET = join(homedir(), String.raw`AppData\Local\Microsoft\WinGet\Packages\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\ffmpeg-9.0.2-full_build\bin\ffmpeg.exe`);
const FFMPEG = process.env.FFMPEG || (existsSync(FFMPEG_WINGET) ? FFMPEG_WINGET : 'ffmpeg');
const CACHE = join(DUB, '08-repack', '_cache-tts');
const TAXA = 22050;            // saida FSB5 PCM16 mono
const MAX_ACELERA = 1.45;      // nao acelera mais que 45% para caber (atempo preserva o tom)
const VOZES = JSON.parse(readFileSync(join(DUB, '10-tts-local', 'vozes.json'), 'utf8').replace(/^\uFEFF/, ''));

const [, , sdsOrig, roteiroCsv, saidaArg] = process.argv;
if (!sdsOrig || !roteiroCsv) { console.error('uso: node dublar-sds.mjs <sds-original> <roteiro.csv> [pasta-saida]'); process.exit(2); }
const saida = resolve(saidaArg || join(DUB, '08-repack', 'saida'));
let base = resolve(sdsOrig);
{ const relSds = relative(join(RAIZ, 'pc', 'sds'), base);
  const br = join(RAIZ, 'pc', 'sds_br', relSds);
  if (!relSds.startsWith('..') && existsSync(br)) base = br; }
const relJogo = relative(join(RAIZ, 'pc'), base);
if (relJogo.startsWith('..')) throw new Error('sds-original precisa estar dentro de pc\\');
// com a dublagem instalada, pc\ tem o SDS dublado: a base certa (audio EN, volume e inicio das falas)
// e o original guardado pelo instalar.ps1
{ const original = join(DUB, '08-repack', 'backup-original', 'pc', relJogo);
  if (existsSync(original)) base = original; }
const trab = join(DUB, '08-repack', '_trabalho', basename(base));
console.log('base: pc\\' + relJogo);

function run(cmd, args, timeout = 600000) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', timeout, maxBuffer: 64 << 20 });
  if (r.status !== 0) throw new Error(`${basename(cmd)} falhou (${r.status}): ${(r.stderr || r.stdout || '').slice(-600)}`);
  return r.stdout;
}
function duracaoFsb(buf) {
  const modo = buf.readBigUInt64LE(60);
  const taxas = [4000, 8000, 11000, 11025, 16000, 22050, 24000, 32000, 44100, 48000, 96000];
  return Number(modo >> 34n) / taxas[Number((modo >> 1n) & 15n)];
}
function nomeFsb(buf) {
  const ini = 60 + buf.readUInt32LE(12), off = buf.readUInt32LE(ini);
  const s = ini + off; return buf.toString('latin1', s, buf.indexOf(0, s));
}
function rmsVoz(pcm) {         // RMS so dos trechos com voz (quadros de 20 ms acima de -45 dBFS)
  const s = new Int16Array(pcm.buffer, pcm.byteOffset, pcm.length >> 1), q = 441; let soma = 0, n = 0;
  for (let i = 0; i + q <= s.length; i += q) {
    let e = 0; for (let j = i; j < i + q; j++) e += s[j] * s[j];
    e /= q; if (e > 32768 * 32768 * 3.2e-5) { soma += e; n++; }
  }
  return n ? Math.sqrt(soma / n) : 0;
}
function inicioVoz(pcm, taxa) {  // segundos ate o primeiro quadro de 20 ms acima de -40 dBFS
  const s = new Int16Array(pcm.buffer, pcm.byteOffset, pcm.length >> 1), q = Math.round(taxa * 0.02);
  for (let i = 0; i + q <= s.length; i += q) {
    let e = 0; for (let j = i; j < i + q; j++) e += s[j] * s[j];
    if (e / q > 32768 * 32768 * 1e-4) return i / taxa;
  }
  return 0;
}
function lerRoteiro(p) {
  const L = readFileSync(p, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/).filter(l => l.trim());
  const cab = L[0].split(';').map(s => s.trim()); const iId = cab.indexOf('id'), iVoz = cab.indexOf('voz'), iTx = cab.indexOf('texto_pt');
  const m = new Map();
  for (const l of L.slice(1)) { const c = l.split(';'); m.set(c[iId].trim(), { voz: (c[iVoz] || '').trim(), texto: (c[iTx] || '').trim() }); }
  return m;
}
function chaveCache(v, texto) { return createHash('sha1').update(`${v.motor}|${v.voz}|${v.velocidade ?? 1}|${v.rate ?? ''}|${v.pitch ?? ''}|${texto}`).digest('hex'); }

// --- TTS: Kokoro em lote (local) ou Edge (uma a uma, com espera em caso de 429) ---
async function sintetizar(itens) {
  mkdirSync(CACHE, { recursive: true });
  const kokoro = [], edge = [];
  for (const it of itens) {
    it.cache = join(CACHE, chaveCache(it.v, it.texto) + (it.v.motor === 'edge' ? '.mp3' : '.wav'));
    if (existsSync(it.cache)) continue;
    (it.v.motor === 'edge' ? edge : kokoro).push(it);
  }
  if (kokoro.length) {
    const lote = join(trab, '_lote-kokoro.json');
    writeFileSync(lote, JSON.stringify(kokoro.map(it => ({ texto: it.texto, voz: it.v.voz, velocidade: it.v.velocidade ?? 1, saida: it.cache }))));
    console.log(`  kokoro: sintetizando ${kokoro.length} falas...`);
    const out = run('python', ['-I', join(import.meta.dirname, 'tts-kokoro.py'), lote], 4 * 3600000);
    for (const l of out.split(/\r?\n/)) if (l.startsWith('ERRO')) console.log('  ' + l);
  }
  for (const it of edge) {
    const txt = it.cache + '.txt'; writeFileSync(txt, it.texto, 'utf8');
    for (let t = 1; t <= 6; t++) {
      const r = spawnSync(process.execPath, [join(import.meta.dirname, 'tts-edge-um.mjs'), it.v.voz, it.v.rate ?? '+0%', it.v.pitch ?? '+0Hz', txt, it.cache], { encoding: 'utf8', timeout: 60000 });
      if (r.status === 0 && existsSync(it.cache)) break;
      await new Promise(res => setTimeout(res, (r.status === 3 ? 30000 : 3000) * t));
    }
    rmSync(txt, { force: true });
  }
}

// 1) desempacota
rmSync(trab, { recursive: true, force: true }); mkdirSync(trab, { recursive: true });
run(SDSTOOL, ['unpack', base, trab]);
const pasta = join(trab, 'extracted', basename(base));
const fsbs = [];
(function walk(d) { for (const e of readdirSync(d, { withFileTypes: true })) { const p = join(d, e.name); if (e.isDirectory()) walk(p); else if (e.name.endsWith('.fsb')) fsbs.push(p); } })(pasta);

// 2) TTS de todas as falas do roteiro
const roteiro = lerRoteiro(roteiroCsv);
const itens = [];
for (const f of fsbs) {
  const id = basename(f, '.fsb'), r = roteiro.get(id);
  if (!r || !r.texto || r.texto === '=') continue;
  const v = VOZES[r.voz] ?? VOZES.antonio;
  itens.push({ id, f, voz: r.voz, v, texto: r.texto });
}
await sintetizar(itens);

// 3) encaixe + volume + FSB5
const relatorio = ['id;voz;dur_orig;dur_tts;acel;dur_final;ganho_db;texto'];
let trocadas = 0;
for (const it of itens) {
  const { id, f, v } = it;
  if (!existsSync(it.cache)) { relatorio.push(`${id};${it.voz};;;;;;(TTS falhou - original mantido)`); continue; }
  const orig = readFileSync(f); const durOrig = duracaoFsb(orig);
  const wav0 = join(trab, id + '.0.wav'), wav = join(trab, id + '.wav'), wavOrig = join(trab, id + '.orig.wav');
  const tom = Number(v.tom ?? 1);
  const filtrosBase = ['silenceremove=start_periods=1:start_threshold=-50dB,areverse,silenceremove=start_periods=1:start_threshold=-50dB,areverse'];
  if (Math.abs(tom - 1) > 0.001) filtrosBase.push(`rubberband=pitch=${tom}`);
  const decodificar = () => run(FFMPEG, ['-y', '-v', 'error', '-i', it.cache, '-af', filtrosBase.join(','), '-ar', String(TAXA), '-ac', '1', '-c:a', 'pcm_s16le', wav0]);
  try { decodificar(); }
  catch {   // audio do cache corrompido (ex.: falha de gravacao no disco): apaga, sintetiza de novo e tenta mais uma vez
    rmSync(it.cache, { force: true }); await sintetizar([it]);
    if (!existsSync(it.cache)) { relatorio.push(`${id};${it.voz};;;;;;(TTS falhou - original mantido)`); continue; }
    decodificar();
  }
  const w0 = lerWav(readFileSync(wav0)); const durTts = w0.data.length / 2 / TAXA;
  if (durOrig > 4 && durTts * 3 < durOrig) {   // original e quase todo grito/respiracao: nao trocar por silencio
    relatorio.push(`${id};${it.voz};${durOrig.toFixed(2)};${durTts.toFixed(2)};;;;(original mantido: fala curta demais p/ duracao)`); continue;
  }
  // volume: iguala o RMS (trechos com voz) ao da fala original, decodificada pelo FMOD do jogo
  let ganhoDb = 0, inicio = 0;
  if (spawnSync(FSB2WAV, [f, wavOrig], { encoding: 'utf8' }).status === 0) {
    const wo = lerWav(readFileSync(wavOrig));
    const ro = rmsVoz(wo.data), rt = rmsVoz(w0.data);
    if (ro > 0 && rt > 0) ganhoDb = Math.max(-6, Math.min(12, 20 * Math.log10(ro / rt)));
    inicio = inicioVoz(wo.data, wo.taxa);
  }
  // a fala comeca quando a voz comeca no original (pausas de abertura); so o que sobrar de tempo
  const acel = Math.min(MAX_ACELERA, Math.max(1, durTts / Math.max(0.3, durOrig - 0.05)));
  const atraso = Math.max(0, Math.min(inicio, durOrig - 0.05 - durTts / acel));
  const filtros = [acel > 1.001 ? `atempo=${acel.toFixed(4)}` : null, `volume=${ganhoDb.toFixed(2)}dB`, 'alimiter=limit=0.95',
    atraso > 0.02 ? `adelay=${Math.round(atraso * 1000)}` : null, `apad=whole_dur=${durOrig.toFixed(3)}`].filter(Boolean).join(',');
  run(FFMPEG, ['-y', '-v', 'error', '-i', wav0, '-af', filtros, '-ar', String(TAXA), '-ac', '1', '-c:a', 'pcm_s16le', wav]);
  const w = lerWav(readFileSync(wav));
  writeFileSync(f, montarFsb5(w, nomeFsb(orig)));
  const durFinal = w.data.length / 2 / TAXA;
  relatorio.push(`${id};${it.voz};${durOrig.toFixed(2)};${durTts.toFixed(2)};${acel.toFixed(2)};${durFinal.toFixed(2)};${ganhoDb.toFixed(1)};${it.texto}`);
  trocadas++;
}
for (const f of fsbs) { const id = basename(f, '.fsb'); if (!itens.some(i => i.id === id)) relatorio.push(`${id};-;;;;;;(original mantido)`); }

// 4) reempacota
const destino = join(saida, 'pc', relJogo);
mkdirSync(dirname(destino), { recursive: true });
// alguns SDS registram recursos com barra inicial (<File>/Dabing/...); o SdsTool resolve isso na raiz do
// disco. Os nomes nao podem mudar (o jogo busca por eles), entao uma juncao temporaria <raiz>\Dabing -> pasta\Dabing.
const juncoes = [];
for (const m of readFileSync(join(pasta, 'SDSContent.xml'), 'utf8').matchAll(/<File>\/([^/<]+)\//g)) {
  const raiz = join(resolve(pasta).slice(0, 3), m[1]);
  if (juncoes.includes(raiz)) continue;
  if (existsSync(raiz)) throw new Error(`${raiz} ja existe; nao da para criar a juncao temporaria`);
  spawnSync('cmd', ['/c', 'mklink', '/J', raiz, join(pasta, m[1])], { encoding: 'utf8' });
  juncoes.push(raiz);
}
try { run(SDSTOOL, ['pack', pasta, destino]); }
finally { for (const j of juncoes) spawnSync('cmd', ['/c', 'rmdir', j], { encoding: 'utf8' }); }   // rmdir sem /s: remove so a juncao
writeFileSync(destino + '.relatorio.csv', '\uFEFF' + relatorio.join('\r\n'));
rmSync(trab, { recursive: true, force: true });
console.log(`OK ${destino}  falas trocadas=${trocadas}/${fsbs.length}`);
