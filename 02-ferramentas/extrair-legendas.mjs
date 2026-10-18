// Extrai as tabelas de legenda (recurso MemFile) de todos os .sds via MafiaToolkit MCP.
// Formato da linha: <slot_id>:<personagem>:<texto>
import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync } from 'node:fs';
import { join, basename, relative } from 'node:path';

const URL_ = process.argv[2];
const OUT = process.argv[3];
const NAME = process.argv[4];
const roots = process.argv.slice(5);
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
  const text = await r.text();
  const line = text.split('\n').find(l => l.startsWith('data:'));
  const j = JSON.parse(line ? line.slice(5).trim() : text);
  if (j.error) throw new Error(j.error.message);
  if (method !== 'tools/call') return j;
  if (!j.result?.content) throw new Error('resposta sem content: ' + text.slice(0, 200));
  return JSON.parse(j.result.content[0].text);
}
async function tool(name, args) { return rpc('tools/call', { name, arguments: args }); }

await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'batch', version: '1.0' } });
await fetch(URL_, { method: 'POST', headers: { ...HDRS, 'mcp-session-id': SID }, body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) });

const files = roots.flatMap((r) => {
  // "@lista.txt" = lista de caminhos, um por linha (a linha de comando do Windows tem limite)
  if (r.startsWith('@')) return readFileSync(r.slice(1), 'utf8').split(/\r?\n/).filter(Boolean);
  try { return walk(r); } catch { return []; }
});
console.log(`arquivos .sds: ${files.length}`);

const rows = [];
let ok = 0, semMemFile = 0, erros = 0, fala = 0,shown = 0;
for (let i = 0; i < files.length; i++) {
  const f = files[i];
  try {
    const info = await tool('open_sds_file', { filePath: f, gameType: 'MafiaII_DE' });
    if (!info.success) { erros++; if (shown++ < 2) console.log('ERRO open:', f, JSON.stringify(info).slice(0, 300)); continue; }
    const memIdx = (info.resources || []).filter(r => r.typeName === 'MemFile').map(r => r.index);
    if (!memIdx.length) { semMemFile++; continue; }
    for (const idx of memIdx) {
      const ex = await tool('extract_resource', { filePath: f, resourceIndex: idx, maxBytes: 4 * 1024 * 1024 });
      if (!ex.success) { erros++; if (shown++ < 4) console.log('ERRO extract:', f, JSON.stringify(ex).slice(0, 300)); continue; }
      const buf = Buffer.from(ex.data ?? ex.dataBase64 ?? ex.content ?? '', 'base64');
      // o recurso tem um mini-header: [u32 len][caminho][u32 ?][u32 dataLen][BOM UTF-8][texto]
      const bom = buf.indexOf(Buffer.from([0xef, 0xbb, 0xbf]));
      if (bom === -1) { continue; }
      const txt = buf.toString('utf8', bom + 3);
      const rel = relative(roots[0] || '.', f);
      for (const raw of txt.split(/\r?\n/)) {
        const t = raw.trim();
        const m = /^([0-9][0-9_]{5,15}):([\s\S]*)$/.exec(t);
        if (!m) continue;
        let slot = m[1], rest = m[2], personagem = '';
        // formato "slot:personagem:texto" quando existe um segundo ':' curto e sem pontuacao final
        const sp = /^([^:]{1,40}):\s*([\s\S]+)$/.exec(rest);
        if (sp && !/[,.!?;]\s*$/.test(sp[1])) { personagem = sp[1].trim(); rest = sp[2]; }
        // codigo curto de orador no inicio do texto, ex.: "n_Kto to jest..."
        else if (/^[A-Za-z]{1,3}_/.test(rest)) { personagem = rest.slice(0, rest.indexOf('_') + 1); rest = rest.slice(personagem.length); }
        rows.push({ sds: rel, slot, personagem, texto: rest });
        fala++;
      }
      ok++;
    }
  } catch (e) { erros++; if (shown++ < 4) console.log('EXC:', f, String(e).slice(0, 140)); }
  if ((i + 1) % 50 === 0) console.log(`  ${i + 1}/${files.length}  falas=${fala}`);
}

const cols = ['sds', 'slot', 'personagem', 'texto'];
const csv = [cols.join(';')].concat(rows.map(r => cols.map(c => `"${String(r[c]).replace(/"/g, '""')}"`).join(';'))).join('\n');
writeFileSync(join(OUT, `${NAME}.csv`), '\ufeff' + csv, 'utf8');

const chars = new Map();
for (const r of rows) if (r.personagem) chars.set(r.personagem, (chars.get(r.personagem) || 0) + 1);
writeFileSync(join(OUT, `${NAME}-personagens.txt`),
  [...chars.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${v}\t${k}`).join('\n'), 'utf8');

console.log(`\nrecursos extraidos: ${ok} | sem MemFile: ${semMemFile} | erros: ${erros}`);
console.log(`linhas de fala: ${fala}`);
console.log(`personagens: ${chars.size}`);
console.log('\n=== top 30 personagens ===');
[...chars.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30).forEach(([k, v]) => console.log(`  ${String(v).padStart(5)}  ${k}`));