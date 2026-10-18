import ctypes, os, sys, time, wave
from pathlib import Path
R = Path(r"D:\SteamLibrary\steamapps\common\Mafia II Definitive Edition\DublagemIA")
V = R / "09-transcricao" / "_vcrt"; os.add_dll_directory(str(V))
for n in ("vcruntime140_1.dll", "msvcp140.dll", "msvcp140_1.dll"): ctypes.WinDLL(str(V / n))
sys.path.insert(0, str(R / "10-tts-local" / "_pylib"))
import numpy as np
from kokoro_onnx import Kokoro
k = Kokoro(str(R / "10-tts-local" / "modelos" / "kokoro-v1.0.int8.onnx"), str(R / "10-tts-local" / "modelos" / "voices-v1.0.bin"))
print("vozes pt:", [v for v in k.get_voices() if v.startswith("p")])
txt = "Operação Husky: eu fui designado pra 504ª infantaria paraquedista."
for v in ("pm_alex", "pm_santa", "pf_dora"):
    t = time.time(); a, sr = k.create(txt, voice=v, speed=1.0, lang="pt-br"); dt = time.time() - t
    with wave.open(str(R / "08-repack" / "_tmp" / f"kokoro_{v}.wav"), "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr); w.writeframes((np.clip(a, -1, 1) * 32767).astype("<i2").tobytes())
    print(f"{v}: audio={len(a)/sr:.2f}s tempo={dt:.2f}s ({len(a)/sr/dt:.1f}x tempo real) sr={sr}")
