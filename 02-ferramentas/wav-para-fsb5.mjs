// wav-para-fsb5.mjs - converte WAV PCM16 (mono/estereo) em FSB5 v1 (codec PCM16), formato aceito pelo FMOD do Mafia II DE.
// uso: node wav-para-fsb5.mjs <entrada.wav> <saida.fsb> [nome-interno]
// Layout (validado contra os .fsb originais do jogo):
//   cabecalho 60 B: "FSB5", ver=1, nSamples=1, tamHdrSample, tamTabNomes, tamDados, modo(2=PCM16), flags=1, 0, 0, 0, hash[16]
//   hdr sample u64: bit0 extra | bits1-4 idx freq | bits5-6 canais | bits7-33 offset/32 | bits34-63 nAmostras
//   tabela de nomes: u32 offset + nome\0, alinhado a 32; dados alinhados a 32.
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, extname } from 'node:path';

const FREQS = { 4000:0, 8000:1, 11000:2, 11025:3, 16000:4, 22050:5, 24000:6, 32000:7, 44100:8, 48000:9, 96000:10 };
const CANAIS = { 1:0, 2:1, 6:2, 8:3 };
const al32 = n => (n + 31) & ~31;

export function lerWav(buf) {
  if (buf.toString('latin1', 0, 4) !== 'RIFF' || buf.toString('latin1', 8, 12) !== 'WAVE') throw new Error('nao e WAV');
  let p = 12, fmt = null, data = null;
  while (p + 8 <= buf.length) {
    const id = buf.toString('latin1', p, p + 4), sz = buf.readUInt32LE(p + 4);
    if (id === 'fmt ') fmt = { fmtTag: buf.readUInt16LE(p + 8), canais: buf.readUInt16LE(p + 10), taxa: buf.readUInt32LE(p + 12), bits: buf.readUInt16LE(p + 22) };
    else if (id === 'data') data = buf.subarray(p + 8, Math.min(buf.length, p + 8 + sz));
    p += 8 + sz + (sz & 1);
  }
  if (!fmt || !data) throw new Error('WAV sem fmt/data');
  if (fmt.fmtTag !== 1 && fmt.fmtTag !== 0xFFFE || fmt.bits !== 16) throw new Error(`WAV precisa ser PCM 16 bits (tag=${fmt.fmtTag} bits=${fmt.bits})`);
  return { ...fmt, data };
}

export function montarFsb5({ canais, taxa, data }, nome) {
  if (!(taxa in FREQS)) throw new Error('taxa nao suportada pelo FSB5: ' + taxa);
  if (!(canais in CANAIS)) throw new Error('canais nao suportados: ' + canais);
  const nAmostras = Math.floor(data.length / (2 * canais));
  const hdrSample = 8;
  const nomeBuf = Buffer.from(nome + '\0', 'latin1');
  const tabNomes = al32(4 + nomeBuf.length);
  const tamDados = al32(nAmostras * 2 * canais);
  const out = Buffer.alloc(60 + hdrSample + tabNomes + tamDados);
  out.write('FSB5', 0, 'latin1');
  out.writeUInt32LE(1, 4); out.writeUInt32LE(1, 8); out.writeUInt32LE(hdrSample, 12);
  out.writeUInt32LE(tabNomes, 16); out.writeUInt32LE(tamDados, 20); out.writeUInt32LE(2, 24); out.writeUInt32LE(1, 28);
  const modo = (BigInt(FREQS[taxa]) << 1n) | (BigInt(CANAIS[canais]) << 5n) | (0n << 7n) | (BigInt(nAmostras) << 34n);
  out.writeBigUInt64LE(modo, 60);
  out.writeUInt32LE(4, 68); nomeBuf.copy(out, 72);
  data.copy(out, 60 + hdrSample + tabNomes, 0, nAmostras * 2 * canais);
  return out;
}

if (process.argv[1] && basename(process.argv[1]) === 'wav-para-fsb5.mjs') {
  const [, , ent, sai, nome] = process.argv;
  if (!ent || !sai) { console.error('uso: node wav-para-fsb5.mjs <entrada.wav> <saida.fsb> [nome]'); process.exit(2); }
  const w = lerWav(readFileSync(ent));
  const fsb = montarFsb5(w, nome || basename(sai, extname(sai)));
  writeFileSync(sai, fsb);
  console.log(`OK ${sai} ${w.taxa}Hz ${w.canais}ch ${(w.data.length / 2 / w.canais / w.taxa).toFixed(3)}s ${fsb.length}B`);
}
