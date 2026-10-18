// probe-tts.mjs - testa Edge TTS
import { tts } from 'edge-tts/out/index.js';
import { writeFileSync } from 'node:fs';

const buffer = await tts('Ola, isso e um teste de sintese de voz em portugues brasileiro.', {
  voice: 'pt-BR-FranciscaNeural',
  rate: '+0%',
  pitch: '+0Hz',
  volume: '+0%',
});
writeFileSync(`${process.env.TEMP || '.'}/test-tts.mp3`, buffer);
console.log('gerado ' + buffer.length + ' bytes');
