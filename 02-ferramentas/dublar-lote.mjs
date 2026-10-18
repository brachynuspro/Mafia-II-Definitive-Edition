// dublar-lote.mjs - roda dublar-sds.mjs para todos os roteiros (03-legendas\roteiros\_lista.csv),
// na ordem das missoes. Retomavel: pula SDS cuja saida ja e mais nova que o roteiro.
// uso: node dublar-lote.mjs [filtro-regex]
import { readFileSync, existsSync, statSync, appendFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { spawnSync } from 'node:child_process';
const RAIZ = String.raw`D:\SteamLibrary\steamapps\common\Mafia II Definitive Edition`;
const DUB = join(RAIZ, 'DublagemIA'); const ROT = join(DUB, '03-legendas', 'roteiros');
const LOG = join(DUB, '08-repack', 'dublar-lote.log');
const filtro = process.argv[2] ? new RegExp(process.argv[2]) : null;
const log = s => { console.log(s); appendFileSync(LOG, `[${new Date().toISOString()}] ${s}\n`); };
const missao = n => { const m = n.match(/^(?:fmv|m)(\d\d)/i) || n.match(/(\d\d)/); return m ? Number(m[1]) : 99; };
const lista = readFileSync(join(ROT, '_lista.csv'), 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/).slice(1).filter(Boolean)
  .map(l => { const [sds, caminho, falas, dub] = l.split(';'); return { sds, caminho, dub: Number(dub) }; })
  .filter(x => x.dub > 0 && x.caminho && (!filtro || filtro.test(x.sds)))
  .sort((a, b) => missao(a.sds) - missao(b.sds) || a.sds.localeCompare(b.sds));
log(`lote: ${lista.length} SDS`);
let ok = 0, pulo = 0, erro = 0;
for (const [i, x] of lista.entries()) {
  const rot = join(ROT, x.sds + '.csv');
  const rel = relative(join(RAIZ, 'pc', 'sds'), x.caminho);
  const saidas = [join(DUB, '08-repack', 'saida', 'pc', 'sds_br', rel), join(DUB, '08-repack', 'saida', 'pc', 'sds', rel)];
  if (saidas.some(s => existsSync(s) && statSync(s).mtimeMs > statSync(rot).mtimeMs)) { pulo++; continue; }
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [join(import.meta.dirname, 'dublar-sds.mjs'), x.caminho, rot], { encoding: 'utf8' });
  if (r.status === 0) { ok++; log(`[${i + 1}/${lista.length}] OK ${x.sds} (${x.dub} falas, ${((Date.now() - t0) / 1000).toFixed(0)}s)`); }
  else { erro++; log(`[${i + 1}/${lista.length}] ERRO ${x.sds}: ${(r.stderr || r.stdout).trim().split('\n').slice(-3).join(' | ')}`); }
}
log(`FIM ok=${ok} pulados=${pulo} erros=${erro}`);
