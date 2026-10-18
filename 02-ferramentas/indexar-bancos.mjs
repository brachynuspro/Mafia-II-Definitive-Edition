// Indexa todos os bancos de voz: arquivo .sds -> recurso -> caminho #Dabing -> formato
// Nao decodifica audio; apenas le o cabecalho FSB5 de cada recurso Sound.
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { join, relative } from 'node:path';

const URL_ = process.argv[2];
const OUT = process.argv[3];
const roots = process.argv.slice(4);
mkdirSync(OUT, { recursive: true });

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.toLowerCase().endsWith('.sds')) out.push(p);
  }
  return out;
}

const HDRS = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
let SID = null;
async function rpc(method, params) {
  const h = { ...HDRS };
  if (SID) h['mcp-session-id'] = SID;
  const r = await fetch(URL_, { method: 'POST', headers: h, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  SID = r.headers.get('mcp-session-id') || SID;
  const t = await r.text();
  const line = t.split('\n').find(l => l.startsWith('data:'));
  const j = JSON.parse(line ? line.slice(5).trim() : t);
  if (j.error) throw new Error(j.error.message);
  if (method !== 'tools/call') return j;
  return JSON.parse(j.result.content[0].text);
}
const tool = (name, args) => rpc('tools/call', { name, arguments: args });

const CODEC = { 0: 'NONE', 1: 'PCM8', 2: 'PCM16', 3: 'PCM24', 4: 'PCM32', 5: 'PCMFLOAT', 6: 'GCADPCM', 7: 'IMAADPCM', 8: 'VAG', 9: 'HEVAG', 10: 'XMA', 11: 'MPEG', 12: 'CELT', 13: 'AT9', 14: 'XWMA', 15: 'VORBIS', 16: 'FADPCM', 17: 'OPUS' };
const FREQ = [0, 8000, 11000, 11025, 16000, 22050, 24000, 32000, 44100, 48000, 96000];

function parseF5(buf) {
  const off = buf.indexOf(Buffer.from('FSB5', 'latin1'));
  if (off < 0 || off > 512) return null;
  const zero = buf.indexOf(0, off);
  const path = buf.toString('latin1', 0, zero);
  const u = (o) => buf.readUInt32LE(off + o);
  const mode = u(0x18);
  return {
    caminho: path.replace(/^#/, ''),
    codec: CODEC[mode & 0x1f] || ('?' + (mode & 0x1f)),
    canais: (mode >> 5) & 0x3,
    freqIdx: (mode >> 9) & 0xf,
    amostras: u(8),
    dataSize: u(0x14),
    nome: buf.toString('latin1', off + 0x3c + u(0x10), off + 0x3c + u(0x10) + u(0x10)).replace(/\0/g, '|'),
  };
}

await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'idx', version: '1' } });
await fetch(URL_, { method: 'POST', headers: { ...HDRS, 'mcp-session-id': SID }, body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) });

const files = roots.flatMap(r => { try { return walk(r); } catch { return []; } });
console.log(`arquivos .sds: ${files.length}`);
const rows = [];
let snd = 0, semF5 = 0, erros = 0;
for (let i = 0; i < files.length; i++) {
  const f = files[i];
  try {
    const info = await tool('open_sds_file', { filePath: f, gameType: 'MafiaII_DE' });
    if (!info.success) { erros++; continue; }
    const snds = (info.resources || []).filter(r => r.typeName === 'Sound' || r.typeName === 'Speech');
    for (const s of snds) {
      const ex = await tool('extract_resource', { filePath: f, resourceIndex: s.index, maxBytes: 4194304 });
      if (!ex.success) continue;
      const buf = Buffer.from(ex.data ?? '', 'base64');
      const p = parseF5(buf);
      if (!p) { semF5++; continue; }
      rows.push({ sds: relative(roots[0], f), idx: s.index, ...p, freq: FREQ[p.freqIdx] || p.freqIdx });
      snd++;
    }
  } catch { erros++; }
  if ((i + 1) % 100 === 0) console.log(`  ${i + 1}/${files.length} bancos=${snd}`);
}
const cols = ['sds', 'idx', 'caminho', 'nome', 'codec', 'canais', 'freq', 'freqIdx', 'amostras', 'dataSize'];
writeFileSync(join(OUT, 'bancos-voz.csv'), '\ufeff' + [cols.join(';')].concat(rows.map(r => cols.map(c => `"${r[c] ?? ''}"`).join(';'))).join('\n'), 'utf8');
console.log(`\nbancos indexados: ${snd} | sem FSB5: ${semF5} | erros de arquivo: ${erros}`);
const byCodec = new Map();
for (const r of rows) byCodec.set(`${r.codec} ${r.canais === 1 ? 'mono' : 'stereo'}`, (byCodec.get(`${r.codec} ${r.canais === 1 ? 'mono' : 'stereo'}`) || 0) + 1);
console.log('\n=== formatos ===');
for (const [k, v] of [...byCodec].sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(6)}  ${k}`);
const byFolder = new Map();
for (const r of rows) { const s = r.sds.split('\\')[0]; byFolder.set(s, (byFolder.get(s) || 0) + 1); }
console.log('\n=== por subpasta ===');
for (const [k, v] of [...byFolder].sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(6)}  ${k}`);
console.log('\n=== amostra ===');
rows.slice(0, 5).forEach(r => console.log('  ' + JSON.stringify(r)));