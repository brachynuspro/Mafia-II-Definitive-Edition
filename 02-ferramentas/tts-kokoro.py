# tts-kokoro.py - sintetiza um lote de falas PT-BR com Kokoro (ONNX, local, CPU). Carrega o modelo uma vez.
# uso: python -I tts-kokoro.py <lote.json>    lote = [{"texto":..., "voz":"pm_alex", "velocidade":1.0, "saida":"x.wav"}, ...]
import ctypes, json, os, sys, wave
from pathlib import Path
R = Path(r"D:\SteamLibrary\steamapps\common\Mafia II Definitive Edition\DublagemIA")
V = R / "09-transcricao" / "_vcrt"; os.add_dll_directory(str(V))   # runtime VC++ 14.50 (ausente no sistema)
for n in ("vcruntime140_1.dll", "msvcp140.dll", "msvcp140_1.dll"): ctypes.WinDLL(str(V / n))
sys.path.insert(0, str(R / "10-tts-local" / "_pylib"))
import numpy as np
from kokoro_onnx import Kokoro
M = R / "10-tts-local" / "modelos"
k = Kokoro(str(M / "kokoro-v1.0.int8.onnx"), str(M / "voices-v1.0.bin"))
_estilos = {}
def estilo(voz):
    """'pm_santa' ou mistura 'pm_santa:0.6+am_onyx:0.4' (média ponderada dos estilos; cria timbres novos)."""
    if "+" not in voz and ":" not in voz:
        return voz
    if voz not in _estilos:
        partes = [(p.split(":")[0].strip(), float(p.split(":")[1]) if ":" in p else 1.0) for p in voz.split("+")]
        total = sum(w for _, w in partes)
        _estilos[voz] = sum(k.get_voice_style(n) * (w / total) for n, w in partes).astype(np.float32)
    return _estilos[voz]
lote = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8")); falhas = 0
for j in lote:
    try:
        a, sr = k.create(j["texto"], voice=estilo(j["voz"]), speed=float(j.get("velocidade", 1.0)), lang="pt-br")
        with wave.open(j["saida"], "wb") as w:
            w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr)
            w.writeframes((np.clip(a, -1, 1) * 32767).astype("<i2").tobytes())
    except Exception as e:
        falhas += 1; print("ERRO", j["saida"], e, flush=True)
print("OK", len(lote) - falhas, "falhas", falhas, flush=True)
