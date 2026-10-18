# detectar-idioma.py - detecta o idioma e transcreve falas com o Whisper multilingue (modelo "small").
# Para falas que o small.en (so ingles) nao entendeu, ex.: gangues que falam outro idioma.
# uso: python -I detectar-idioma.py <filtro-regex> <saida.csv>     (le 04-export\wav\*.wav)
import csv, os, re, sys
from pathlib import Path
RAIZ = Path(r"D:\SteamLibrary\steamapps\common\Mafia II Definitive Edition\DublagemIA")
BASE = RAIZ / "09-transcricao"
sys.modules["torch"] = None
sys.path.insert(0, str(BASE / "_pylib"))
os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")
os.environ.setdefault("HF_HOME", str(BASE / "_modelos"))
sys.path.insert(0, str(RAIZ / "02-ferramentas"))
from faster_whisper import WhisperModel
import wave
import numpy as np
src = (RAIZ / "02-ferramentas" / "transcrever-audios.py").read_text(encoding="utf-8")
exec(src[src.index("def carregar16k"):src.index("WAV = ")])   # reaproveita o leitor de WAV sem rodar o script

sys.stdout.reconfigure(encoding="utf-8", errors="replace")   # -I ignora PYTHONIOENCODING
filtro, saida = re.compile(sys.argv[1]), Path(sys.argv[2])
wavs = sorted(p for p in (RAIZ / "04-export" / "wav").glob("*.wav") if filtro.search(p.name))
m = WhisperModel("small", device="cpu", compute_type="int8")
with open(saida, "w", newline="", encoding="utf-8") as f:
    w = csv.writer(f, delimiter=";"); w.writerow(["wav", "idioma", "prob", "texto"])
    for p in wavs:
        segs, info = m.transcribe(carregar16k(p), beam_size=1, vad_filter=False)
        txt = " ".join(s.text.strip() for s in segs).strip()
        w.writerow([p.name, info.language, f"{info.language_probability:.2f}", txt]); f.flush()
        print(f"{p.name[-40:]} {info.language} {info.language_probability:.2f} | {txt[:70]}", flush=True)
