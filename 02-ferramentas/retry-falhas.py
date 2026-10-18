#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
retry-falhas.py
Re-tenta apenas as entradas [FALHOU] no cache usando backoff longo.
"""
import json
import sys
import time
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

CACHE = Path(r"D:\SteamLibrary\steamapps\common\Mafia II Definitive Edition\DublagemIA\04-export\_traducoes-cache.json")

cache = json.loads(CACHE.read_text(encoding="utf-8"))
validos = sum(1 for v in cache.values() if not v.startswith("[FALHOU]"))
print(f"Cache atual: {len(cache)} entries, {validos} válidos", flush=True)

from translate import Translator

def translate_mm(t):
    return Translator(from_lang="en", to_lang="pt-BR", provider="mymemory", email="dublagem-mafia2-translate@klebersantos.dev").translate(t)

def translate_gg(t):
    return Translator(from_lang="en", to_lang="pt").translate(t)

done = 0
erros = 0
t0 = time.time()
falhas = [k for k, v in cache.items() if v.startswith("[FALHOU]")]
print(f"Re-tentando {len(falhas)} entradas...", flush=True)

for i, k in enumerate(falhas):
    r = None
    # tenta MyMemory com backoff longo
    for attempt in range(3):
        try:
            r = translate_mm(k)
            if r and r.strip():
                break
        except Exception as e:
            time.sleep(3.0 * (attempt + 1))
    if r and r.strip():
        cache[k] = r.strip()
        done += 1
    else:
        # tenta Google com backoff longo
        for attempt in range(2):
            try:
                r = translate_gg(k)
                if r and r.strip():
                    break
            except Exception as e:
                time.sleep(5.0 * (attempt + 1))
        if r and r.strip():
            cache[k] = r.strip()
            done += 1
        else:
            erros += 1
    if (i+1) % 25 == 0 or i == len(falhas)-1:
        elapsed = time.time() - t0
        rate = (i+1) / elapsed if elapsed > 0 else 0
        print(f"  [{i+1}/{len(falhas)}] sucessos={done} erros={erros} rate={rate:.2f}/s elapsed={elapsed:.0f}s", flush=True)
        CACHE.write_text(json.dumps(cache, ensure_ascii=False, indent=2), encoding="utf-8")

CACHE.write_text(json.dumps(cache, ensure_ascii=False, indent=2), encoding="utf-8")
validos = sum(1 for v in cache.values() if not v.startswith("[FALHOU]"))
print(f"[OK] Cache final: {validos}/{len(cache)} válidos", flush=True)
