# transcrever-audios.py - transcreve as falas EN originais (04-export\wav) com faster-whisper.
# Retomavel: pula o que ja esta no CSV de saida. So processa arquivos de fala (_Dabing_).
# uso: python -I transcrever-audios.py [modelo=small.en] [limite] [filtro-regex]
import csv, os, re, sys, time
from pathlib import Path
RAIZ = Path(r"D:\SteamLibrary\steamapps\common\Mafia II Definitive Edition\DublagemIA")
BASE = RAIZ / "09-transcricao"
sys.modules["torch"] = None  # torch global quebrado (c10.dll) e desnecessario
sys.path.insert(0, str(BASE / "_pylib"))  # ctranslate2 4.4.0 (o 4.8.3 da access violation nesta maquina)
os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")
os.environ.setdefault("HF_HOME", str(BASE / "_modelos"))
from faster_whisper import WhisperModel
import wave
import numpy as np

def carregar16k(p):
    # le WAV PCM16 e reamostra para 16 kHz mono (evita PyAV, incompativel com esta versao)
    with wave.open(str(p), "rb") as w:
        ch, taxa, n = w.getnchannels(), w.getframerate(), w.getnframes()
        a = np.frombuffer(w.readframes(n), dtype="<i2").astype(np.float32) / 32768.0
    if ch > 1: a = a.reshape(-1, ch).mean(axis=1)
    if taxa != 16000 and len(a):
        k = max(1, int(round(taxa / 16000)))
        if k > 1: a = np.convolve(a, np.ones(k, np.float32) / k, mode="same")  # passa-baixa simples antes de decimar
        t = np.arange(0, len(a) / taxa, 1 / 16000)
        a = np.interp(t, np.arange(len(a)) / taxa, a).astype(np.float32)
    return a

WAV = RAIZ / "04-export" / "wav"
modelo = sys.argv[1] if len(sys.argv) > 1 else "small.en"
limite = int(sys.argv[2]) if len(sys.argv) > 2 else 10**9
arg3 = sys.argv[3] if len(sys.argv) > 3 else ""
if arg3.startswith("@"):   # @arquivo = lista de nomes (um por linha, so o final do nome basta)
    _nomes = [l.strip() for l in Path(arg3[1:]).read_text(encoding="utf-8").splitlines() if l.strip()]
    class _F:
        def search(self, n): return any(n.endswith(x) for x in _nomes)
    filtro = _F()
else:
    filtro = re.compile(arg3) if arg3 else None
SAIDA = Path(os.environ["TRANSCR_SAIDA"]) if os.environ.get("TRANSCR_SAIDA") else BASE / f"transcricoes-en.{modelo}.csv"
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

feitos = set()
if SAIDA.exists():
    with open(SAIDA, encoding="utf-8", newline="") as f:
        for row in csv.DictReader(f, delimiter=";"):
            feitos.add(row["wav"])
todos = sorted(p for p in WAV.glob("*.wav") if "_Dabing_" in p.name and (not filtro or filtro.search(p.name)))
pend = [p for p in todos if p.name not in feitos][:limite]
print(f"[INFO] modelo={modelo} fala={len(todos)} feitos={len(feitos)} pendentes={len(pend)}", flush=True)

m = WhisperModel(modelo, device="cpu", compute_type="int8", cpu_threads=os.cpu_count())
novo = not SAIDA.exists()
t0 = time.time(); seg_audio = 0.0
with open(SAIDA, "a", encoding="utf-8", newline="") as f:
    w = csv.writer(f, delimiter=";")
    if novo: w.writerow(["wav", "dur", "texto", "logprob"])
    for i, p in enumerate(pend, 1):
        try:
            segs, info = m.transcribe(carregar16k(p), language="en", beam_size=1, vad_filter=False,
                                      condition_on_previous_text=False, without_timestamps=True)
            segs = list(segs)
            txt = " ".join(s.text.strip() for s in segs).strip()
            lp = min((s.avg_logprob for s in segs), default=0.0)
            w.writerow([p.name, f"{info.duration:.3f}", txt, f"{lp:.2f}"])
            seg_audio += info.duration
        except Exception as e:
            print(f"[ERRO] {p.name}: {e}", flush=True)
        if i % 25 == 0 or i == len(pend):
            f.flush(); dt = time.time() - t0
            print(f"[PROG] {i}/{len(pend)} audio={seg_audio/60:.1f}min tempo={dt/60:.1f}min x{seg_audio/max(dt,1e-6):.1f} tempo-real", flush=True)
print("[FIM]", SAIDA, flush=True)




