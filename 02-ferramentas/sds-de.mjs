// sds-de.mjs - Leitor de SDS Mafia II Definitive Edition (formato proprio, diferente do Gibbed).
//
// Layout do header (0x00-0x3B):
//   0x00-0x03: 'SDS\0' magic
//   0x04-0x07: version 19 (u32 LE)
//   0x08-0x0B: platform 'PC\0\0' (u32 BE = 0x50430000)
//   0x0C-0x0F: secondary magic 0x5FFB74F3 (fixo em v19 PC, M2DE)
//   0x10-0x13: n_slots (u32 LE) - slots pre-alocados
//   0x14-0x17: strTblSize (u32 LE)
//   0x18-0x1B: dataOff (u32 LE) - offset do XML trailer
//   0x1C-0x1F: recOff (u32 LE) - offset do primeiro record
//   0x20-0x3B: 28 B reservados (flags/metadata)
//
// Layout do record (96 B hipotetico):
//   u32  type
//   u32  size
//   u16  version
//   u32  slotRamRequired
//   u32  slotVramRequired
//   u32  otherRamRequired
//   u32  otherVramRequired
//   u32  flags
//   u8[16]  unknown20
//   ...  mais campos
//   data (compactado zlib ou raw)
//
// O que ja foi testado:
//   - apdcivblack_a1.sds (328 KB): 2 sound sectors com payload zlib
//   - dlc02_sounds01.sds (497 KB): 0 sound sectors, so metadata
//
// Este modulo foca em:
//   1. Ler o header
//   2. Localizar os records (entre 0x3C e dataOff)
//   3. Para cada record, identificar se tem payload zlib e extrair
//
import { inflateRawSync } from 'node:zlib';

export class SdsDeFile {
  constructor() {
    this.magic = '';
    this.version = 0;
    this.platform = 0;
    this.secondaryMagic = 0;
    this.nSlots = 0;
    this.strTblSize = 0;
    this.dataOff = 0;
    this.recOff = 0;
    this.xml = '';
    this.records = [];
  }

  static deserialize(buf) {
    const f = new SdsDeFile();
    f.magic = buf.toString('latin1', 0, 4);
    f.version = buf.readUInt32LE(4);
    f.platform = buf.readUInt32BE(8);
    f.secondaryMagic = buf.readUInt32LE(0x0C);
    f.nSlots = buf.readUInt32LE(0x10);
    f.strTblSize = buf.readUInt32LE(0x14);
    f.dataOff = buf.readUInt32LE(0x18);
    f.recOff = buf.readUInt32LE(0x1C);
    f.xml = buf.toString('latin1', f.dataOff, buf.length);

    // Percorre do recOff ate dataOff procurando records
    // Heuristica: records comeca com 4 bytes de type, 4 bytes de size, etc.
    // Zlib blocks sao identificados por magic 0x789c / 0x7801 / 0x78da.
    let p = 0x3C;
    let slotIdx = 0;
    while (p < f.dataOff && p < buf.length - 1) {
      // Procura proximo zlib magic a partir de p
      let zpos = -1;
      for (let i = p; i < buf.length - 1; i++) {
        if (buf[i] === 0x78 && (buf[i+1] === 0x9c || buf[i+1] === 0x01 || buf[i+1] === 0xda)) {
          // Tenta descompactar ate 16 KB
          try {
            const d = inflateRawSync(buf.subarray(i, Math.min(buf.length, i + 16384)));
            if (d.length >= 256) { zpos = i; break; }
          } catch {}
        }
      }
      if (zpos < 0) break;

      // Acha o fim do zlib block
      let end = -1;
      let bestEnd = -1;
      for (let e = zpos + 2; e < Math.min(buf.length, zpos + 1024 * 1024); e++) {
        try {
          inflateRawSync(buf.subarray(zpos + 2, e));
          bestEnd = e;
        } catch {}
        if (e > bestEnd + 16) break;  // ja passou
      }
      if (bestEnd > 0) {
        const payload = inflateRawSync(buf.subarray(zpos + 2, bestEnd));
        f.records.push({
          slot: slotIdx++,
          type: 'unknown',
          zlibOff: zpos,
          zlibEnd: bestEnd,
          payloadSize: payload.length,
          payload,
        });
        p = bestEnd;
      } else {
        p = zpos + 1;
      }
    }
    return f;
  }
}
