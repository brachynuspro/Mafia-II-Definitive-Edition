# atribuir-vozes-extras.py - para falas novas do voice-map (ainda sem tom/ator), mede o tom (F0) e a impressao
# vocal e associa cada uma ao ATOR JA EXISTENTE mais parecido (centroide), sem reagrupar nada: as vozes das falas
# ja dubladas nao mudam. Acrescenta linhas em 04-export\tom-falas.csv e 04-export\atores.csv.
# uso: python -I atribuir-vozes-extras.py [limiar=0.55]
import csv, sys, wave, importlib.util
from collections import Counter, defaultdict
from pathlib import Path
import numpy as np
RAIZ = Path(r"D:\SteamLibrary\steamapps\common\Mafia II Definitive Edition\DublagemIA")
EXP = RAIZ / "04-export"; WAV = EXP / "wav"; FERR = RAIZ / "02-ferramentas"
LIMIAR = float(sys.argv[1]) if len(sys.argv) > 1 else 0.55
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

src = (FERR / "estimar-tom.py").read_text(encoding="utf-8")
exec(src[src.index("def f0"):src.index("arqs = ")])                     # f0(p) -> (hz, quadros)
spec = importlib.util.spec_from_file_location("emb", FERR / "embeddings-voz.py")
emb = importlib.util.module_from_spec(spec); spec.loader.exec_module(emb)   # emb.embedding(p)

def ler(p): return [l for l in csv.reader(open(p, encoding="utf-8"), delimiter=";")][1:]
tom = {l[0] for l in ler(EXP / "tom-falas.csv")}
atores = ler(EXP / "atores.csv"); ja = {l[0] for l in atores}
vm = [l.split(",")[0] for l in (EXP / "voice-map.csv").read_text(encoding="utf-8").splitlines()[1:] if l]
novas = [w for w in vm if w not in ja and (WAV / w).exists()]
print(f"falas novas: {len(novas)}")

# centroides dos atores existentes
lista = (EXP / "embeddings" / "lista.txt").read_text(encoding="utf-8").splitlines()
E = np.load(EXP / "embeddings" / "emb.npy"); idx = {n: i for i, n in enumerate(lista)}
grupos, vozes = defaultdict(list), defaultdict(Counter)
for l in atores:
    if len(l) < 4: continue
    w, a, v = l[0], l[1], l[3]
    if w in idx: grupos[a].append(idx[w])
    vozes[a][v] += 1
nomesA = [a for a in grupos if len(grupos[a]) >= 3]
C = np.array([E[grupos[a]].mean(0) for a in nomesA]); C /= np.linalg.norm(C, axis=1, keepdims=True)

with open(EXP / "tom-falas.csv", "a", encoding="utf-8", newline="") as ft, open(EXP / "atores.csv", "a", encoding="utf-8", newline="") as fa:
    wt, wa = csv.writer(ft, delimiter=";"), csv.writer(fa, delimiter=";")
    n_ok = 0
    for i, w in enumerate(novas, 1):
        p = WAV / w
        if w not in tom:
            try: hz, q = f0(p)
            except Exception: hz, q = 0.0, 0
            wt.writerow([w, f"{hz:.1f}", q])
        try: e = emb.embedding(p)
        except Exception: e = None
        if e is None: continue
        s = C @ e; j = int(s.argmax())
        if s[j] >= LIMIAR:
            a = nomesA[j]; wa.writerow([w, a, f"{s[j]:.2f}", vozes[a].most_common(1)[0][0]]); n_ok += 1
        if i % 100 == 0: print(i, len(novas), flush=True)
print(f"FIM: {n_ok} de {len(novas)} falas associadas a atores existentes (o resto usa a voz pelo tom)")
