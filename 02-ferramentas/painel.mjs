// painel.mjs - painel de andamento da dublagem em tempo real (F7).
// uso: node painel.mjs [porta=8765]   -> abrir http://localhost:8765
// So le arquivos do projeto (logs, CSVs, saida); nao altera nada.
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

const RAIZ = String.raw`D:\SteamLibrary\steamapps\common\Mafia II Definitive Edition`;
const DUB = join(RAIZ, 'DublagemIA');
const P = {
  embLog: join(DUB, '04-export', 'embeddings.log'), embNpy: join(DUB, '04-export', 'embeddings', 'emb.npy'),
  transcr: join(DUB, '09-transcricao', 'transcricoes-en.small.en.csv'), transcrLog: join(DUB, '09-transcricao', 'transcricao.log'),
  atores: join(DUB, '04-export', 'atores-resumo.csv'), lista: join(DUB, '03-legendas', 'roteiros', '_lista.csv'),
  trad: join(DUB, '03-legendas', 'traducao-rua-ia'), lote: join(DUB, '08-repack', 'dublar-lote.log'),
  cadeia: join(DUB, '08-repack', 'cadeia.log'), saida: join(DUB, '08-repack', 'saida'), cache: join(DUB, '08-repack', '_cache-tts'),
};
const TOTAL_FALA = 14699, TOTAL_RUA = 8956;
const ler = p => { try { return readFileSync(p, 'utf8').replace(/^\uFEFF/, ''); } catch { return ''; } };
const linhas = p => ler(p).split(/\r?\n/).filter(l => l.trim());
const mtime = p => { try { return statSync(p).mtimeMs; } catch { return 0; } };
function arquivos(d, ext, out = []) {
  if (!existsSync(d)) return out;
  for (const e of readdirSync(d, { withFileTypes: true })) { const p = join(d, e.name); if (e.isDirectory()) arquivos(p, ext, out); else if (e.name.endsWith(ext)) out.push(p); }
  return out;
}
function discos() {
  try {
    const o = execSync('powershell -NoProfile -Command "Get-PSDrive C,D | ForEach-Object { $_.Name + \'=\' + $_.Free }"', { encoding: 'utf8', timeout: 8000 });
    return Object.fromEntries(o.trim().split(/\r?\n/).map(l => { const [k, v] = l.split('='); return [k, Number(v) / 2 ** 30]; }));
  } catch { return {}; }
}

// Troca de vozes do elenco: a rodada começa em 08-repack\_tmp\marca-roteiros (criado antes do gerar-roteiros).
// Roteiros mais novos que a marca = arquivos a refazer; prontos quando o .relatorio.csv é mais novo que o roteiro.
const tempoLog = l => Date.parse((l.match(/^\[([^\]]+)\]/) || [])[1] || '') || 0;
function trocaElenco(rels, loteL) {
  const t0 = mtime(join(DUB, '08-repack', '_tmp', 'marca-roteiros'));
  if (!t0) return null;
  const nomes = new Map();   // papel -> personagem
  for (const l of linhas(join(DUB, '10-tts-local', 'elenco.csv')).slice(1)) { const c = l.split(';'); if (c[1] && !nomes.has(c[1])) nomes.set(c[1], (c[2] || c[1]).split(' (')[0]); }
  const relPorSds = new Map();
  for (const r of rels) { const n = r.split(/[\\/]/).pop().replace('.sds.relatorio.csv', ''), m = mtime(r); if (m > (relPorSds.get(n) ?? 0)) relPorSds.set(n, m); }
  const rotDir = join(DUB, '03-legendas', 'roteiros');
  const total = {}, feito = {};
  let arqT = 0, arqF = 0, falasT = 0, falasF = 0, ultimo = 0;
  for (const f of readdirSync(rotDir)) {
    if (!f.endsWith('.csv') || f.startsWith('_')) continue;
    const p = join(rotDir, f), mt = mtime(p);
    if (mt < t0) continue;
    const comVoz = linhas(p).slice(1).map(l => l.split(';')).filter(c => c[1] && c[1] !== '-' && c[2] !== '=');
    const pronto = (relPorSds.get(f.slice(0, -4)) ?? 0) > mt;
    arqT++; falasT += comVoz.length;
    if (pronto) { arqF++; falasF += comVoz.length; ultimo = Math.max(ultimo, relPorSds.get(f.slice(0, -4))); }
    for (const c of comVoz) if (nomes.has(c[1])) { total[c[1]] = (total[c[1]] || 0) + 1; if (pronto) feito[c[1]] = (feito[c[1]] || 0) + 1; }
  }
  const depois = loteL.filter(l => tempoLog(l) >= t0);
  const loteFim = depois.some(l => /\] FIM ok=/.test(l)), dlcFim = depois.some(l => l.includes('[dlc] FIM'));
  const saidaLote = ler(join(DUB, '08-repack', 'lote-saida.txt')).replace(/\0/g, '');
  const rodada = saidaLote.slice(saidaLote.lastIndexOf('--- marco'));
  const instPc = /lote e instalacao terminados/.test(rodada) ? 'feito' : /instalacao adiada/.test(rodada) ? 'adiado' : '';
  const pacote = mtime(join(DUB, '10-pacote', 'Mafia2DE-Dublagem-PTBR.zip')) > t0;
  const ally = mtime(join(DUB, '08-repack', '_tmp', 'ally-instalado.txt')) > t0;
  const agora = Date.now(), ritmo = falasF / Math.max(1, agora - t0);   // falas por ms
  const ativo = !loteFim && agora - mtime(P.lote) < 10 * 60000;
  const st = (feitoOk, emAndamento) => feitoOk ? 'feito' : emAndamento ? 'andamento' : 'pendente';
  return {
    inicio: new Date(t0).toISOString(), arqT, arqF, falasT, falasF, ativo,
    fim: ativo && ritmo > 0 && falasF < falasT ? new Date(agora + (falasT - falasF) / ritmo).toISOString() : null,
    porMinuto: Math.round(ritmo * 60000), ultimo: ultimo ? new Date(ultimo).toISOString() : null,
    papeis: [...nomes].map(([p, n]) => ({ papel: p, nome: n, feito: feito[p] || 0, total: total[p] || 0 })).filter(x => x.total).sort((a, b) => b.total - a.total),
    passos: [
      { nome: `Refazer os ${arqT} arquivos com as vozes novas`, st: st(loteFim, ativo) },
      { nome: 'Dublar as cópias das DLCs', st: st(dlcFim, loteFim && !dlcFim) },
      { nome: 'Instalar no jogo do PC', st: instPc === 'feito' ? 'feito' : instPc === 'adiado' ? 'adiado' : st(false, dlcFim) },
      { nome: 'Atualizar o pacote (zip)', st: st(pacote, false) },
      { nome: 'Instalar no ROG Ally', st: st(ally, false) },
    ],
  };
}

let cacheStatus = null, cacheT = 0, cacheDisco = {}, cacheDiscoT = 0;
function status() {
  if (cacheStatus && Date.now() - cacheT < 4000) return cacheStatus;
  const s = { agora: new Date().toISOString(), etapas: [] };

  // 1) impressoes vocais
  const embFeito = existsSync(P.embNpy);
  const embN = embFeito ? TOTAL_FALA : Number((linhas(P.embLog).filter(l => /^\d+ \d+$/.test(l)).at(-1) || '0').split(' ')[0]);
  s.etapas.push({ id: 'emb', nome: 'Impressões vocais (identificar atores)', feito: embN, total: TOTAL_FALA, fim: embFeito });

  // 2) transcricao das falas de rua
  const tr = linhas(P.transcr).slice(1);
  const trRua = tr.filter(l => l.includes('_Dabing_Generic_')).length;
  const prog = (linhas(P.transcrLog).filter(l => l.startsWith('[PROG]')).at(-1) || '');
  const vel = (prog.match(/x([\d.]+) tempo-real/) || [])[1];
  s.etapas.push({ id: 'transcr', nome: 'Transcrição das falas de rua (Whisper)', feito: trRua, total: TOTAL_RUA, fim: trRua >= TOTAL_RUA, extra: vel ? `${vel}× tempo real` : '' });

  // 3) traducao por IA das falas de rua (textos unicos)
  const feitos = new Set();
  for (const f of arquivos(P.trad, '.tsv')) for (const l of linhas(f).slice(1)) feitos.add(l.split('\t')[0].trim().toLowerCase());
  const unicos = new Set();
  for (const l of tr) { if (!l.includes('_Dabing_Generic_')) continue; const p = l.split(';'); const t = p.slice(2, -1).join(';').replace(/^"|"$/g, '').trim().toLowerCase(); if (t) unicos.add(t); }
  const trOk = [...unicos].filter(t => feitos.has(t)).length;
  s.etapas.push({ id: 'trad', nome: 'Tradução das falas de rua (IA)', feito: trOk, total: Math.max(unicos.size, 1), fim: false, extra: `${feitos.size} traduções no total` });

  // 4) roteiros + lote
  const lista = linhas(P.lista).slice(1).map(l => l.split(';')).filter(c => Number(c[3]) > 0);
  const totalSds = lista.length, totalFalas = lista.reduce((a, c) => a + Number(c[3]), 0);
  const rels = arquivos(P.saida, '.relatorio.csv');
  let dubladas = 0, mantidas = 0;
  const recentes = [];
  for (const r of rels) {
    const L = linhas(r).slice(1);
    for (const l of L) { const c = l.split(';'); if (c[5] && Number(c[5]) > 0) dubladas++; else mantidas++; }
    recentes.push({ t: mtime(r), sds: r.split(/[\\/]/).pop().replace('.sds.relatorio.csv', ''), n: L.length });
  }
  recentes.sort((a, b) => b.t - a.t);
  const loteL = linhas(P.lote);
  const ok = loteL.filter(l => / OK /.test(l)).length, erros = loteL.filter(l => / ERRO /.test(l));
  s.etapas.push({ id: 'lote', nome: 'Dublagem (TTS + encaixe + reempacotamento)', feito: Math.min(dubladas, totalFalas), total: Math.max(totalFalas, 1), fim: loteL.some(l => l.includes('FIM ok=')), extra: `${rels.length} de ${totalSds} SDS prontos` });

  // 5) quando vale mandar "seguir": falas transcritas esperando traducao x ritmo da transcricao
  const LIMIAR = 200, agoraMs = Date.now();
  const pend = unicos.size - trOk;
  const pm = prog.match(/\[PROG\] (\d+)\/(\d+) .*tempo=([\d.]+)min/);
  const transcrAtiva = agoraMs - mtime(P.transcrLog) < 10 * 60000 && !(pm && Number(pm[1]) >= Number(pm[2]));
  const loteAtivo = agoraMs - mtime(P.lote) < 10 * 60000 && !(loteL.at(-1) || '').includes('FIM ok=');
  let ritmo = 0, fimTranscr = null;
  if (pm && Number(pm[3]) > 0) {
    ritmo = Number(pm[1]) / Number(pm[3]);                                       // falas por minuto nesta rodada
    if (transcrAtiva) fimTranscr = agoraMs + (Number(pm[2]) - Number(pm[1])) / ritmo * 60000;
  }
  const sg = { pendentes: pend, limiar: LIMIAR, fimTranscr: fimTranscr && new Date(fimTranscr).toISOString(), transcrAtiva, loteAtivo };
  if (pend >= LIMIAR || (!transcrAtiva && pend > 0)) { sg.agora = true; sg.motivo = `${pend} falas esperando tradução`; }
  else if (transcrAtiva && ritmo > 0) {
    const t = Math.min(agoraMs + (LIMIAR - pend) / ritmo * 60000, fimTranscr ?? Infinity);
    sg.agora = false; sg.quando = new Date(t).toISOString();
    sg.motivo = t === fimTranscr ? 'quando a transcrição terminar' : `quando juntar ~${LIMIAR} falas para traduzir`;
  } else { sg.agora = false; sg.motivo = loteAtivo ? 'nada para traduzir; o lote está dublando' : 'nada pendente no momento'; }
  s.seguir = sg;

  s.resumo = {
    sdsProntos: rels.length, sdsTotal: totalSds, falasDubladas: dubladas, falasMantidas: mantidas,
    erros: erros.length, cacheTts: arquivos(P.cache, '.wav').length + arquivos(P.cache, '.mp3').length,
  };
  s.recentes = recentes.slice(0, 12).map(r => ({ ...r, quando: new Date(r.t).toLocaleTimeString('pt-BR') }));
  s.ultimosErros = erros.slice(-5);
  s.cadeia = linhas(P.cadeia).filter(l => l.startsWith('[')).slice(-6);
  s.loteUltimas = loteL.slice(-8);
  s.atores = linhas(P.atores).slice(1, 9).map(l => { const c = l.split(';'); return { ator: c[0], falas: c[1], min: c[2], voz: c[4], ex: (c[5] || '').slice(0, 110) }; });
  s.elenco = trocaElenco(rels, loteL);
  if (Date.now() - cacheDiscoT > 60000) { cacheDisco = discos(); cacheDiscoT = Date.now(); }
  s.discos = cacheDisco;
  cacheStatus = s; cacheT = Date.now();
  return s;
}

const HTML = String.raw`<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Painel da Dublagem</title>
<style>
:root{--bg:#f6f5f2;--card:#fff;--ink:#1d1c1a;--mut:#6b675f;--line:#e4e1da;--acc:#9a3412;--ok:#15803d;--err:#b91c1c;--bar:#ece9e2}
@media (prefers-color-scheme:dark){:root{--bg:#141312;--card:#1e1d1b;--ink:#ece9e3;--mut:#9c978d;--line:#2e2c29;--acc:#f97316;--ok:#4ade80;--err:#f87171;--bar:#2a2826}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.45 system-ui,Segoe UI,sans-serif}
main{max-width:1100px;margin:0 auto;padding:24px 16px 48px}
header{display:flex;justify-content:space-between;align-items:baseline;gap:12px;flex-wrap:wrap;margin-bottom:20px}
h1{font-size:22px;margin:0}h1 small{color:var(--mut);font-weight:400;font-size:14px;margin-left:8px}
.vivo{color:var(--mut);font-size:13px}.ponto{display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--ok);margin-right:6px;animation:p 2s infinite}
@keyframes p{50%{opacity:.3}}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:20px}
.kpi,.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px 16px}
.kpi b{display:block;font-size:26px;font-variant-numeric:tabular-nums}.kpi span{color:var(--mut);font-size:13px}
.etapa{margin-bottom:14px}.etapa .top{display:flex;justify-content:space-between;gap:8px;font-size:14px;margin-bottom:6px}
.etapa .num{color:var(--mut);font-variant-numeric:tabular-nums;white-space:nowrap}
.barra{height:10px;background:var(--bar);border-radius:6px;overflow:hidden}.barra i{display:block;height:100%;background:var(--acc);border-radius:6px;transition:width .6s}
.etapa.fim .barra i{background:var(--ok)}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:16px}@media(max-width:760px){.grid{grid-template-columns:1fr}}
h2{font-size:15px;margin:0 0 10px}table{width:100%;border-collapse:collapse;font-size:13px}td{padding:5px 4px;border-top:1px solid var(--line);vertical-align:top}
td.n{text-align:right;color:var(--mut);font-variant-numeric:tabular-nums;white-space:nowrap}
pre{margin:0;font:12px/1.5 ui-monospace,Consolas,monospace;white-space:pre-wrap;word-break:break-word;color:var(--mut)}
.err{color:var(--err)}.mut{color:var(--mut)}
.seguir{display:flex;gap:16px;align-items:center;flex-wrap:wrap;margin-bottom:20px;border-left:4px solid var(--mut)}
.seguir.ja{border-left-color:var(--ok)}.seguir b{font-size:22px;font-variant-numeric:tabular-nums}.seguir.ja b{color:var(--ok)}
.seguir .det{color:var(--mut);font-size:13px}
.troca{margin-bottom:20px;border-left:4px solid var(--acc)}.troca.fim{border-left-color:var(--ok)}
.troca .cab{display:flex;justify-content:space-between;align-items:baseline;gap:12px;flex-wrap:wrap}
.troca .grande{font-size:30px;font-weight:600;font-variant-numeric:tabular-nums}.troca .barra{height:14px;margin:8px 0 4px}
.troca .det{color:var(--mut);font-size:13px}
.cols{display:grid;grid-template-columns:1.3fr 1fr;gap:20px;margin-top:14px}@media(max-width:760px){.cols{grid-template-columns:1fr}}
.pers{display:grid;grid-template-columns:110px 1fr 92px;gap:6px 10px;align-items:center;font-size:13px}
.pers .barra{height:8px;margin:0}.pers .n{text-align:right;color:var(--mut);font-variant-numeric:tabular-nums}
.passos{list-style:none;margin:0;padding:0;font-size:14px}.passos li{display:flex;gap:10px;align-items:center;padding:6px 0;border-top:1px solid var(--line)}
.passos li:first-child{border-top:0}.ic{width:20px;text-align:center;font-weight:700}
.passos .feito .ic{color:var(--ok)}.passos .andamento .ic{color:var(--acc)}.passos .pendente{color:var(--mut)}.passos .adiado .ic{color:var(--err)}
.passos .andamento .ic{animation:p 1.5s infinite}
</style></head><body><main>
<header><h1>Dublagem PT-BR <small>Mafia II: Definitive Edition</small></h1><div class="vivo"><span class="ponto"></span><span id="hora">conectando…</span></div></header>
<section class="card troca" id="troca" hidden></section>
<section class="card seguir" id="seguir"></section>
<section class="kpis" id="kpis"></section>
<section class="card"><h2>Etapas</h2><div id="etapas"></div></section>
<div class="grid">
<section class="card"><h2>SDS prontos recentemente</h2><table id="recentes"></table></section>
<section class="card"><h2>Atores identificados (maiores papéis)</h2><table id="atores"></table></section>
<section class="card"><h2>Log do lote</h2><pre id="lote"></pre></section>
<section class="card"><h2>Sequência automática</h2><pre id="cadeia"></pre></section>
</div></main>
<script>
const fmt=n=>Number(n).toLocaleString('pt-BR');const esc=s=>String(s??'').replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
async function tick(){try{const s=await (await fetch('/status')).json();
document.getElementById('hora').textContent='atualizado '+new Date(s.agora).toLocaleTimeString('pt-BR');
const r=s.resumo,d=s.discos||{},g=s.seguir||{};
const hm=iso=>new Date(iso).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
const falta=iso=>{const m=Math.max(0,Math.round((new Date(iso)-Date.now())/60000));return m<60?m+' min':Math.floor(m/60)+' h '+String(m%60).padStart(2,'0')+' min'};
const E=s.elenco,tEl=document.getElementById('troca');
if(E){tEl.hidden=false;const pct=E.falasT?100*E.falasF/E.falasT:0,acabou=E.passos.every(p=>p.st==='feito');tEl.className='card troca'+(acabou?' fim':'');
const ICON={feito:'✔',andamento:'●',pendente:'○',adiado:'!'},TXT={feito:'feito',andamento:'em andamento',pendente:'aguardando',adiado:'adiado: jogo aberto'};
tEl.innerHTML='<div class="cab"><h2 style="margin:0">Troca de vozes do elenco</h2><span class="det">começou às '+hm(E.inicio)+'</span></div>'
+'<div class="cab" style="margin-top:8px"><span class="grande">'+pct.toFixed(1)+'%</span><span class="det">'+(E.fim?'faltam ~'+falta(E.fim)+' · termina por volta de <b>'+hm(E.fim)+'</b>':acabou?'tudo pronto':E.falasF>=E.falasT?'lote concluído':'calculando…')+'</span></div>'
+'<div class="barra"><i style="width:'+pct+'%"></i></div>'
+'<div class="det">'+fmt(E.falasF)+' de '+fmt(E.falasT)+' falas · '+fmt(E.arqF)+' de '+fmt(E.arqT)+' arquivos do jogo'+(E.porMinuto?' · '+fmt(E.porMinuto)+' falas/min':'')+(E.ultimo?' · último arquivo pronto às '+new Date(E.ultimo).toLocaleTimeString('pt-BR'):'')+'</div>'
+'<div class="cols"><div><h2>Personagens (falas com a voz nova)</h2><div class="pers">'+E.papeis.map(x=>{const p=x.total?100*x.feito/x.total:0;return '<span>'+esc(x.nome)+'</span><div class="barra"><i style="width:'+p+'%"></i></div><span class="n">'+fmt(x.feito)+' / '+fmt(x.total)+'</span>'}).join('')+'</div></div>'
+'<div><h2>Etapas</h2><ul class="passos">'+E.passos.map(p=>'<li class="'+p.st+'"><span class="ic">'+ICON[p.st]+'</span><span>'+esc(p.nome)+'<br><small class="mut">'+TXT[p.st]+'</small></span></li>').join('')+'</ul></div></div>';}
const sgEl=document.getElementById('seguir');sgEl.className='card seguir'+(g.agora?' ja':'');
sgEl.innerHTML='<div><span class="det">Próximo “seguir”</span><br><b>'+(g.agora?'Pode mandar agora':g.quando?'por volta de '+hm(g.quando):'—')+'</b></div>'
+'<div class="det">'+esc(g.motivo||'')+(g.quando&&!g.agora?' · em '+falta(g.quando):'')
+'<br>'+fmt(g.pendentes??0)+' falas esperando tradução'+(g.fimTranscr?' · transcrição termina ~'+hm(g.fimTranscr):'')+(g.loteAtivo?' · lote dublando':'')+'</div>';
document.getElementById('kpis').innerHTML=[[fmt(r.falasDubladas),'falas dubladas'],[fmt(r.sdsProntos)+' / '+fmt(r.sdsTotal),'arquivos SDS prontos'],[fmt(r.cacheTts),'falas sintetizadas (cache)'],[r.erros,'erros no lote'],[(d.C??0).toFixed(1)+' GB','livre no C:'],[(d.D??0).toFixed(1)+' GB','livre no D:']]
.map(([v,l],i)=>'<div class="kpi"><b class="'+(i==3&&r.erros>0?'err':'')+'">'+v+'</b><span>'+l+'</span></div>').join('');
document.getElementById('etapas').innerHTML=s.etapas.map(e=>{const p=Math.min(100,100*e.feito/e.total);return '<div class="etapa'+(e.fim?' fim':'')+'"><div class="top"><span>'+esc(e.nome)+(e.extra?' <span class="mut">· '+esc(e.extra)+'</span>':'')+'</span><span class="num">'+fmt(e.feito)+' / '+fmt(e.total)+' · '+p.toFixed(1)+'%</span></div><div class="barra"><i style="width:'+p+'%"></i></div></div>'}).join('');
document.getElementById('recentes').innerHTML=s.recentes.map(x=>'<tr><td>'+esc(x.sds)+'</td><td class="n">'+x.n+' falas</td><td class="n">'+x.quando+'</td></tr>').join('')||'<tr><td class="mut">nenhum ainda</td></tr>';
document.getElementById('atores').innerHTML=s.atores.map(a=>'<tr><td>'+esc(a.ator)+'<div class="mut">'+esc(a.ex)+'</div></td><td class="n">'+a.falas+' falas<br>'+esc(a.voz)+'</td></tr>').join('')||'<tr><td class="mut">aguardando agrupamento</td></tr>';
document.getElementById('lote').innerHTML=esc(s.loteUltimas.join('\n')||'aguardando início');
document.getElementById('cadeia').innerHTML=esc(s.cadeia.join('\n')||'aguardando');
}catch(e){document.getElementById('hora').textContent='sem conexão com o painel'}}
tick();setInterval(tick,5000);
</script></body></html>`;

const porta = Number(process.argv[2] || 8765);
createServer((req, res) => {
  if (req.url === '/status') { res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(status())); return; }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(HTML);
}).listen(porta, '127.0.0.1', () => console.log(`painel em http://localhost:${porta}`));
