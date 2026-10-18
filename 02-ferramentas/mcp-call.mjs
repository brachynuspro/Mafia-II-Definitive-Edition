// mcp-call.mjs - cliente MCP streamable HTTP (tools/call + helpers)
// uso: node mcp-call.mjs <url> <tool-name | tools/list | tools/call> [json-args | @argsfile]
//   - tools/list          -> lista tools
//   - tools/call <json>   -> chama o tool descrito no JSON {name,arguments}
//   - <tool-name> <json>  -> atalho para tools/call com esse nome
import { readFileSync } from 'node:fs';
const URL_ = process.argv[2];
let METHOD = process.argv[3];
let raw = process.argv[4] ?? '{}';
if (raw.startsWith('@')) raw = readFileSync(raw.slice(1), 'utf8');

let PARAMS;
if (METHOD === 'tools/list') {
  PARAMS = {};
} else if (METHOD === 'tools/call') {
  PARAMS = JSON.parse(raw.replace(/^\uFEFF/, ''));
} else {
  // atalho: METHOD = tool-name, raw = arguments
  PARAMS = { name: METHOD, arguments: JSON.parse(raw.replace(/^\uFEFF/, '')) };
  METHOD = 'tools/call';
}

const HDRS = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };

async function rpc(method, params, sid) {
  const h = { ...HDRS };
  if (sid) h['mcp-session-id'] = sid;
  const r = await fetch(URL_, {
    method: 'POST',
    headers: h,
    body: JSON.stringify({ jsonrpc: '2.0', id: Date.now() % 1e6, method, params }),
  });
  const sid2 = r.headers.get('mcp-session-id') || sid;
  const text = await r.text();
  const line = text.split('\n').find(l => l.startsWith('data:'));
  const json = line ? JSON.parse(line.slice(5).trim()) : (text ? JSON.parse(text) : null);
  return { json, sid: sid2 };
}

const init = await rpc('initialize', {
  protocolVersion: '2024-11-05',
  capabilities: {},
  clientInfo: { name: 'mcp-call', version: '1.0' },
});
await fetch(URL_, { method: 'POST', headers: { ...HDRS, 'mcp-session-id': init.sid },
  body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) });

const out = await rpc(METHOD, PARAMS, init.sid);
console.log(JSON.stringify(out.json, null, 2));
