#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
finalizar-traducoes.py
Lê cache existente e gera traducoes-pt.csv SEM chamar APIs.
Use quando a tradução está completa (ou aceita como está).
"""
import csv
import sys
import json
from pathlib import Path
from collections import defaultdict

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

RAIZ = Path(r"D:\SteamLibrary\steamapps\common\Mafia II Definitive Edition")
LEGENDAS = RAIZ / "DublagemIA" / "03-legendas"
OUT = RAIZ / "DublagemIA" / "04-export" / "traducoes-pt.csv"
CACHE = RAIZ / "DublagemIA" / "04-export" / "_traducoes-cache.json"

CSVS_IN = [
    LEGENDAS / "falas-originais.csv",
    LEGENDAS / "falas-missoes.csv",
    LEGENDAS / "falas-cutscenes.csv",
]


def load_cache():
    if CACHE.exists():
        try:
            raw = json.loads(CACHE.read_text(encoding="utf-8"))
            return {k.lower(): v for k, v in raw.items()}
        except Exception:
            pass
    return {}


def collect_unique_texts():
    by_text = defaultdict(list)
    for csv_path in CSVS_IN:
        if not csv_path.exists():
            continue
        with open(csv_path, "r", encoding="utf-8") as f:
            rdr = csv.reader(f, delimiter=";")
            next(rdr, None)
            for row in rdr:
                if len(row) < 4:
                    continue
                sds, slot, personagem, texto = row[0], row[1], row[2], row[3]
                texto = texto.strip()
                if not texto:
                    continue
                by_text[texto.lower()].append((sds, slot, personagem, texto))
    return by_text


def main():
    by_text = collect_unique_texts()
    cache = load_cache()

    validos = sum(1 for v in cache.values() if not v.startswith("[FALHOU]"))
    print(f"[INFO] {len(by_text)} textos únicos, {validos} válidos no cache", flush=True)

    with open(OUT, "w", encoding="utf-8", newline="") as f:
        w = csv.writer(f, delimiter=";")
        w.writerow(["sds", "slot", "personagem", "texto_en", "texto_pt"])
        visto = set()
        total_pt = 0
        for texto_norm, ocs in by_text.items():
            texto_en = ocs[0][3]
            pt = cache.get(texto_norm, "")
            if not pt or pt.startswith("[FALHOU]"):
                pt = ""
            for sds, slot, personagem, _ in ocs:
                key = (sds, slot)
                if key in visto:
                    continue
                visto.add(key)
                w.writerow([sds, slot, personagem, texto_en, pt])
                if pt:
                    total_pt += 1
    print(f"[OK] {len(visto)} linhas escritas em {OUT}", flush=True)
    print(f"[OK] {total_pt} linhas com PT-BR válido ({total_pt/len(visto)*100:.1f}%)", flush=True)


if __name__ == "__main__":
    main()
