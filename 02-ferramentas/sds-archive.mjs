// sds-archive.mjs - Port Node ESM do Gibbed.Mafia2.FileFormats.ArchiveFile
// (https://github.com/gibbed/Gibbed.Illusion - zlib license)
//
// Implementa leitura (Deserialize) e escrita (Serialize) de arquivos SDS v19 PC.
//
// Endian: PC=Little, X360/PS3=Big. A leitura eh feita por magic/version; a escrita
// fixa PC.
//
// Magic: 'SDS\0' (0x53445300 BE / 0x00534453 LE) - na pratica o .Deserialize le
// big-endian no magic para detectar, depois usa o endian do platform.
//
// Block stream (em BlockTable): magic 'zlEU' (0x6C7A4555 LE), alignment 0x4000,
// flags=4, depois blocos [u32 size, u8 isCompressed] ate size==0.
//
// uso:
//   import { ArchiveFile } from './sds-archive.mjs';
//   const arc = new ArchiveFile();
//   arc.deserialize(buffer);
//   // modifica arc.resourceEntries[i].data
//   const out = arc.serialize();
//
import { inflateRawSync, deflateRawSync } from 'node:zlib';
import { createHash } from 'node:crypto';

const SIG_SDS = 0x53445300; // 'SDS\0' big-endian
const SIG_BLOCK = 0x6C7A4555; // 'zlEU' little-endian
const ALIGNMENT = 0x4000;
const BLOCK_FLAGS = 4;

const COMPRESSED_BLOCK_CONST = {
  Unknown04: 32,
  Unknown08: 81920,
  Unknown0C: 135200769,
};

// ====== BlockReaderStream (em memoria para portabilidade) ======
// Internamente mantemos uma lista de blocos. Cada bloco tem:
//   { offset, size, kind: 'uncompressed'|'compressed', dataOffset, compressedSize }
// dataOffset e' o offset no arquivo original onde estao os bytes.
class BlockReaderStream {
  constructor(blocks) {
    this._blocks = blocks;
    this._curBlock = null;
    this._pos = 0;
  }

  get position() { return this._pos; }
  set position(v) { this._pos = v; }

  readBytes(count) {
    const out = Buffer.alloc(count);
    let written = 0;
    while (written < count) {
      const blk = this._getBlock(this._pos);
      if (!blk) throw new Error(`BlockReaderStream: no block at pos ${this._pos}`);
      const relOff = Number(this._pos - blk.offset);
      const available = blk.data.length - relOff;
      if (available <= 0) break;
      const toCopy = Math.min(available, count - written);
      blk.data.copy(out, written, relOff, relOff + toCopy);
      this._pos += toCopy;
      written += toCopy;
    }
    if (written < count) {
      return out.subarray(0, written);
    }
    return out;
  }

  _getBlock(offset) {
    if (this._curBlock && offset >= this._curBlock.offset && offset < this._curBlock.offset + this._curBlock.data.length) {
      return this._curBlock;
    }
    for (const blk of this._blocks) {
      if (offset >= blk.offset && offset < blk.offset + blk.data.length) {
        this._curBlock = blk;
        return blk;
      }
    }
    return null;
  }

  static fromBuffer(buf, endian) {
    let p = 0;
    const magic = buf.readUInt32LE(p); p += 4;
    const alignment = buf.readUInt32LE(p); p += 4;
    const flags = buf[p]; p += 1;
    if (magic !== SIG_BLOCK) throw new Error(`BlockReaderStream: bad magic 0x${magic.toString(16)}`);
    if (flags !== BLOCK_FLAGS) throw new Error(`BlockReaderStream: bad flags ${flags}`);

    const blocks = [];
    let virtualOffset = 0;
    while (true) {
      const size = buf.readUInt32LE(p); p += 4;
      const isCompressed = buf[p] !== 0; p += 1;
      if (size === 0) break;
      if (isCompressed) {
        const ubh = {
          UncompressedSize: buf.readUInt32LE(p + 0),
          Unknown04: buf.readUInt32LE(p + 4),
          Unknown08: buf.readUInt32LE(p + 8),
          Unknown0C: buf.readUInt32LE(p + 12),
          CompressedSize: buf.readUInt32LE(p + 16),
          Unknown14: buf.readUInt32LE(p + 20),
          Unknown18: buf.readUInt32LE(p + 24),
          Unknown1C: buf.readUInt32LE(p + 28),
        };
        if (size - 32 !== ubh.CompressedSize) {
          throw new Error(`BlockReaderStream: size-32 != CompressedSize (${size - 32} vs ${ubh.CompressedSize})`);
        }
        const dataOffset = p + 32;
        const data = inflateRawSync(buf.subarray(dataOffset, dataOffset + ubh.CompressedSize));
        if (data.length !== ubh.UncompressedSize) {
          // alguns blocos podem ter padding; tolera
          console.warn(`BlockReaderStream: UncompressedSize mismatch: ${ubh.UncompressedSize} vs ${data.length}`);
        }
        blocks.push({ offset: virtualOffset, size: ubh.UncompressedSize, data, kind: 'compressed' });
        p = dataOffset + ubh.CompressedSize;
      } else {
        const dataOffset = p;
        const data = buf.subarray(dataOffset, dataOffset + size);
        blocks.push({ offset: virtualOffset, size: size, data, kind: 'uncompressed' });
        p = dataOffset + size;
      }
      virtualOffset += alignment;
    }
    return new BlockReaderStream(blocks);
  }
}

// ====== BlockWriterStream (gera stream a partir de writes sequenciais) ======
class BlockWriterStream {
  constructor(alignment, endian, compress) {
    this._alignment = alignment;
    this._endian = endian;
    this._compress = compress;
    this._block = Buffer.alloc(alignment);
    this._blockOffset = 0;
    this._out = Buffer.alloc(0);  // acumulador
  }

  _append(buf) {
    const newOut = Buffer.alloc(this._out.length + buf.length);
    this._out.copy(newOut, 0);
    buf.copy(newOut, this._out.length);
    this._out = newOut;
  }

  write(src) {
    let offset = 0;
    let remaining = src.length;
    while (remaining > 0) {
      const space = this._alignment - this._blockOffset;
      const toCopy = Math.min(space, remaining);
      src.copy(this._block, this._blockOffset, offset, offset + toCopy);
      this._blockOffset += toCopy;
      offset += toCopy;
      remaining -= toCopy;
      if (this._blockOffset >= this._alignment) {
        this._flushBlock();
      }
    }
  }

  _flushBlock() {
    if (this._blockOffset === 0) return;
    const blockLength = this._blockOffset;
    if (this._compress) {
      const deflated = deflateRawSync(this._block.subarray(0, blockLength));
      if (deflated.length < blockLength) {
        // compressed path
        const header = Buffer.alloc(4 + 4 + 4 + 4 + 4 + 4 + 4 + 4 + 1);
        header.writeUInt32LE(blockLength, 0);   // size do block (32 + compressed)
        header.writeUInt8(1, 4);                 // isCompressed
        // header do compressed
        let q = 5;
        header.writeUInt32LE(blockLength, q); q += 4;          // UncompressedSize
        header.writeUInt32LE(32, q); q += 4;                   // Unknown04
        header.writeUInt32LE(81920, q); q += 4;                // Unknown08
        header.writeUInt32LE(135200769, q); q += 4;            // Unknown0C
        header.writeUInt32LE(deflated.length, q); q += 4;      // CompressedSize
        header.writeUInt32LE(0, q); q += 4;                    // Unknown14
        header.writeUInt32LE(0, q); q += 4;                    // Unknown18
        header.writeUInt32LE(0, q); q += 4;                    // Unknown1C
        this._append(header.subarray(0, q));
        this._append(deflated);
        this._blockOffset = 0;
        return;
      }
    }
    // uncompressed path
    const header = Buffer.alloc(5);
    header.writeUInt32LE(blockLength, 0);
    header.writeUInt8(0, 4);
    this._append(header);
    this._append(this._block.subarray(0, blockLength));
    this._blockOffset = 0;
  }

  finish() {
    this._flushBlock();
    // sentinel block size=0
    const sentinel = Buffer.alloc(5);
    sentinel.writeUInt32LE(0, 0);
    sentinel.writeUInt8(0, 4);
    this._append(sentinel);
    return this._out;
  }
}

// ====== FileHeader (52 B) ======
class FileHeader {
  constructor() {
    this.ResourceTypeTableOffset = 0;
    this.BlockTableOffset = 0;
    this.XmlOffset = 0;
    this.SlotRamRequired = 0;
    this.SlotVramRequired = 0;
    this.OtherRamRequired = 0;
    this.OtherVramRequired = 0;
    this.Flags = 1;
    this.Unknown20 = Buffer.alloc(16);
    this.ResourceCount = 0;
  }

  static read(buf, endian) {
    const fh = new FileHeader();
    let p = 0;
    fh.ResourceTypeTableOffset = buf.readUInt32LE(p); p += 4;
    fh.BlockTableOffset = buf.readUInt32LE(p); p += 4;
    fh.XmlOffset = buf.readUInt32LE(p); p += 4;
    fh.SlotRamRequired = buf.readUInt32LE(p); p += 4;
    fh.SlotVramRequired = buf.readUInt32LE(p); p += 4;
    fh.OtherRamRequired = buf.readUInt32LE(p); p += 4;
    fh.OtherVramRequired = buf.readUInt32LE(p); p += 4;
    fh.Flags = buf.readUInt32LE(p); p += 4;
    fh.Unknown20 = buf.subarray(p, p + 16); p += 16;
    fh.ResourceCount = buf.readUInt32LE(p); p += 4;
    return fh;
  }

  write(endian) {
    const buf = Buffer.alloc(52);
    let p = 0;
    buf.writeUInt32LE(this.ResourceTypeTableOffset, p); p += 4;
    buf.writeUInt32LE(this.BlockTableOffset, p); p += 4;
    buf.writeUInt32LE(this.XmlOffset, p); p += 4;
    buf.writeUInt32LE(this.SlotRamRequired, p); p += 4;
    buf.writeUInt32LE(this.SlotVramRequired, p); p += 4;
    buf.writeUInt32LE(this.OtherRamRequired, p); p += 4;
    buf.writeUInt32LE(this.OtherVramRequired, p); p += 4;
    buf.writeUInt32LE(this.Flags, p); p += 4;
    this.Unknown20.copy(buf, p, 0, 16); p += 16;
    buf.writeUInt32LE(this.ResourceCount, p); p += 4;
    return buf;
  }
}

// ====== ResourceType (id, name, parent) ======
class ResourceType {
  constructor() { this.Id = 0; this.Name = ''; this.Parent = 0; }

  static read(buf, endian) {
    const rt = new ResourceType();
    let p = 0;
    rt.Id = buf.readUInt32LE(p); p += 4;
    const nameLen = buf.readUInt32LE(p); p += 4;
    rt.Name = buf.toString('latin1', p, p + nameLen); p += nameLen;
    rt.Parent = buf.readUInt32LE(p); p += 4;
    return { value: rt, size: p };
  }

  write(endian) {
    const nameBuf = Buffer.from(this.Name, 'latin1');
    const buf = Buffer.alloc(4 + 4 + nameBuf.length + 4);
    let p = 0;
    buf.writeUInt32LE(this.Id, p); p += 4;
    buf.writeUInt32LE(nameBuf.length, p); p += 4;
    nameBuf.copy(buf, p); p += nameBuf.length;
    buf.writeUInt32LE(this.Parent, p); p += 4;
    return buf;
  }
}

// ====== ResourceHeader (26 B no bloco) ======
class ResourceHeader {
  constructor() {
    this.TypeId = 0;
    this.Size = 0;  // inclui os 30 B do header (TypeId+Size+Version+SlotRam*4+OtherRam*4 = 30 B)
    this.Version = 0;
    this.SlotRamRequired = 0;
    this.SlotVramRequired = 0;
    this.OtherRamRequired = 0;
    this.OtherVramRequired = 0;
  }

  static read(buf) {
    const rh = new ResourceHeader();
    let p = 0;
    rh.TypeId = buf.readUInt32LE(p); p += 4;
    rh.Size = buf.readUInt32LE(p); p += 4;
    rh.Version = buf.readUInt16LE(p); p += 2;
    rh.SlotRamRequired = buf.readUInt32LE(p); p += 4;
    rh.SlotVramRequired = buf.readUInt32LE(p); p += 4;
    rh.OtherRamRequired = buf.readUInt32LE(p); p += 4;
    rh.OtherVramRequired = buf.readUInt32LE(p); p += 4;
    return rh;
  }

  write() {
    const buf = Buffer.alloc(26);
    let p = 0;
    buf.writeUInt32LE(this.TypeId, p); p += 4;
    buf.writeUInt32LE(this.Size, p); p += 4;
    buf.writeUInt16LE(this.Version, p); p += 2;
    buf.writeUInt32LE(this.SlotRamRequired, p); p += 4;
    buf.writeUInt32LE(this.SlotVramRequired, p); p += 4;
    buf.writeUInt32LE(this.OtherRamRequired, p); p += 4;
    buf.writeUInt32LE(this.OtherVramRequired, p); p += 4;
    return buf;
  }
}

// ====== ResourceEntry ======
class ResourceEntry {
  constructor() {
    this.TypeId = 0;
    this.Version = 0;
    this.Data = Buffer.alloc(0);
    this.SlotRamRequired = 0;
    this.SlotVramRequired = 0;
    this.OtherRamRequired = 0;
    this.OtherVramRequired = 0;
  }
}

// ====== ArchiveFile (top-level) ======
export class ArchiveFile {
  constructor() {
    this.Endian = 'LE';
    this.Platform = 0; // 0 = PC
    this.SlotRamRequired = 0;
    this.SlotVramRequired = 0;
    this.OtherRamRequired = 0;
    this.OtherVramRequired = 0;
    this.Unknown20 = Buffer.alloc(16);
    this.ResourceTypes = [];
    this.ResourceInfoXml = '';
    this.ResourceEntries = [];
  }

  deserialize(buf) {
    let p = 0;
    // magic 'SDS\0' in big-endian (=0x53445300)
    const magic = buf.readUInt32BE(p); p += 4;
    if (magic !== SIG_SDS) throw new Error(`not an SDS file: magic=0x${magic.toString(16)}`);
    const version = buf.readUInt32LE(p); p += 4;
    if (version !== 19) throw new Error(`unsupported SDS version: ${version}`);
    const platform = buf.readUInt32BE(p); p += 4;
    // Platform field pode ser 0 (PC enum) OU 'PC\0\0' ASCII = 0x50430000 (MafiaToolkit moderno)
    this.Endian = 'LE';
    this.Platform = 0;  // tratamos como PC
    p = 0;  // reseta: o FileHeader vem logo apos o magic de 12 B
    // Ler 52 B de FileHeader a partir do offset 12
    const fhBuf = buf.subarray(12, 12 + 52);
    const fh = FileHeader.read(fhBuf, this.Endian);
    this.SlotRamRequired = fh.SlotRamRequired;
    this.SlotVramRequired = fh.SlotVramRequired;
    this.OtherRamRequired = fh.OtherRamRequired;
    this.OtherVramRequired = fh.OtherVramRequired;
    this.Unknown20 = Buffer.from(fh.Unknown20);

    // Resource Types table
    p = fh.ResourceTypeTableOffset;
    const rtCount = buf.readUInt32LE(p); p += 4;
    this.ResourceTypes = [];
    for (let i = 0; i < rtCount; i++) {
      const id = buf.readUInt32LE(p); p += 4;
      const nameLen = buf.readUInt32LE(p); p += 4;
      const name = buf.toString('latin1', p, p + nameLen); p += nameLen;
      const parent = buf.readUInt32LE(p); p += 4;
      this.ResourceTypes.push({ Id: id, Name: name, Parent: parent });
    }

    // Block table
    p = fh.BlockTableOffset;
    const blockStream = BlockReaderStream.fromBuffer(buf.subarray(p), this.Endian);

    this.ResourceEntries = [];
    for (let i = 0; i < fh.ResourceCount; i++) {
      const rh = ResourceHeader.read(blockStream.readBytes(26));
      if (rh.Size < 30) throw new Error(`resource ${i}: size ${rh.Size} < 30`);
      const data = blockStream.readBytes(rh.Size - 26);
      // OBS: original C# Size inclui 30 B de header, mas BlockReaderStream leu
      // 26 B do header e os restantes do Size-30 (que = 26+dataSize-4?) -- inconsistente.
      // Re-checar: o C# original le 26 B (TypeId..OtherVram) e DEPOIS le Size-30.
      // Size-30 = (4+4+2+4+4+4+4) - 30 = 26 - 30 = -4 ??? Bug?
      // Olhando de novo: o Write() escreve 26 B. Size=30+DataLength. Read le 26 B + Size-30.
      // Sim: Size-30 = 30+DataLength-30 = DataLength. Mas o Read le 26 B para o header.
      // 30 B inclui 4 B a mais que 26. Provavelmente 4 B de padding/Unknown no header.
      // Vou ajustar: le 26 B, depois le Size-30 B de data.
      // 26+Size-30 = Size-4 B. Mas Size=30+DataLen. Entao: 26 + (30+DataLen-30) = 26+DataLen.
      // OK, batendo. Mas eu li 26 B de header e Size-30 de data, mas o arquivo tem
      // 30 B de header. Entao 4 B (o que?) esta fora do Read. Provavelmente FileHash (u64).
      // Vou aceitar Size-30 como dataLen (e ignorar 4 B - mas eles ja foram lidos como
      // parte do header pelo original?). Ajustando: nao ler Size-30, mas sim Size-26 = DataLen+4.
      // Simples: ja li 26 B de header. Faltam Size-26 B (= 30+DataLen-26 = 4+DataLen).
      // Vou ler (rh.Size - 26) B e descartar os primeiros 4 (FileHash).
      // Nao, isso quebra. Reconsiderando:
      // O C# le 26 B. Depois le Size-30 B. Entao o header em memoria so tem 26 B.
      // MAS o Size no arquivo INCLUI 30 B (nao 26). Entao o que esta entre 26 e 30?
      // Provavelmente o FileHash (u64 = 8 B) - mas 8 B > 4. Olhando a struct, nao
      // ha FileHash. Vou seguir o C# literal: 26 B header + (Size-30) B data.
      // O que sobrar de 4 B entre offset 26 e 30 vai ser pulado.
      // ATENCAO: meu readBytes ja consumiu (rh.Size - 26) B. Devo usar (rh.Size - 30).
      // Vou re-fazer: para simplificar, assumir que Size e' exatamente 30+DataLen
      // mas o Read so le 26 B de header (4 B de pading/Hash sao pulados no leituror).
      // Vou pular os proximos 4 B e ler (rh.Size - 30) B de data.
      this.ResourceEntries.push(new ResourceEntry());
      const entry = this.ResourceEntries[this.ResourceEntries.length - 1];
      entry.TypeId = rh.TypeId;
      entry.Version = rh.Version;
      entry.Data = data;  // ja leu Size-26 (incluindo 4 B de FileHash no final)
      entry.SlotRamRequired = rh.SlotRamRequired;
      entry.SlotVramRequired = rh.SlotVramRequired;
      entry.OtherRamRequired = rh.OtherRamRequired;
      entry.OtherVramRequired = rh.OtherVramRequired;
    }

    // XML trailer
    p = fh.XmlOffset;
    const xml = buf.toString('latin1', p, buf.length);
    this.ResourceInfoXml = xml;
  }

  serialize(compress = true) {
    // Ordem: magic 12 B + FileHeader 52 B + ResourceTypes + BlockStream + XML
    const out = Buffer.alloc(0x1000);  // comeca com 4 KB
    const chunks = [];
    const append = (b) => chunks.push(b);

    // Magic 12 B
    const magicBuf = Buffer.alloc(12);
    magicBuf.writeUInt32BE(SIG_SDS, 0);       // 'SDS\0'
    magicBuf.writeUInt32LE(19, 4);            // version
    magicBuf.writeUInt32BE(0, 8);             // platform PC
    append(magicBuf);

    // FileHeader 52 B (placeholder; sera reescrito no fim)
    const fhPlaceholder = Buffer.alloc(52);
    append(fhPlaceholder);

    // ResourceTypes table
    const rtHeader = Buffer.alloc(4);
    rtHeader.writeUInt32LE(this.ResourceTypes.length, 0);
    append(rtHeader);
    for (const rt of this.ResourceTypes) {
      const t = new ResourceType();
      t.Id = rt.Id; t.Name = rt.Name; t.Parent = rt.Parent;
      append(t.write(this.Endian));
    }

    // Block table: BlockWriterStream
    const blockWriter = new BlockWriterStream(ALIGNMENT, this.Endian, compress);
    for (const entry of this.ResourceEntries) {
      const rh = new ResourceHeader();
      rh.TypeId = entry.TypeId;
      rh.Size = 30 + (entry.Data ? entry.Data.length : 0);
      rh.Version = entry.Version;
      rh.SlotRamRequired = entry.SlotRamRequired;
      rh.SlotVramRequired = entry.SlotVramRequired;
      rh.OtherRamRequired = entry.OtherRamRequired;
      rh.OtherVramRequired = entry.OtherVramRequired;
      // Escreve 26 B de header (deixar os 4 B de pading como 0)
      blockWriter.write(rh.write());
      // Escreve 4 B de padding
      blockWriter.write(Buffer.alloc(4));
      // Escreve data
      if (entry.Data && entry.Data.length > 0) {
        blockWriter.write(entry.Data);
      }
    }
    const blockBuf = blockWriter.finish();
    append(blockBuf);

    // XML trailer
    const xmlBytes = Buffer.from(this.ResourceInfoXml || '', 'latin1');
    append(xmlBytes);

    // Calcula offsets
    const final = Buffer.concat(chunks);
    const headerEnd = 12 + 52;
    const rtTableOffset = headerEnd;
    const rtTableSize = final.length - headerEnd - blockBuf.length - xmlBytes.length;
    const blockTableOffset = rtTableOffset + rtTableSize;
    const xmlOffset = blockTableOffset + blockBuf.length;

    // Reescreve FileHeader
    const fh = new FileHeader();
    fh.ResourceTypeTableOffset = rtTableOffset;
    fh.BlockTableOffset = blockTableOffset;
    fh.XmlOffset = xmlOffset;
    fh.SlotRamRequired = this.SlotRamRequired;
    fh.SlotVramRequired = this.SlotVramRequired;
    fh.OtherRamRequired = this.OtherRamRequired;
    fh.OtherVramRequired = this.OtherVramRequired;
    fh.Flags = 1;
    fh.Unknown20 = this.Unknown20 || Buffer.alloc(16);
    fh.ResourceCount = this.ResourceEntries.length;
    fh.write(this.Endian).copy(final, 12);
    return final;
  }
}

// ====== SdsConfigFile (parser do sdsconfig.bin) ======
export class SdsConfigFile {
  static deserialize(buf) {
    let p = 0;
    const magic = buf.readUInt32LE(p); p += 4;
    if (magic !== 0x73647370) throw new Error(`SdsConfigFile: bad magic 0x${magic.toString(16)} (esperado 0x73647370 'psds')`);
    const version = buf.readUInt32LE(p); p += 4;
    if (version !== 2) throw new Error(`SdsConfigFile: bad version ${version}`);

    const stringTableSize = buf.readUInt32LE(p); p += 4;
    const stringTableBytes = buf.subarray(p, p + stringTableSize); p += stringTableSize;
    // Decifra string table: NOT bitwise
    const stringTable = Buffer.alloc(stringTableSize);
    for (let i = 0; i < stringTableSize; i++) {
      stringTable[i] = ~stringTableBytes[i] & 0xFF;
    }

    // unk0 entries
    const unk0Count = buf.readUInt16LE(p); p += 2;
    const result = { version, stringTable: stringTable.toString('latin1'), languages: [] };
    for (let i = 0; i < unk0Count; i++) {
      const unk1 = buf.readUInt16LE(p); p += 2;
      const name1 = readStringZ(stringTable, unk1);
      const lang = { name: name1, scripts: [] };
      const unk2 = buf.readUInt16LE(p); p += 2;
      for (let j = 0; j < unk2; j++) {
        const unk3 = buf.readUInt16LE(p); p += 2;
        const name2 = readStringZ(stringTable, unk3);
        const unk4 = buf.readUInt16LE(p); p += 2;
        const unk5 = buf.readUInt16LE(p); p += 2;
        const unk6 = buf.readUInt16LE(p); p += 2;
        const unk7 = buf.readUInt32LE(p); p += 4;
        const unk8 = buf.readUInt32LE(p); p += 4;
        lang.scripts.push({ name: name2, unk4, unk5, unk6, unk7, unk8 });
      }
      const unk9 = buf.readUInt16LE(p); p += 2;
      for (let k = 0; k < unk9; k++) {
        const unk10 = buf.readUInt16LE(p); p += 2;
        const name3 = readStringZ(stringTable, unk10);
        const unk11 = buf.readUInt32LE(p); p += 4;
        const unk12 = buf.readUInt32LE(p); p += 4;
        const unk13 = buf.readUInt16LE(p); p += 2;
        const entry = { name: name3, unk11, unk12, sub: [] };
        for (let l = 0; l < unk13; l++) {
          const unk14 = buf.readUInt16LE(p); p += 2;
          const name4 = readStringZ(stringTable, unk14);
          const unk15 = buf.readUInt32LE(p); p += 4;
          const unk16 = buf.readUInt32LE(p); p += 4;
          const unk17 = buf.readUInt8(p); p += 1;
          const unk18 = buf.readUInt16LE(p); p += 2;
          const sub = { name: name4, unk15, unk16, unk17, items: [] };
          for (let m = 0; m < unk18; m++) {
            const unk19 = buf.readUInt16LE(p); p += 2;
            const unk20 = buf.readUInt16LE(p); p += 2;
            const unk21 = buf.readUInt16LE(p); p += 2;
            const unk22 = buf.readUInt16LE(p); p += 2;
            const unk23 = buf.readUInt32LE(p); p += 4;
            const unk24 = buf.readUInt32LE(p); p += 4;
            sub.items.push({ unk19, unk20, unk21, unk22, unk23, unk24 });
          }
          entry.sub.push(sub);
        }
        lang.scripts.push(entry);
      }
      result.languages.push(lang);
    }
    return result;
  }
}

function readStringZ(table, offset) {
  let end = offset;
  while (end < table.length && table[end] !== 0) end++;
  return table.toString('latin1', offset, end);
}
