// tts-elevenlabs.mjs - prototipo F5d: usa ElevenLabs Multilingual v2 PT-BR
// para gerar falas criticas (personagens principais) e aplicar time-stretch.
//
// uso:
//   ELEVENLABS_API_KEY=<key> node tts-elevenlabs.mjs [csv] [pasta-saida]
//
// entradas em CSV: coluna `texto` e `duracao_alvo_sec` (duração do WAV original).
// saída: mp3 PT-BR em pasta-saida/<voz>/<key>.mp3 + wav ja time-stretched em
// pasta-saida/<voz>/<key>.wav.
//
// API endpoint:
//   POST https://api.elevenlabs.io/v1/text-to-speech/{voice_id}
//   body { text, model_id: "eleven_multilingual_v2",
//          voice_settings: { stability, similarity_boost, style } }
//
// Time-stretch: usa ffmpeg atempo (chain 0.5..2.0) para preservar pitch.
//   ffmpeg -i in.mp3 -af "atempo=X" -ar 44100 -ac 1 out.wav
//
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const API_KEY = process.env.ELEVENLABS_API_KEY;
if (!API_KEY) {
  console.error('Faltou ELEVENLABS_API_KEY no ambiente.');
  console.error('Poder: definir no PowerShell:  $env:ELEVENLABS_API_KEY="..."');
  process.exit(2);
}

const csv = process.argv[2] || 'D:\\SteamLibrary\\steamapps\\common\\Mafia II Definitive Edition\\DublagemIA\\04-export\\voice-map.csv';
const outRoot = process.argv[3] || 'D:\\SteamLibrary\\steamapps\\common\\Mafia II Definitive Edition\\DublagemIA\\04-export\\tts-elevenlabs';

// Voice IDs sugeridos (clone a partir de amostras EN dos atores; o usuário preenche).
// Formato esperado no voice-map.csv: coluna voice_id opcional sobrescreve este mapeamento.
const DEFAULT_VOICE_IDS = {
  V0_maria:         '',  // preencher com voice_id clonado para V0
  V1_francisca:     '',
  V2_antonio:       '',  // voice masculina default
  V3_antonio_grave: '',
  V4_antonio_agudo: '',
  // Personagens principais (clonar a partir dos atores EN):
  vito:   '',
  joe:    '',
  henry:  '',
  derek:  '',
  giuseppe: '',
  marty:  '',
  steve:  '',
  frank:  '',
  eddie:  '',
  harry:  '',
  brusky: '',
  rocco:  '',
  tony:   '',
};

async function synthesize(text, voiceId, modelId = 'eleven_multilingual_v2') {
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`;
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      'xi-api-key': API_KEY,
      'content-type': 'application/json',
      accept: 'audio/mpeg',
    },
    body: JSON.stringify({
      text,
      model_id: modelId,
      voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0.0 },
    }),
  });
  if (!r.ok) {
    const err = await r.text();
    throw new Error(`ElevenLabs ${r.status}: ${err.slice(0, 200)}`);
  }
  const buf = Buffer.from(await r.arrayBuffer());
  return buf;
}

// Encadeia atempos para valores fora de 0.5..2.0
function atempoChain(factor) {
  const filters = [];
  let f = factor;
  while (f > 2.0) { filters.push('atempo=2.0'); f /= 2.0; }
  while (f < 0.5) { filters.push('atempo=0.5'); f *= 2.0; }
  filters.push(`atempo=${f.toFixed(6)}`);
  return filters.join(',');
}

function timeStretch(inPath, outPath, targetSec) {
  // Mede duração original via ffprobe
  const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', inPath], { encoding: 'utf8' });
  const origSec = parseFloat(probe.stdout);
  if (!isFinite(origSec) || origSec <= 0) return { ok: false, reason: 'ffprobe falhou' };
  const factor = origSec / targetSec;
  // atempo preserva pitch; chain para ranges fora de 0.5..2.0
  const af = atempoChain(factor);
  const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', inPath, '-af', af, '-ar', '44100', '-ac', '1', outPath], { encoding: 'utf8' });
  if (r.status !== 0) return { ok: false, reason: `ffmpeg: ${r.stderr.slice(0, 200)}` };
  return { ok: true, factor: factor.toFixed(3) };
}

// Carrega voice-map
const lines = readFileSync(csv, 'utf8').split(/\r?\n/);
const header = lines[0].split(',');
const idxWav = header.indexOf('wav_basename');
const idxName = header.indexOf('name');
const idxKey = header.indexOf('key');
const idxGender = header.indexOf('gender');
const idxVoice = header.indexOf('voice_id');
const idxVoiceName = header.indexOf('voice_name');
const idxProsody = header.indexOf('prosody');
console.log(`voice-map: ${header.length} cols; name=${idxName} key=${idxKey} gender=${idxGender} voice_id=${idxVoice}`);

const records = [];
for (let i = 1; i < lines.length; i++) {
  if (!lines[i]) continue;
  // CSV é simples (sem aspas escapadas complexas) — split por ,
  const cols = lines[i].split(',');
  if (cols.length < header.length) continue;
  records.push({
    wav: cols[idxWav],
    name: cols[idxName],
    key: cols[idxKey],
    gender: cols[idxGender],
    voice_id: cols[idxVoice],
    voice_name: cols[idxVoiceName],
    prosody: cols[idxProsody],
  });
}
console.log(`records: ${records.length}`);

// Filtra: só processa personagens principais OU voice_id explicitamente setado
const PRIORITARIOS = ['vito', 'joe', 'henry', 'derek', 'giuseppe', 'marty', 'steve', 'frank', 'eddie', 'harry', 'brusky', 'rocco', 'tony'];
const work = records.filter(r => {
  const n = (r.name || '').toLowerCase();
  return PRIORITARIOS.some(p => n.includes(p)) || (r.voice_id && r.voice_id.length >= 8);
});
console.log(`falas criticas (personagens ou voice_id): ${work.length}`);

// Texto vem de falas-missoes.csv + falas-cutscenes.csv. Faltando a integração, parar.
// Por ora prototipo "mock": cada fala fala "Esta e uma frase de teste."
console.log('AVISO: coluna texto nao existe no voice-map. F5d prototipo requer merge com 03-legendas/falas-*.csv');
console.log('Para protótipo sem texto: cada chamada ElevenLabs custara 1 credito. Limite a 10.');
console.log('Use --prototipo=1 para rodar 10 chamadas de smoke-test.');

if (!process.argv.includes('--prototipo=1')) {
  console.log('Para rodar smoke-test:');
  console.log('   node tts-elevenlabs.mjs --prototipo=1');
  process.exit(0);
}

// Smoke-test: 10 chamadas com texto fixo
const TEXTO_TEST = 'Este é um teste de síntese de voz em português brasileiro.';
mkdirSync(outRoot, { recursive: true });
let ok = 0, fail = 0;
const start = Date.now();
for (let i = 0; i < 10; i++) {
  const r = work[i];
  if (!r) break;
  const voiceId = (r.voice_id && r.voice_id.length >= 8) ? r.voice_id : DEFAULT_VOICE_IDS[r.key];
  if (!voiceId) {
    console.log(`  ${r.wav} sem voice_id — pulando (preencher DEFAULT_VOICE_IDS)`);
    continue;
  }
  try {
    const mp3 = await synthesize(TEXTO_TEST, voiceId);
    const mp3Path = join(outRoot, `${r.wav}.mp3`);
    writeFileSync(mp3Path, mp3);
    console.log(`[${i+1}/10] ok ${r.wav} (${mp3.length} B)`);
    ok++;
  } catch (e) {
    console.log(`[${i+1}/10] FAIL ${r.wav}: ${e.message.slice(0, 100)}`);
    fail++;
  }
}
const dt = (Date.now() - start) / 1000;
console.log(`\nok=${ok} fail=${fail} dt=${dt.toFixed(0)}s`);
console.log(`saida: ${outRoot}`);
