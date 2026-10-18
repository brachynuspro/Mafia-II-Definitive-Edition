# embeddings-voz.py - "impressao vocal" (embedding de locutor, WeSpeaker ResNet34 ONNX) de cada fala EN original.
# Base para agrupar falas por ator (agrupar-atores.py). Saida: 04-export\embeddings\{lista.txt, emb.npy}
# uso: python -I embeddings-voz.py [filtro-regex] [--teste]
import ctypes, os, re, sys, wave
from pathlib import Path
import numpy as np
RAIZ = Path(r"D:\SteamLibrary\steamapps\common\Mafia II Definitive Edition\DublagemIA")
VCRT = RAIZ / "09-transcricao" / "_vcrt"   # runtime VC++ 14.50 (o sistema nao tem; o do Python e antigo)
os.add_dll_directory(str(VCRT))
for n in ("vcruntime140_1.dll", "msvcp140.dll", "msvcp140_1.dll"): ctypes.WinDLL(str(VCRT / n))
import onnxruntime as ort
MODELO = next((RAIZ / "09-transcricao" / "_modelos").rglob("voxceleb_resnet34_LM.onnx"))
WAV = RAIZ / "04-export" / "wav"; OUT = RAIZ / "04-export" / "embeddings"

def carregar16k(p):
    with wave.open(str(p), "rb") as w:
        ch, taxa = w.getnchannels(), w.getframerate()
        a = np.frombuffer(w.readframes(w.getnframes()), "<i2").astype(np.float32)
    if ch > 1: a = a.reshape(-1, ch).mean(1)
    if taxa != 16000 and len(a):
        k = max(1, int(round(taxa / 16000)))
        if k > 1: a = np.convolve(a, np.ones(k, np.float32) / k, "same")
        t = np.arange(0, len(a) / taxa, 1 / 16000)
        a = np.interp(t, np.arange(len(a)) / taxa, a).astype(np.float32)
    return a  # escala int16 (como o Kaldi/WeSpeaker esperam)

def _mel(n_mels=80, nfft=512, sr=16000, fmin=20.0, fmax=8000.0):
    mel = lambda f: 1127.0 * np.log(1 + f / 700.0)
    m = np.linspace(mel(fmin), mel(fmax), n_mels + 2)
    fb = np.zeros((n_mels, nfft // 2 + 1), np.float32); fr = mel(np.arange(nfft // 2 + 1) * sr / nfft)
    for i in range(n_mels):
        l, c, r = m[i], m[i + 1], m[i + 2]
        fb[i] = np.maximum(0, np.minimum((fr - l) / (c - l), (r - fr) / (r - c)))
    return fb
MEL = _mel(); JAN = (0.5 - 0.5 * np.cos(2 * np.pi * np.arange(400) / 399)) ** 0.85

def fbank(a):   # fbank estilo Kaldi: 25 ms / 10 ms, pre-enfase 0.97, janela povey, 80 mel, log, CMN
    if len(a) < 400: a = np.pad(a, (0, 400 - len(a)))
    fr = np.lib.stride_tricks.sliding_window_view(a, 400)[::160].astype(np.float32)
    fr = fr - fr.mean(1, keepdims=True)
    fr = np.concatenate([fr[:, :1] * (1 - 0.97), fr[:, 1:] - 0.97 * fr[:, :-1]], 1) * JAN
    pw = np.abs(np.fft.rfft(fr, 512)) ** 2
    f = np.log(np.maximum(pw @ MEL.T, 1.19e-7))
    return (f - f.mean(0)).astype(np.float32)

sess = ort.InferenceSession(str(MODELO), providers=["CPUExecutionProvider"])
def embedding(p):
    a = carregar16k(p)
    if len(a) < 16000 * 0.6: return None
    e = sess.run(None, {"feats": fbank(a)[None]})[0][0]
    return e / np.linalg.norm(e)

if __name__ == "__main__":
    filtro = re.compile(sys.argv[1]) if len(sys.argv) > 1 and not sys.argv[1].startswith("--") else None
    arqs = sorted(p for p in WAV.glob("*.wav") if "_Dabing_" in p.name and (not filtro or filtro.search(p.name)))
    if "--teste" in sys.argv:
        E = [(p.name.split("_Dabing_")[-1], embedding(p)) for p in arqs]; E = [(n, e) for n, e in E if e is not None]
        M = np.array([e for _, e in E]); S = M @ M.T
        for i, (n, _) in enumerate(E): print(f"{n[-24:]:>24} " + " ".join(f"{v:5.2f}" for v in S[i]))
        sys.exit()
    OUT.mkdir(parents=True, exist_ok=True); nomes, embs = [], []
    for i, p in enumerate(arqs, 1):
        try: e = embedding(p)
        except Exception as ex: e = None
        if e is not None: nomes.append(p.name); embs.append(e.astype(np.float32))
        if i % 1000 == 0: print(i, len(arqs), flush=True)
    np.save(OUT / "emb.npy", np.array(embs)); (OUT / "lista.txt").write_text("\n".join(nomes), encoding="utf-8")
    print("FIM", len(nomes), "embeddings")
