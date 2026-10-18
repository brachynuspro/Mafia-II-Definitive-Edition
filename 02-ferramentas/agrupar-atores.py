# agrupar-atores.py - agrupa as falas por ator (embeddings de voz) e escolhe a voz TTS de cada ator.
# Entradas: 04-export\embeddings\{emb.npy,lista.txt}, 04-export\tom-falas.csv, 04-export\duracoes.csv
# Saidas:   04-export\atores.csv (wav;ator;sim)   04-export\atores-resumo.csv (ator;falas;minutos;f0_p30;voz;exemplos)
# Ajuste manual: 05-bancos\vozes-manuais.csv (ator;voz) sobrescreve a escolha automatica.
# uso: python -I agrupar-atores.py [limiar=0.55]
import csv, re, sys
from collections import defaultdict
from pathlib import Path
import numpy as np
RAIZ = Path(r"D:\SteamLibrary\steamapps\common\Mafia II Definitive Edition\DublagemIA")
EXP = RAIZ / "04-export"; LIM = float(sys.argv[1]) if len(sys.argv) > 1 else 0.55
FUSAO = float(sys.argv[2]) if len(sys.argv) > 2 else 0.60   # junta grupos cujos centroides tem cosseno >= FUSAO
MIN_GRUPO = 4
E = np.load(EXP / "embeddings" / "emb.npy"); nomes = (EXP / "embeddings" / "lista.txt").read_text(encoding="utf-8").split("\n")
tom = {}; dur = {}
for l in (EXP / "tom-falas.csv").read_text(encoding="utf-8").splitlines()[1:]:
    w, f0, _ = l.split(";"); tom[w] = float(f0)
for m in re.finditer(r'^"[^"]*","([^"]+)",([\d.]+)', (EXP / "duracoes.csv").read_text(encoding="utf-8"), re.M): dur[m[1]] = float(m[2])
leg = {}
lp = RAIZ / "03-legendas" / "legendas-oficiais-pt.csv"
if lp.exists():
    for l in lp.read_text(encoding="utf-8-sig").splitlines()[1:]:
        k, _, v = l.partition(";"); leg[k] = v

ator = {}; sim = {}
# 1) falas de rua: o personagem vem no caminho (Dabing_Generic_<Personagem>_...)
def clusterizar(idx, prefixo):
    # agrupamento guloso (falas longas primeiro) + 3 passadas de reatribuicao ao centroide mais proximo
    X = E[idx]; ordem = sorted(range(len(idx)), key=lambda j: -dur.get(nomes[idx[j]], 0))
    cent = []; rot = np.full(len(idx), -1)
    for j in ordem:
        if cent:
            s = np.array(cent) @ X[j]; k = int(s.argmax())
            if s[k] >= LIM: rot[j] = k; v = cent[k] + X[j]; cent[k] = v / np.linalg.norm(v); continue
        cent.append(X[j].copy()); rot[j] = len(cent) - 1
    def centroides(rot, k):
        C = np.zeros((k, X.shape[1]), np.float32); n = np.bincount(rot, minlength=k)
        for j, c in enumerate(rot): C[c] += X[j]
        viv = n > 0; C[viv] /= np.linalg.norm(C[viv], axis=1, keepdims=True)
        return C, n
    # fusao aglomerativa de grupos com centroides parecidos (o guloso fragmenta a mesma voz em varios grupos)
    rot = np.array(rot)
    while True:
        u = np.unique(rot); mapa = {o: i for i, o in enumerate(u)}; rot = np.array([mapa[r] for r in rot])
        C, n = centroides(rot, len(u))
        S = C @ C.T; np.fill_diagonal(S, -1)
        a, b = np.unravel_index(S.argmax(), S.shape)
        if S[a, b] < FUSAO: break
        rot[rot == b] = a
    best = np.ones(len(idx))
    for _ in range(3):
        k = int(rot.max()) + 1; C, n = centroides(rot, k)
        S = X @ C.T; S[:, n == 0] = -1
        S[:, (n > 0) & (n < MIN_GRUPO)] -= 0.15          # grupos minusculos perdem para os grandes
        rot = S.argmax(1); best = (X @ C.T)[np.arange(len(idx)), rot]
    tam = np.bincount(rot, minlength=len(cent)); nome_c = {int(k): f"{prefixo}{r+1:03d}" for r, k in enumerate(np.argsort(-tam))}
    for j, i in enumerate(idx): ator[nomes[i]] = nome_c[int(rot[j])]; sim[nomes[i]] = float(best[j])

# 1) falas de rua: agrupa por arquetipo do caminho (Dabing_Generic_<Arquetipo>_) e separa os locutores dentro dele
rua = defaultdict(list); idx_sc = []
for i, n in enumerate(nomes):
    m = re.search(r"_Dabing_Generic_([A-Za-z0-9]+)_", n)
    if m: rua["rua_" + m[1].lower()].append(i)
    else: idx_sc.append(i)
for g, idx in rua.items(): clusterizar(idx, g + "_")
# 2) missao + cutscene: agrupamento global
clusterizar(idx_sc, "ator")

# 2b) genero pela impressao vocal: regressao logistica treinada nas falas de rua cujo arquetipo diz o genero
#     (APDCivFemale / APDCivMale). O tom (F0) engana: homens gritando passam de 200 Hz.
FEM_RE = re.compile(r"_Dabing_Generic_(APDCivFemale|CivilFemale|BasicFemale|SpecialDrivingAngela)_")
MASC_RE = re.compile(r"_Dabing_Generic_(Gangster\w*?|Police\w*?|Policeman|Sicily\w*?|Special\w*?(Joe|Vito|Henry|Marty|Tony|Derek|Steve)\w*?|Vito|Joe|Harry\w*?|Derek|Giuseppe\w*?|Brusky|APDCivMale|APDGang\w*?|CivilWorker)_")
def genero_rotulo(n):
    if FEM_RE.search(n): return 1
    if MASC_RE.search(n): return 0
    return -1
rot_g = np.array([genero_rotulo(n) for n in nomes])
tr = rot_g >= 0
Xt, yt = E[tr], rot_g[tr].astype(np.float32)
peso = np.where(yt == 1, 0.5 / max(yt.mean(), 1e-6), 0.5 / max(1 - yt.mean(), 1e-6)).astype(np.float32)   # classes balanceadas
w = np.zeros(E.shape[1], np.float32); b0 = 0.0
for _ in range(600):
    p = 1 / (1 + np.exp(-(Xt @ w + b0))); g = (p - yt) * peso
    w -= 0.5 * (Xt.T @ g / len(yt) + 1e-2 * w); b0 -= 0.5 * g.mean()
acc = ((1 / (1 + np.exp(-(Xt @ w + b0))) >= 0.5) == (yt == 1)).mean()
p_fem = dict(zip(nomes, 1 / (1 + np.exp(-(E @ w + b0)))))
print(f"genero: treino={tr.sum()} falas ({int(yt.sum())} fem) acuracia={acc:.3f}")

# 3) resumo + voz por ator
grupos = defaultdict(list)
for n, a in ator.items(): grupos[a].append(n)
def p30(ns):
    v = [tom.get(n, 0) for n in ns if tom.get(n, 0) > 0]
    return float(np.percentile(v, 30)) if v else 0.0
def texto(n):
    i = n.split("_Dabing_")[-1].removesuffix(".wav").split("_")[-4:]
    k = "_".join(i); return leg.get(k) or leg.get("3" + i[0] + i[2] + i[3], "")
manuais = {}
mp = RAIZ / "05-bancos" / "vozes-manuais.csv"
if mp.exists():
    for l in mp.read_text(encoding="utf-8-sig").splitlines()[1:]:
        if ";" in l: a, v = l.split(";")[:2]; manuais[a.strip()] = v.strip()
resumo = sorted(grupos.items(), key=lambda kv: -sum(dur.get(n, 0) for n in kv[1]))
MASC = ["antonio", "antonio_grave", "antonio_agudo"]; FEM = ["francisca", "thalita"]
voz = {}; homens = 0; ciclo = defaultdict(lambda: [0, 0])   # por arquetipo de rua: (homens, mulheres) ja atribuidos
for a, ns in resumo:
    f = p30(ns); pf = float(np.mean([p_fem[n] for n in ns]))
    mulher = pf >= 0.5 and not (pf < 0.7 and f and f < 140)   # caso ambiguo com tom grave -> masculino
    if a.startswith("rua_"):
        # locutores do mesmo arquetipo conversam entre si: vozes diferentes em rodizio (maiores primeiro)
        g = a.rsplit("_", 1)[0]; c = ciclo[g]
        if mulher: voz[a] = FEM[c[1] % 2]; c[1] += 1
        else: voz[a] = MASC[c[0] % 3]; c[0] += 1
    elif mulher: voz[a] = "francisca" if (not f or f < 215) else "thalita"
    elif homens < 3: voz[a] = MASC[homens]; homens += 1          # 3 maiores papeis masculinos (Vito, Joe, ...)
    else: voz[a] = "antonio_grave" if f and f < 105 else ("antonio_agudo" if f >= 135 else "antonio")
    voz[a] = manuais.get(a, voz[a])
with open(EXP / "atores.csv", "w", encoding="utf-8", newline="") as fh:
    w = csv.writer(fh, delimiter=";"); w.writerow(["wav", "ator", "sim", "voz"])
    for n in nomes: w.writerow([n, ator[n], f"{sim[n]:.2f}", voz[ator[n]]])
with open(EXP / "atores-resumo.csv", "w", encoding="utf-8-sig", newline="") as fh:
    w = csv.writer(fh, delimiter=";"); w.writerow(["ator", "falas", "minutos", "f0_p30", "voz", "exemplos", "p_fem"])
    for a, ns in resumo:
        ex = " | ".join(t for t in (texto(n) for n in sorted(ns, key=lambda n: -dur.get(n, 0))[:3]) if t)[:220]
        w.writerow([a, len(ns), f"{sum(dur.get(n, 0) for n in ns)/60:.1f}", f"{p30(ns):.0f}", voz[a], ex, f"{np.mean([p_fem[n] for n in ns]):.2f}"])
sc = [a for a, _ in resumo if not a.startswith("rua_")]
print(f"limiar={LIM} atores(missao/cutscene)={len(sc)} personagens de rua={len(resumo)-len(sc)}")
for a, ns in resumo[:15]: print(f"  {a:28} falas={len(ns):5} min={sum(dur.get(n,0) for n in ns)/60:6.1f} f0p30={p30(ns):5.0f} pfem={np.mean([p_fem[n] for n in ns]):.2f} voz={voz[a]}")

