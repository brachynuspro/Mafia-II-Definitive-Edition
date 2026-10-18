// Parse do header FSB5 (FMOD Sound Bank) para descobrir codec/canais/sample rate
import { readFileSync } from 'node:fs';
const raw = readFileSync(process.argv[2]);
const off = raw.indexOf(Buffer.from('FSB5', 'latin1'));
if (off < 0 || off > 512) { console.log('FSB5 nao encontrado nos primeiros 512 bytes'); process.exit(1); }
console.log('FSB5 encontrado no offset', off, '(prefixo:', JSON.stringify(raw.toString('latin1', 0, off)), ')');
const b = raw.subarray(off);
const sig = b.toString('latin1', 0, 4);
if (sig !== 'FSB5') { console.log('nao e FSB5, assinatura:', JSON.stringify(sig)); process.exit(1); }
const u32 = (o) => b.readUInt32LE(o);
const CODEC = { 0: 'NONE', 1: 'PCM8', 2: 'PCM16', 3: 'PCM24', 4: 'PCM32', 5: 'PCMFLOAT', 6: 'GCADPCM', 7: 'IMAADPCM', 8: 'VAG', 9: 'HEVAG', 10: 'XMA', 11: 'MPEG', 12: 'CELT', 13: 'AT9', 0x10: 'XWMA', 0x11: 'VORBIS', 0x12: 'FADPCM', 0x13: 'OPUS' };
console.log('assinatura : FSB5');
console.log('versao     :', u32(4));
console.log('numSamples :', u32(8));
console.log('sampleHdrSz:', u32(12));
console.log('nameTabSz  :', u32(16));
console.log('dataSize   :', u32(20));
const mode = u32(24);
console.log('mode       :', '0x' + mode.toString(16), '->', CODEC[mode & 0x1f] || '?');
console.log('hash       :', '0x' + u32(32).toString(16));
const nameTable = b.toString('latin1', 60, 60 + u32(16));
console.log('nomes      :', JSON.stringify(nameTable.replace(/\0/g, '|').slice(0, 200)));
console.log('bytes      :', b.length);
// primeiros bytes do payload de audio
console.log('payload[0..15]:', [...b.subarray(60 + u32(16), 76 + u32(16))].map(x => x.toString(16).padStart(2, '0')).join(' '));