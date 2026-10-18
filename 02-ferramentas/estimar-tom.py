# estimar-tom.py - estima o tom medio (F0, Hz) de cada fala EN original (04-export\wav) para escolher a voz TTS.
# Autocorrelacao simples em quadros com voz; saida 04-export\tom-falas.csv (wav;f0;quadros)
# uso: python -I estimar-tom.py
import csv, sys, wave
from pathlib import Path
import numpy as np
RAIZ = Path(r"D:\SteamLibrary\steamapps\common\Mafia II Definitive Edition\DublagemIA")
WAV = RAIZ / "04-export" / "wav"; SAIDA = RAIZ / "04-export" / "tom-falas.csv"
def f0(p):
    with wave.open(str(p), "rb") as w:
        taxa = w.getframerate(); a = np.frombuffer(w.readframes(w.getnframes()), "<i2").astype(np.float32)
        if w.getnchannels() > 1: a = a.reshape(-1, w.getnchannels()).mean(1)
    k = max(1, taxa // 11025)
    if k > 1: a = np.convolve(a, np.ones(k) / k, "same")[::k]; taxa //= k
    q, h = int(0.04 * taxa), int(0.02 * taxa)
    if len(a) < q: return 0.0, 0
    fr = np.lib.stride_tricks.sliding_window_view(a, q)[::h]
    en = (fr ** 2).mean(1); fr = fr[en > en.max() * 0.05]
    lmin, lmax = int(taxa / 400), int(taxa / 70); res = []
    for x in fr:
        x = x - x.mean(); c = np.correlate(x, x, "full")[q - 1:]
        if c[0] <= 0: continue
        c = c / c[0]; seg = c[lmin:lmax]; i = int(seg.argmax())
        if seg[i] > 0.55: res.append(taxa / (lmin + i))
    return (float(np.median(res)) if len(res) >= 3 else 0.0), len(res)
arqs = sorted(p for p in WAV.glob("*.wav") if "_Dabing_" in p.name)
with open(SAIDA, "w", encoding="utf-8", newline="") as f:
    w = csv.writer(f, delimiter=";"); w.writerow(["wav", "f0", "quadros"])
    for i, p in enumerate(arqs, 1):
        try: v, n = f0(p)
        except Exception as e: v, n = 0.0, 0
        w.writerow([p.name, f"{v:.1f}", n])
        if i % 2000 == 0: print(i, len(arqs), flush=True)
print("FIM", SAIDA)
