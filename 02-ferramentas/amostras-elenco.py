# amostras-elenco.py - amostras das vozes do elenco (10-tts-local\elenco.csv + vozes.json) para aprovar antes do lote.
# Para cada papel escolhe N falas do personagem e gera: original EN | dublagem atual | voz nova (mesmo
# processamento do dublar-sds.mjs: tom, encaixe na duracao e volume do original).
# uso: python -I amostras-elenco.py [papel ...] [--n 3]      saida: 11-amostras-vozes\ouvir.html
import array, csv, html, json, math, os, shutil, subprocess, sys, wave
from pathlib import Path

R = Path(r"D:\SteamLibrary\steamapps\common\Mafia II Definitive Edition\DublagemIA")
RAIZ = R.parent
SDSTOOL = R / "08-repack/SdsTool/bin/Release/net8.0-windows/SdsTool.exe"
FSB2WAV = R / "06-fmod/Fsb5ToWav/bin/Release/net8.0/Fsb5ToWav.exe"
_FFMPEG_WINGET = Path.home() / r"AppData\Local\Microsoft\WinGet\Packages\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\ffmpeg-9.0.2-full_build\bin\ffmpeg.exe"
FFMPEG = Path(os.environ.get("FFMPEG") or (_FFMPEG_WINGET if _FFMPEG_WINGET.exists() else shutil.which("ffmpeg") or "ffmpeg"))
BACKUP = R / "08-repack/backup-original/pc"
SAIDA_DUB = R / "08-repack/saida/pc"
OUT = R / "11-amostras-vozes"
TMP = R / "08-repack/_tmp/amostras"
TAXA, MAX_ACELERA = 22050, 1.45

args = [a for a in sys.argv[1:] if not a.startswith("--")]
N = int(sys.argv[sys.argv.index("--n") + 1]) if "--n" in sys.argv else 3
if "--n" in sys.argv:
    args = [a for a in args if a != str(N)]

vozes = json.loads((R / "10-tts-local/vozes.json").read_text(encoding="utf-8-sig"))
elenco = {}  # papel -> {atores, personagem, idade}
for r in csv.DictReader(open(R / "10-tts-local/elenco.csv", encoding="utf-8-sig"), delimiter=";"):
    e = elenco.setdefault(r["papel"], {"atores": set(), "personagem": r["personagem"].split(" (")[0], "idade": r["idade"]})
    e["atores"].add(r["ator"])
papeis = args or list(elenco)

# caminho de cada SDS no jogo (pc\...) como o dublar-sds.mjs resolve
caminho = {}
for r in csv.DictReader(open(R / "03-legendas/roteiros/_lista.csv", encoding="utf-8-sig"), delimiter=";"):
    if not r["caminho"]:
        continue
    p = Path(r["caminho"])
    rel = p.relative_to(RAIZ / "pc")
    if rel.parts[0] == "sds" and (RAIZ / "pc/sds_br" / Path(*rel.parts[1:])).exists():
        rel = Path("sds_br", *rel.parts[1:])
    caminho[r["sds"]] = rel

falas = {p: [] for p in papeis}
for f in sorted((R / "03-legendas/roteiros").glob("*.csv")):
    if f.name.startswith("_") or f.stem not in caminho:
        continue
    for r in csv.DictReader(open(f, encoding="utf-8-sig"), delimiter=";"):
        t = (r.get("texto_pt") or "").strip()
        if t in ("", "=") or t.startswith(("n_", "f_")) or not 45 <= len(t) <= 150:
            continue
        for p in papeis:
            if (r.get("ator") or "").strip() in elenco[p]["atores"]:
                falas[p].append({"sds": f.stem, "id": r["id"], "texto": t, "voz_atual": r["voz"]})

def escolher(L, n):
    L = sorted(L, key=lambda x: (not x["sds"].startswith("fmv"), x["sds"], x["id"]))  # cutscenes primeiro
    vistos, saida = set(), []
    for x in L:  # uma fala por SDS, espalhadas
        if x["sds"] not in vistos and len(saida) < n:
            vistos.add(x["sds"]); saida.append(x)
    return saida

def run(cmd):
    r = subprocess.run([str(c) for c in cmd], capture_output=True, text=True, encoding="utf-8", errors="replace")
    if r.returncode != 0:
        raise RuntimeError("%s falhou: %s" % (Path(str(cmd[0])).name, (r.stderr or r.stdout)[-400:]))
    return r.stdout

_fsbs = {}
def fsb(sds_path, tag):
    """desempacota (uma vez) e devolve {id: caminho do .fsb}"""
    k = (str(sds_path), tag)
    if k not in _fsbs:
        d = TMP / tag / sds_path.name
        shutil.rmtree(d, ignore_errors=True); d.mkdir(parents=True)
        run([SDSTOOL, "unpack", sds_path, d])
        _fsbs[k] = {p.stem: p for p in d.rglob("*.fsb")}
    return _fsbs[k]

def ler_pcm(p):
    with wave.open(str(p)) as w:
        a = array.array("h", w.readframes(w.getnframes())); ch, taxa = w.getnchannels(), w.getframerate()
    return (a[::ch] if ch > 1 else a), taxa

def rms_voz(a, taxa):  # RMS so dos quadros de 20 ms acima de -45 dBFS (igual ao dublar-sds.mjs)
    q, lim, s, n = max(1, taxa // 50), 32768 * 10 ** (-45 / 20), 0.0, 0
    for i in range(0, len(a) - q, q):
        e = sum(x * x for x in a[i:i + q]) / q
        if math.sqrt(e) > lim:
            s += e; n += 1
    return math.sqrt(s / n) if n else 0.0

OUT.mkdir(exist_ok=True)
itens = []
for p in papeis:
    for i, x in enumerate(escolher(falas[p], N), 1):
        x.update(papel=p, n=i, base="%s-%d" % (p, i))
        itens.append(x)
print("falas escolhidas:", len(itens))

# 1) original EN e dublagem atual
for x in itens:
    rel = caminho[x["sds"]]
    orig = BACKUP / rel if (BACKUP / rel).exists() else RAIZ / "pc" / rel
    for tag, sds in (("original", orig), ("atual", SAIDA_DUB / rel)):
        dest = OUT / ("%s-%s.wav" % (x["base"], tag))
        f = fsb(sds, tag).get(x["id"]) if sds.exists() else None
        if f:
            run([FSB2WAV, f, dest])
        x[tag] = dest.name if f else None

# 2) TTS novo em lote (Kokoro, com misturas de voz). Variações de um papel: chaves "<papel>~<nome>" em vozes.json
def variantes(p):
    return [p] + sorted(k for k in vozes if k.startswith(p + "~"))
tarefas = []  # (item, chave em vozes.json, sufixo do arquivo)
for x in itens:
    for k in variantes(x["papel"]):
        suf = "novo" if k == x["papel"] else "novo~" + k.split("~", 1)[1]
        tarefas.append({"x": x, "v": vozes[k], "suf": suf, "tts": TMP / ("%s-%s-tts.wav" % (x["base"], suf))})
lote = TMP / "_lote-amostras.json"
lote.write_text(json.dumps([{"texto": t["x"]["texto"], "voz": t["v"]["voz"], "velocidade": t["v"].get("velocidade", 1),
                             "saida": str(t["tts"])} for t in tarefas], ensure_ascii=False), encoding="utf-8")
print(run([sys.executable, "-I", R / "02-ferramentas/tts-kokoro.py", lote]).strip().splitlines()[-1])

# 3) mesmo processamento do jogo: corta silencio, tom, encaixe na duracao do original, volume do original
for t in tarefas:
    x = t["x"]
    if not t["tts"].exists():
        x[t["suf"]] = None; continue
    w0 = TMP / ("%s-0.wav" % x["base"])
    filtros = ["silenceremove=start_periods=1:start_threshold=-50dB,areverse,silenceremove=start_periods=1:start_threshold=-50dB,areverse"]
    tom = float(t["v"].get("tom", 1))
    if abs(tom - 1) > 0.001:
        filtros.append("rubberband=pitch=%s" % tom)
    run([FFMPEG, "-y", "-v", "error", "-i", t["tts"], "-af", ",".join(filtros), "-ar", TAXA, "-ac", "1", "-c:a", "pcm_s16le", w0])
    a0, _ = ler_pcm(w0); dur_tts = len(a0) / TAXA
    ganho, dur_orig = 0.0, dur_tts
    if x["original"]:
        ao, to = ler_pcm(OUT / x["original"]); dur_orig = len(ao) / to
        ro, rt = rms_voz(ao, to), rms_voz(a0, TAXA)
        if ro > 0 and rt > 0:
            ganho = max(-6, min(12, 20 * math.log10(ro / rt)))
    acel = min(MAX_ACELERA, max(1, dur_tts / max(0.3, dur_orig - 0.05)))
    f2 = ([("atempo=%.4f" % acel)] if acel > 1.001 else []) + ["volume=%.2fdB" % ganho, "alimiter=limit=0.95"]
    nome = "%s-%s.wav" % (x["base"], t["suf"])
    run([FFMPEG, "-y", "-v", "error", "-i", w0, "-af", ",".join(f2), "-ar", TAXA, "-ac", "1", "-c:a", "pcm_s16le", OUT / nome])
    x[t["suf"]] = nome
    if t["suf"] == "novo":
        x["acel"] = acel

# 4) pagina para ouvir
def desc(v):
    return "%s · tom %.2f · ritmo %.2f" % (v["voz"], v.get("tom", 1), v.get("velocidade", 1))
lin = []
for p in papeis:
    e, vs = elenco[p], variantes(p)
    rot = ["Nova" if k == p else "Opção " + k.split("~", 1)[1] for k in vs]
    lin.append('<tr class="papel"><th colspan="%d">%s <small>%s — %s</small></th></tr>'
               % (3 + len(vs), html.escape(e["personagem"]), html.escape(e["idade"]),
                  " | ".join("%s: %s" % (r, html.escape(desc(vozes[k]))) for r, k in zip(rot, vs))))
    if len(vs) > 1:
        lin.append("<tr><th>Fala</th><th>Original (EN)</th><th>Atual</th>%s</tr>" % "".join("<th>%s</th>" % r for r in rot))
    for x in [x for x in itens if x["papel"] == p]:
        cel = lambda k: '<audio controls preload="none" src="%s"></audio>' % x[k] if x.get(k) else "—"
        sufs = ["novo" if k == p else "novo~" + k.split("~", 1)[1] for k in vs]
        lin.append("<tr><td>%s<br><small>%s · %s · voz atual: %s%s</small></td><td>%s</td><td>%s</td>%s</tr>"
                   % (html.escape(x["texto"]), x["sds"], x["id"], x["voz_atual"],
                      (" · acelerada %.2fx" % x["acel"]) if x.get("acel", 1) > 1.001 else "", cel("original"), cel("atual"),
                      "".join("<td>%s</td>" % cel(s) for s in sufs)))
PAGINA = OUT / ("ouvir-%s.html" % "-".join(papeis) if args else "ouvir.html")
PAGINA.write_text("""<!doctype html><meta charset="utf-8"><title>Vozes do elenco</title>
<style>:root{color-scheme:light dark}body{font:15px system-ui,sans-serif;margin:16px;max-width:1200px}
table{border-collapse:collapse;width:100%%}td,th{padding:8px;border-bottom:1px solid #8884;vertical-align:middle;text-align:left}
tr.papel th{padding-top:22px;font-size:17px}small{opacity:.7;font-weight:normal}audio{width:230px}</style>
<h1>Vozes do elenco — Mafia II PT-BR</h1>
<p>Para cada personagem: o original em inglês, a dublagem atual e a voz nova (já com tom, encaixe no tempo e volume, como vai para o jogo).</p>
<table><tr><th>Fala</th><th>Original (EN)</th><th>Atual</th><th>Nova</th></tr>%s</table>""" % "\n".join(lin), encoding="utf-8")
print("pronto:", PAGINA, "|", sum(1 for x in itens if x.get("novo")), "vozes novas,",
      sum(1 for x in itens if x.get("original")), "originais,", sum(1 for x in itens if x.get("atual")), "atuais")
