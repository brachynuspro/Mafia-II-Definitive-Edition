// tts-multivoice.mjs — TTS por personagem com 5 vozes (Maria sapi + Francisca/Antonio edge)
// Entrada: voice-map.csv (mapa personagem->voz, COM coluna texto_pt) + duracoes.csv
// Saida:   DublagemIA/04-export/tts-pt/<wav>.wav
//
// Vozes:
//   V0 sapi:Maria       - Microsoft Maria Desktop (pt-BR Female)
//   V1 edge:Francisca   - pt-BR-FranciscaNeural
//   V2 edge:Antonio:p0  - pt-BR-AntonioNeural (rate=+0%,pitch=+0Hz)
//   V3 edge:Antonio:p1  - pt-BR-AntonioNeural (rate=-10%,pitch=-3Hz) - grave
//   V4 edge:Antonio:p2  - pt-BR-AntonioNeural (rate=+15%,pitch=+2Hz) - agudo
//
// Uso:  node tts-multivoice.mjs [limit]
//   limit: numero maximo de arquivos a processar (default: todos os mapeados)
//
// Requer: voice-map.csv estendido com coluna `texto_pt` (gerado por
//         mesclar-traducoes.mjs a partir de traducoes-pt.csv). Itens sem
//         `texto_pt` são pulados — não geramos placeholder.

import { readFileSync, writeFileSync, existsSync, statSync, mkdirSync, unlinkSync, renameSync, appendFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
import { join, dirname } from 'node:path';
import { spawn } from 'node:child_process';
import { EdgeTTS } from 'node-edge-tts';

const ROOT = String.raw`D:\SteamLibrary\steamapps\common\Mafia II Definitive Edition`;
const VMAP = `${ROOT}\\DublagemIA\\04-export\\voice-map.csv`;
const DURACOES = `${ROOT}\\DublagemIA\\04-export\\duracoes.csv`;
const TTROOT = `${ROOT}\\DublagemIA\\04-export\\tts-pt`;
const LOG_TMP = `${ROOT}\\DublagemIA\\04-export\\tts-multivoice.log`;

const FFMPEG = (() => {
  // Tenta achar ffmpeg. Em alguns ambientes precisa PATH explicito.
  const candidates = [
    `${process.env.USERPROFILE}\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\\ffmpeg-9.0.2-full_build\\bin\\ffmpeg.exe`,
    'C:\\Program Files\\Gyan\\ffmpeg\\bin\\ffmpeg.exe',
    'C:\\ffmpeg\\bin\\ffmpeg.exe',
    'C:\\msys64\\mingw64\\bin\\ffmpeg.exe',
    'ffmpeg',
  ];
  for (const c of candidates) {
    if (c === 'ffmpeg') return c; // PATH lookup, nao existsSync
    if (existsSync(c)) return c;
  }
  return 'ffmpeg'; // vai falhar
})();
const EDGE_OUT_FMT = 'audio-24khz-48kbitrate-mono-mp3';
const SAPI_VOICE = 'Microsoft Maria Desktop';
const SAPIPoolSize = 20;

const limit = Number(process.argv[2] || 0);
const dryRun = process.argv.includes('--dry-run');

// ---------- helpers ----------

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

function logln(s, also=true) {
  process.stdout.write(s + '\n');
  if (also) {
    try { appendFileSync(LOG_TMP, s + '\n', 'utf8'); } catch {}
  }
}

function loadVoiceMap(path) {
  const lines = readFileSync(path, 'utf8').split(/\r?\n/).filter(l => l.trim());
  const header = parseCsvLine(lines[0]);
  const ix = name => header.indexOf(name);
  const m = new Map();
  for (let i = 1; i < lines.length; i++) {
    const f = parseCsvLine(lines[i]);
    const wav = f[ix('wav_basename')];
    if (!wav) continue;
    m.set(wav, {
      name: f[ix('name')],
      key: f[ix('key')],
      gender: f[ix('gender')],
      voice_id: f[ix('voice_id')],
      prosody: f[ix('prosody')],
      label: f[ix('label')],
      texto_pt: f[ix('texto_pt')] ?? '',
    });
  }
  return m;
}

function parseProsody(s) {
  const out = { rate: '+0%', pitch: '+0Hz' };
  if (!s) return out;
  for (const part of s.split(',')) {
    const m = part.match(/^(\w+)=(.+)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

// NOTA: placeholderText foi removido na F5c v2. O texto agora vem da coluna
// `texto_pt` do voice-map.csv, produzido por mesclar-traducoes.mjs a partir
// de traducoes-pt.csv. Items sem `texto_pt` são pulados (não geramos lixo).

// run single SAPI5 call via PowerShell (SAPI5 nao emite mp3, gera WAV direto)
async function sapiOne(text, out) {
  const psCmd = `Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; $s.SelectVoice('${SAPI_VOICE}'); $s.Rate = 0; $s.SetOutputToWaveFile('${out.replace(/\\/g,'\\\\').replace(/'/g, "''")}'); $s.Speak('${text.replace(/'/g, "''")}'); $s.Dispose()`;
  return new Promise(resolve => {
    const p = spawn('powershell', ['-NoProfile', '-Command', psCmd], { stdio: 'ignore' });
    p.on('exit', code => resolve(code === 0));
  });
}

// pool runner for batch of Maria items
async function sapiPool(items) {
  const batchSize = SAPIPoolSize;
  let done = 0, fail = 0;
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize).filter(it => !existsSync(it.out));
    if (batch.length === 0) { done += items.slice(i, i+batchSize).length; continue; }
    // monta args
    const args = batch.map(it => `@('${it.out.replace(/\\/g,'\\\\').replace(/'/g, "''")}', '${it.text.replace(/'/g, "''")}')`);
    const psCmd = `Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; $s.SelectVoice('${SAPI_VOICE}'); $s.Rate = 0; foreach ($it in @(${args.join(',')})) { $f = $it[0]; $t = $it[1]; if (Test-Path $f) { continue } $s.SetOutputToWaveFile($f); $s.Speak($t) }; $s.Dispose()`;
    const p = spawn('powershell', ['-NoProfile', '-Command', psCmd], { stdio: 'ignore' });
    await new Promise(resolve => p.on('exit', code => {
      if (code === 0) done += batch.length; else fail += batch.length;
      resolve();
    }));
  }
  return { done, fail };
}

// run single Edge TTS call, returns true on success
async function edgeOne(text, voice, prosody, mp3Path) {
  const opts = { voice, outputFormat: EDGE_OUT_FMT, timeout: 25000 };
  if (prosody.rate) opts.rate = prosody.rate;
  if (prosody.pitch) opts.pitch = prosody.pitch;
  // tenta com ate 3 retries (429 backoff)
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const tts = new EdgeTTS(opts);
      await tts.ttsPromise(text, mp3Path);
      return true;
    } catch (e) {
      const msg = String(e?.message || e);
      const is429 = msg.includes('429');
      const isTimeout = msg.includes('Timed out') || msg.includes('TIMEOUT');
      const wait = is429 ? Math.min(30000, 5000 * attempt) : (isTimeout ? 2000 * attempt : 0);
      if (wait > 0 && attempt < 4) {
        await new Promise(r => setTimeout(r, wait));
        continue;
      }
      if (attempt === 4) return false;
    }
  }
  return false;
}

async function mp3ToWav(mp3Path, wavPath) {
  return new Promise(resolve => {
    const p = spawn(FFMPEG, ['-y', '-loglevel', 'error', '-i', mp3Path, '-ac', '1', '-ar', '22050', '-f', 'wav', wavPath], { stdio: 'ignore' });
    p.on('exit', code => {
      try { existsSync(mp3Path) && unlinkSync(mp3Path); } catch {}
      resolve(code === 0);
    });
  });
}

// ---------- main ----------

const vmap = loadVoiceMap(VMAP);
logln(`voice-map loaded: ${vmap.size} entries`);

const durLines = readFileSync(DURACOES, 'utf8').split(/\r?\n/).filter(l => l.trim());
logln(`duracoes loaded: ${durLines.length - 1} rows`);

// Build work items: para cada linha de duracoes que tem voice-map entry, gerar work item
const items = [];
let nNoMap = 0, nNoText = 0, nAlreadyDone = 0;
for (let i = 1; i < durLines.length; i++) {
  const f = parseCsvLine(durLines[i]);
  const wav = f[1];
  const wavPath = f[0];
  const dur = Number(f[2]);
  if (!wav || !wavPath) continue;
  const v = vmap.get(wav);
  if (!v) { nNoMap++; continue; }
  const text = (v.texto_pt || '').trim();
  if (!text) { nNoText++; continue; }  // sem tradução: pula
  const outWav = join(TTROOT, wav);
  // Idempotencia: pula so Maria (ja gerada) e arquivos de script/cutscene que NAO serao regerados.
  // Para vozes Edge, sempre regerar.
  if (existsSync(outWav) && !process.argv.includes('--force')) {
    if (v.voice_id.startsWith('sapi:')) { nAlreadyDone++; continue; }
  }
  items.push({ wav, outWav, text, voice_id: v.voice_id, prosody: parseProsody(v.prosody), label: v.label, dur });
}
logln(`  mapped items: ${items.length}  noMap: ${nNoMap}  noText: ${nNoText}  alreadyDone: ${nAlreadyDone}`);

mkdirSync(dirname(LOG_TMP), { recursive: true });

// Agrupa por voz
const grouped = new Map();
for (const it of items) {
  const k = it.voice_id;
  if (!grouped.has(k)) grouped.set(k, []);
  grouped.get(k).push(it);
}
logln('Por voz:');
for (const [k, list] of grouped) logln(`  ${k.padEnd(22)} ${list.length}`);

const workItems = limit > 0 ? items.slice(0, limit) : items;
logln(`Processando ${workItems.length} itens (limit=${limit || 'none'})...`);

if (dryRun) {
  logln('--dry-run: nada sera escrito.');
  process.exit(0);
}

// Pool concorrente — vamos ter 2 executores (sapi & edge) sequenciais,
// mas dentro de edge usar concurrency 4 para nao bater 429 facil.

async function runSapiQueue(list) {
  let done = 0, fail = 0, skip = 0;
  const t0 = Date.now();
  const batchSize = SAPIPoolSize;
  const force = process.argv.includes('--force');
  for (let i = 0; i < list.length; i += batchSize) {
    const batch = list.slice(i, i+batchSize);
    const filtered = force ? batch : batch.filter(it => !existsSync(it.outWav));
    if (filtered.length === 0) { skip += batch.length; continue; }
    const ok = await sapiPool(filtered);
    done += ok.done; fail += ok.fail;
    if (i === 0 || ((i / batchSize) % 5) === 0) {
      const dt = (Date.now() - t0) / 1000;
      logln(`  [sapi] ${i+batchSize}/${list.length} done=${done} fail=${fail} skip=${skip} dt=${dt.toFixed(0)}s`);
    }
  }
  return { done, fail, skip };
}

async function runEdgeQueue(list, concurrency = 4) {
  let created = 0, fail = 0, retry = 0, skip = 0;
  const t0 = Date.now();
  const force = process.argv.includes('--force');
  // Edge queue: usa arquivo sidecar .done para idempotencia.
  // <wav>.done indica que foi processado pelo tts-multivoice nesta sessao.
  let active = 0;
  const q = list.slice();
  return new Promise(resolve => {
    const next = async () => {
      while (q.length) {
        const it = q.shift();
        const doneMark = it.outWav + '.done';
        if (!force && existsSync(doneMark)) { skip++; continue; }
        // limpa tmp.mp3 orfao (de execucao anterior)
        const mp3Tmp = it.outWav.replace(/\.wav$/, '.tmp.mp3');
        try { existsSync(mp3Tmp) && unlinkSync(mp3Tmp); } catch {}
        let ok = false;
        for (let attempt = 1; attempt <= 4; attempt++) {
          ok = await edgeOne(it.text, 'pt-BR-AntonioNeural', it.prosody, mp3Tmp);
          if (ok) break;
          retry++;
          await new Promise(r => setTimeout(r, 1000 * attempt));
        }
        if (ok && existsSync(mp3Tmp)) {
          // converte para WAV
          ok = await mp3ToWav(mp3Tmp, it.outWav);
        }
        if (ok) {
          // marca como done (idempotencia)
          try { writeFileSync(doneMark, new Date().toISOString()); } catch {}
          created++;
        } else fail++;
        active--;
        if ((created + fail) % 50 === 0 || (created + fail) === list.length) {
          const dt = (Date.now() - t0) / 1000;
          logln(`  [edge] ${created+fail}/${list.length} created=${created} fail=${fail} skip=${skip} retry=${retry} dt=${dt.toFixed(0)}s`);
        }
      }
      resolve({ done: created, fail, skip, retry });
    };
    // dispara N coroutines concorrentes
    const workers = [];
    for (let w = 0; w < concurrency; w++) workers.push(next());
    Promise.all(workers).then(() => {
      const dt = (Date.now() - t0) / 1000;
      logln(`  [edge] FINAL created=${created} fail=${fail} skip=${skip} retry=${retry} dt=${dt.toFixed(0)}s`);
      resolve({ done: created, fail, skip, retry });
    });
  });
}

// mapear voice_id -> executor
async function dispatch() {
  // Maria SAPI5 (V0) primeiro, em paralelo com Edge Antonio (V2-V4) e Francisca (V1)
  const sapiList = workItems.filter(it => it.voice_id.startsWith('sapi:'));
  const edgeList = workItems.filter(it => it.voice_id.startsWith('edge:'));
  logln(`SAPI5 items: ${sapiList.length}`);
  logln(`Edge items:  ${edgeList.length}`);
  logln('Iniciando sapi pool...');
  const sapiRes = await runSapiQueue(sapiList);
  logln(`SAPI done: ${sapiRes.done} fail: ${sapiRes.fail}`);
  logln('Iniciando edge pool (concurrency=4)...');
  const edgeRes = await runEdgeQueue(edgeList, 4);
  logln(`Edge done: ${edgeRes.done} fail: ${edgeRes.fail}`);
  return { sapi: sapiRes, edge: edgeRes };
}

dispatch().then(r => {
  logln('=== DONE ===');
  process.exit(0);
}).catch(e => {
  logln('FATAL: ' + (e?.message || e));
  process.exit(1);
});
