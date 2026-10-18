// escrever-sds.mjs - PROTOTIPO F6: substitui um Sound resource dentro de um .sds v19
//
// uso: node escrever-sds.mjs <sds-original> <nome-resource> <novo-fsb5> <sds-saida>
//
// Estrategia (best-effort, sem disassembler completo do layout SDS):
//   1. Carrega SDS original e procura por blocos zlib via findZlibBlocks (reusa logica do extrair-sds.mjs).
//   2. Para cada bloco zlib, descomprime e verifica:
//        * magic interno == 'FSB5'
//        * bytes imediatamente antes do zlib magic tem o padrao de record:
//          u8 nameLen, name[nameLen] ASCII, u32 fileSize LE
//          -> confere que name == nome-resource
//   3. Quando acha: recompacta o record original (nome + tamanho novo + novo FSB5)
//        com zlib (raw, com adler32) e insere no MESMO lugar.
//   4. Todos os blocos zlib vizinhos permanecem intactos. Apenas o zlib escolhido tem
//      tamanho diferente. Como o SDS v19 nao tem tabela de offsets centralizada para
//      cada bloco (offsets sao resolvidos em runtime pelo parser do recurso),
//      isso DEVE funcionar para substituicoes pequenas, mas pode falhar se o SDS tiver
//      checksums por regiao.
//
// Limitacoes conhecidas:
//   * Sem chunks de metadata indireta (refs a sdsNameTable.txt): se o SDS referencia
//     outros arquivos, o writer nao gera essas indiretas.
//   * Sem cifra TEA no header (sdsconfig.bin): se algum SDS for cifrado, nao funciona.
//   * Requer que FmodProbe leia o SDS sem reclamar.
//
import { readFileSync, writeFileSync } from 'node:fs';
import { deflateRawSync, inflateRawSync } from 'node:zlib';

const [,, sdsOrig, resourceName, fsb5NewPath, sdsOut] = process.argv;
if (!sdsOrig || !resourceName || !fsb5NewPath || !sdsOut) {
  console.error('uso: node escrever-sds.mjs <sds> <nome-resource> <novo.fsb5> <sds-out>');
  process.exit(2);
}

const origBuf = readFileSync(sdsOrig);
const fsb5New = readFileSync(fsb5NewPath);
if (fsb5New.subarray(0, 4).toString('latin1') !== 'FSB5') {
  console.error('novo FSB5 sem magic FSB5');
  process.exit(2);
}

if (origBuf.subarray(0, 4).toString('latin1') !== 'SDS\0') {
  console.error('SDS original sem magic SDS');
  process.exit(2);
}

const headerLen = 28;  // SDS v19 header
const recordLen = 96;  // tamanho de record deduzido das notas REA
const ZLIB_MAGIC = 0x789c;  // zlib default; também suporta 0x78 0x01 e 0x78 0xda

// Encontra todos os blocos zlib no buffer
function findZlibBlocks(buf) {
  const blocks = [];
  let i = headerLen;
  while (i < buf.length - 1) {
    // procuro magic zlib (78 01 / 78 9c / 78 da)
    if (buf[i] === 0x78 && (buf[i+1] === 0x01 || buf[i+1] === 0x9c || buf[i+1] === 0xda)) {
      // tenta descomprimir ate 64 KB adiante; refine
      let lo = i + 2, hi = Math.min(buf.length, i + 131072);
      let bestEnd = -1;
      // busca binaria: achar o end correto (sufixo adler32 + 4 B)
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        try {
          const d = inflateRawSync(buf.subarray(i + 2, mid));
          // sucesso; ainda nao sei se mid e o end. incrementa.
          bestEnd = mid;
          lo = mid + 1;
        } catch {
          hi = mid - 1;
        }
      }
      if (bestEnd > 0) {
        // ultimo byte eh o "tipo" do zlib stream (raro); tenta com offset -1 tambem
        for (const end of [bestEnd, bestEnd - 1, bestEnd + 1]) {
          try {
            const d = inflateRawSync(buf.subarray(i + 2, end));
            blocks.push({ start: i, end, payloadSize: d.length, data: d });
            break;
          } catch {}
        }
      }
      i = bestEnd > 0 ? bestEnd : i + 1;
    } else {
      i++;
    }
  }
  return blocks;
}

console.log(`SDS original: ${sdsOrig} (${origBuf.length} B)`);
console.log(`recurso alvo: "${resourceName}"`);
console.log(`novo FSB5:    ${fsb5NewPath} (${fsb5New.length} B)`);

const blocks = findZlibBlocks(origBuf);
console.log(`blocos zlib encontrados: ${blocks.length}`);

// Cada bloco zlib encapsula um "resource record". Layout do record (96 B):
//   [0..7]   ?  (8 B de header do record — pode incluir offset/tipo/tamanho)
//   ?  nameLen (u8), name[nameLen], u32 fileSize, payload FSB5/WAV/etc
//
// Pela logica do extrair-dialogos-mcp.mjs: o FSB5 e precedido por
//   u8 nameLen + name[nameLen] + u32 fileSize.
// Vamos localizar onde comeca o "name" do recurso dentro do payload descomprimido.

let targetBlock = null;
let targetRecordStart = null;
let targetRecordLen = null;
for (const b of blocks) {
  const payload = b.data;
  // procura por 'FSB5' dentro do payload
  let p = 0;
  while (p < payload.length - 4) {
    const idx = payload.indexOf(Buffer.from('FSB5', 'latin1'), p);
    if (idx < 0) break;
    // antes do FSB5, esperamos: u32 fileSize (LE), name[nameLen], u8 nameLen
    if (idx < 5) { p = idx + 1; continue; }
    const fileSizeOffset = idx - 4;
    const fileSize = payload.readUInt32LE(fileSizeOffset);
    if (fileSize !== payload.length - (idx)) {
      // tamanho nao bate; tenta outra hipotese: payload nao-zlib prefix
    }
    // tentar: u8 nameLen em idx - 4 - 4 - nameLen
    for (let nameLen = 0; nameLen < 64; nameLen++) {
      const nameStart = idx - 4 - 4 - nameLen;
      if (nameStart < 0) break;
      const proposedLen = payload[nameStart];
      if (proposedLen !== nameLen) continue;
      const proposedName = payload.subarray(nameStart + 1, nameStart + 1 + nameLen).toString('latin1');
      if (proposedName === resourceName) {
        targetBlock = b;
        targetRecordStart = nameStart;
        targetRecordLen = payload.length - nameStart;
        console.log(`>>> bloco alvo: offset 0x${b.start.toString(16)}, payload ${b.payloadSize} B, FSB5 @ ${idx}, record @ ${nameStart} (len ${targetRecordLen})`);
        break;
      }
    }
    if (targetBlock) break;
    p = idx + 1;
  }
  if (targetBlock) break;
}

if (!targetBlock) {
  console.error(`recurso "${resourceName}" nao encontrado no SDS.`);
  console.log('recursos encontrados nos blocos:');
  for (const b of blocks) {
    const p = b.data;
    let idx = p.indexOf(Buffer.from('FSB5', 'latin1'));
    if (idx < 5) continue;
    const fileSize = p.readUInt32LE(idx - 4);
    const fileEnd = idx + fileSize;
    const nameOffset = idx - 4 - 4;
    if (nameOffset < 0) continue;
    const nameLen = p[nameOffset];
    if (nameLen > 0 && nameLen < 64) {
      const nm = p.subarray(nameOffset + 1, nameOffset + 1 + nameLen).toString('latin1');
      console.log(`  - "${nm}" (fileSize=${fileSize}, payload=${b.payloadSize} B)`);
    }
  }
  process.exit(3);
}

// Reconstrói o record: nameLen + name + fileSize + FSB5
const nameBuf = Buffer.from(resourceName, 'latin1');
const newRecord = Buffer.alloc(1 + nameBuf.length + 4 + fsb5New.length);
newRecord[0] = nameBuf.length;
nameBuf.copy(newRecord, 1);
newRecord.writeUInt32LE(fsb5New.length, 1 + nameBuf.length);
fsb5New.copy(newRecord, 1 + nameBuf.length + 4);

// Substitui dentro do payload descomprimido: region targetRecordStart..end
const targetEnd = targetRecordStart + targetRecordLen;
const newPayload = Buffer.concat([
  targetBlock.data.subarray(0, targetRecordStart),
  newRecord,
  targetBlock.data.subarray(targetEnd),
]);
console.log(`payload: ${targetBlock.data.length} -> ${newPayload.length} (delta ${newPayload.length - targetBlock.data.length})`);

// Compacta o novo payload
// zlib header + raw deflate + adler32
function adler32(buf) {
  let s1 = 1, s2 = 0;
  for (let i = 0; i < buf.length; i++) {
    s1 = (s1 + buf[i]) % 65521;
    s2 = (s2 + s1) % 65521;
  }
  return ((s2 << 16) | s1) >>> 0;
}

const deflated = deflateRawSync(newPayload);
const adler = adler32(newPayload);
const newZlib = Buffer.alloc(2 + deflated.length + 4);
newZlib[0] = 0x78; newZlib[1] = 0x9c;  // zlib header CMF=8 FLG=0x9c
deflated.copy(newZlib, 2);
newZlib.writeUInt32BE(adler, newZlib.length - 4);
console.log(`novo zlib: ${newZlib.length} B (delta ${newZlib.length - (targetBlock.end - targetBlock.start)})`);

// Substitui o bloco zlib antigo pelo novo, mantendo o resto do arquivo
const before = origBuf.subarray(0, targetBlock.start);
const after = origBuf.subarray(targetBlock.end);
const out = Buffer.concat([before, newZlib, after]);
writeFileSync(sdsOut, out);
console.log(`SDS escrito: ${sdsOut} (${out.length} B; delta ${out.length - origBuf.length})`);
console.log(`VALIDACAO MANUAL: rode FmodProbe para abrir ${sdsOut} e verificar se os records estao intactos.`);
