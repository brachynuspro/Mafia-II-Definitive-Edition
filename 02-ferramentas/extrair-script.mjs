// extrair-script.mjs - extrai os SDS da pasta pc/sds/script/ (somente Sound resources)
// salva em 04-export/wav-fsb5/script/<sds-basename>/<name>.fsb5
import { readFileSync, writeFileSync, mkdirSync, existsSync, appendFileSync, readdirSync } from 'node:fs';
import { join, dirname, basename, relative } from 'node:path';
const root = process.argv[2] || 'D:\\SteamLibrary\\steamapps\\common\\Mafia II Definitive Edition';
const URL_ = process.argv[3] || 'http://localhost:5123/';
const outRoot = process.argv[4] || join(root, 'DublagemIA', '04-export', 'wav-fsb5');
const offset = Number(process.argv[5] || 0);
const limit = Number(process.argv[6] || Infinity);

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
const init = await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'extrair-script', version: '1' } });
await fetch(URL_, { method: 'POST', headers: { ...HDRS, 'mcp-session-id': init.sid }, body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) });
let sid = init.sid;
async function callTool(name, args) {
  const r = await rpc('tools/call', { name, arguments: args }, sid);
  if (!r.json.result) throw new Error('tool ' + name + ' failed: ' + JSON.stringify(r.json));
  const text = r.json.result.content[0].text;
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

// pega todos SDS em pc/sds/script/ recursivo
const scriptDir = join(root, 'pc', 'sds', 'script');
const sdsList = [];
function walk(dir, prefix, out) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, join(prefix, e.name), out);
    else if (e.name.endsWith('.sds')) out.push({ path: p, rel: join(prefix, e.name) });
  }
}
walk(scriptDir, 'script', sdsList);
console.log('script SDS: ' + sdsList.length);

mkdirSync(outRoot, { recursive: true });
const logPath = join(outRoot, '_extracao-script.csv');
if (!existsSync(logPath)) appendFileSync(logPath, 'sds_rel,resource_index,type_name,version,data_size,name,out_path,status\n');

const useList = sdsList.slice(offset, offset + limit);
console.log('processando ' + useList.length + ' SDS (offset ' + offset + ' ate ' + (offset + useList.length) + ')');

let t0 = Date.now(), okSds = 0, okRes = 0, fail = 0, totalFsb5 = 0;
for (let si = 0; si < useList.length; si++) {
  const { path: sdsPath, rel } = useList[si];
  let info;
  try { info = await callTool('open_sds_file', { filePath: sdsPath, gameType: 'MafiaII_DE' }); }
  catch (e) { appendFileSync(logPath, '"' + rel + '",,,,,,failed-open: ' + e.message.replace(/[\r\n]+/g,' ').substring(0,200) + '\n'); continue; }
  if (!info.success) { appendFileSync(logPath, '"' + rel + '",,,,,,failed-info\n'); continue; }
  okSds++;
  const sdsBase = basename(rel, '.sds');
  const sdsOutDir = join(outRoot, dirname(rel), sdsBase);
  mkdirSync(sdsOutDir, { recursive: true });
  const soundResources = (info.resources || []).filter(r => r.typeName === 'Sound' || r.typeName === 'Speech');
  for (const r of soundResources) {
    let ext;
    try { ext = await callTool('extract_resource', { filePath: sdsPath, resourceIndex: r.index, gameType: 'MafiaII_DE' }); }
    catch (e) { fail++; appendFileSync(logPath, '"' + rel + '",' + r.index + ',' + r.typeName + ',' + r.version + ',' + r.dataSize + ',,,failed-call: ' + e.message.substring(0,200) + '\n'); continue; }
    if (!ext || !ext.data) { fail++; appendFileSync(logPath, '"' + rel + '",' + r.index + ',' + r.typeName + ',' + r.version + ',' + r.dataSize + ',,,no-data\n'); continue; }
    let buf;
    try { buf = Buffer.from(ext.data, 'base64'); } catch { fail++; continue; }
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
      okRes++;
      if (hasFsb5) totalFsb5++;
      appendFileSync(logPath, '"' + rel + '",' + r.index + ',' + r.typeName + ',' + r.version + ',' + r.dataSize + ',"' + buf.subarray(nameStart, nameStart + nameLen).toString('latin1').replace(/"/g, "'") + '","' + relative(outRoot, outFile) + '",ok\n');
    } catch (e) {
      fail++;
      appendFileSync(logPath, '"' + rel + '",' + r.index + ',' + r.typeName + ',' + r.version + ',' + r.dataSize + ',,,failed-write\n');
    }
    buf = null;
  }
  if ((si + 1) % 5 === 0) {
    const dt = (Date.now() - t0) / 1000;
    console.log('  [' + (si+1) + '/' + useList.length + '] ok-sds=' + okSds + ' ok-res=' + okRes + ' fail=' + fail + ' fsb5=' + totalFsb5 + ' dt=' + dt.toFixed(0) + 's');
    if (global.gc) { try { global.gc(); } catch {} }
  }
}
const dt = (Date.now() - t0) / 1000;
console.log('\nTOTAL: ' + useList.length + ' SDS  ok-sds=' + okSds + '  ok-res=' + okRes + '  fail=' + fail + '  fsb5=' + totalFsb5 + '  dt=' + dt.toFixed(0) + 's');
