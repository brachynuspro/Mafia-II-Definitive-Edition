// tts-edge-um.mjs - gera UMA fala com Edge TTS (processo isolado: erros de websocket nao derrubam o chamador).
// uso: node tts-edge-um.mjs <voz> <rate> <pitch> <arquivo-texto-utf8> <saida.mp3>
import { readFileSync } from 'node:fs';
import { EdgeTTS } from 'node-edge-tts';
const [, , voice, rate, pitch, txtFile, out] = process.argv;
process.on('uncaughtException', e => { console.error(String(e.message || e)); process.exit(/429/.test(String(e)) ? 3 : 1); });
const e = new EdgeTTS({ voice, lang: 'pt-BR', rate, pitch, outputFormat: 'audio-24khz-96kbitrate-mono-mp3', timeout: 30000 });
e.ttsPromise(readFileSync(txtFile, 'utf8'), out).then(() => process.exit(0), err => { console.error(String(err)); process.exit(/429/.test(String(err)) ? 3 : 1); });
