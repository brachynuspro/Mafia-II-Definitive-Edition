// extrair-faltando.mjs - extrai apenas os SDS que faltam no manifesto
import { readFileSync, writeFileSync, mkdirSync, existsSync, appendFileSync, readdirSync } from 'node:fs';
import { join, dirname, basename, relative } from 'node:path';
const root = process.argv[2] || 'D:\\SteamLibrary\\steamapps\\common\\Mafia II Definitive Edition';
const URL_ = process.argv[3] || 'http://localhost:5123/';
const outRoot = process.argv[4] || join(root, 'DublagemIA', '04-export', 'wav-fsb5');
const manifestoPath = process.argv[5] || join(root, 'DublagemIA', '04-export', 'manifesto-final.csv');

const HDRS = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
async function rpc(method, params, sid) {
  const h = { ...HDRS };
  if (sid) h['mcp-session-id'] = sid;
  const r = await fetch(URL_, { method: 'POST', headers: h, body: JSON.stringify({ jsonrpc: '2.0', id: Date.now() % 1e6, method, params }) });
  const sid2 = r.headers.get('mcp-session-id') || sid;
  const text = await r.text();
  const line = text.split('\n').find(l => l.startsWith('data:'));
  const json = line ? JSON.parse(line.slice(5).trim()) : (text ? JSON.parse(text) : null);
  return { json, sid: sid2 };
}
const init = await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'extrair-faltando', version: '1' } });
await fetch(URL_, { method: 'POST', headers: { ...HDRS, 'mcp-session-id': init.sid }, body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) });
let sid = init.sid;
async function callTool(name, args) {
  const r = await rpc('tools/call', { name, arguments: args }, sid);
  if (!r.json.result) throw new Error('tool ' + name + ' failed: ' + JSON.stringify(r.json));
  const text = r.json.result.content[0].text;
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

// pega SDS ainda missing no manifesto
const lines = readFileSync(manifestoPath, 'utf8').split('\n').filter(l => l.includes('missing'));
const sdsSet = new Set();
for (const l of lines) {
  const sds = l.split('","')[0].replace(/^"/, '');
  sdsSet.add(sds);
}
const targets = [...sdsSet].sort();
console.log('SDS faltando: ' + targets.length);

mkdirSync(outRoot, { recursive: true });
const logPath = join(outRoot, '_extracao-faltando.csv');
if (!existsSync(logPath)) appendFileSync(logPath, 'sds_rel,resource_index,type_name,data_size,name,out_path,status\n');

for (const sdsXml of targets) {
  const rel = sdsXml.replace(/\.xml$/, '.sds');
  const sdsPath = join(root, 'pc', 'sds', rel);
  console.log('-- ' + rel);
  let info;
  try { info = await callTool('open_sds_file', { filePath: sdsPath, gameType: 'MafiaII_DE' }); }
  catch (e) { appendFileSync(logPath, '"' + rel + '",,,,,failed-open\n'); continue; }
  if (!info.success) { appendFileSync(logPath, '"' + rel + '",,,,,failed-info\n'); continue; }
  const sdsBase = basename(rel, '.sds');
  const sdsOutDir = join(outRoot, dirname(rel), sdsBase);
  mkdirSync(sdsOutDir, { recursive: true });
  const srs = (info.resources || []).filter(r => r.typeName === 'Sound' || r.typeName === 'Speech');
  console.log('   ' + srs.length + ' sound de ' + (info.resources||[]).length);
  let i = 0;
  for (const r of srs) {
    i++;
    let ext;
    try { ext = await callTool('extract_resource', { filePath: sdsPath, resourceIndex: r.index, gameType: 'MafiaII_DE' }); }
    catch (e) { appendFileSync(logPath, '"' + rel + '",' + r.index + ',' + r.typeName + ',' + r.dataSize + ',,,failed-call\n'); continue; }
    if (!ext || !ext.data) { appendFileSync(logPath, '"' + rel + '",' + r.index + ',' + r.typeName + ',' + r.dataSize + ',,,no-data\n'); continue; }
    let buf;
    try { buf = Buffer.from(ext.data, 'base64'); } catch { continue; }
    ext = null;
    let off = 0;
    const nameLen = buf[off]; off += 1;
    const nameStart = off;
    off += nameLen;
    const fileSize = buf.readUInt32LE(off); off += 4;
    const fsb5 = buf.subarray(off, off + fileSize);
    const hasFsb5 = fsb5.length >= 4 && fsb5.indexOf(Buffer.from('FSB5')) === 0;
    let outName = sdsBase + '_r' + r.index + '_' + r.typeName;
    try {
      const nameStr = buf.subarray(nameStart, nameStart + nameLen).toString('latin1').replace(/[\\/:*?"<>|\0]/g, '_');
      if (nameStr) outName = sdsBase + '_' + nameStr;
    } catch {}
    outName = outName.substring(0, 120);
    const outFile = join(sdsOutDir, outName + (hasFsb5 ? '.fsb5' : '.bin'));
    try {
      writeFileSync(outFile, fsb5);
      appendFileSync(logPath, '"' + rel + '",' + r.index + ',' + r.typeName + ',' + r.dataSize + ',"' + buf.subarray(nameStart, nameStart + nameLen).toString('latin1').replace(/"/g, "'") + '","' + relative(outRoot, outFile) + '",ok\n');
      if (i % 5 === 0) console.log('   ok ' + i + '/' + srs.length);
    } catch (e) {
      appendFileSync(logPath, '"' + rel + '",' + r.index + ',' + r.typeName + ',' + r.dataSize + ',,,failed-write\n');
    }
    buf = null;
  }
  console.log('   done ' + i);
}
console.log('OK');
