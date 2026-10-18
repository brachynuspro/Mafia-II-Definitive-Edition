#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
traduzir-legendas.py v4
Usa o endpoint Google Translate `client=at` (não rate-limited como `client=gtx`).
Cache persistente com case-insensitive lookup.
"""
import csv
import sys
import time
import json
import re
import urllib.request
import urllib.parse
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

KEEP_TERMS = [
    "Vito", "Joe", "Brusky", "Derek", "Henry", "Giuseppe", "Marty", "Steve",
    "Frank", "Eddie", "Harry", "Rocco", "Tony", "Luca", "Freddy", "Carlo",
    "Mike", "Mikey", "Paulie", "Sal", "Sam", "Tommy", "Leo",
    "Maria", "Anna", "Carla", "Lucia", "Gina", "Sophia", "Bobby",
    "Jack", "Sid", "Sidney", "Mickey", "Bruno", "Carl", "Eli", "Sean",
    "Mussolini", "Sicily", "Sicilia", "Brooklyn", "Manhattan",
    "Mamma's", "Mamma", "Corleone", "paesano", "paesani", "paisan",
    "omertà", "capisce", "capiche", "mamma mia", "Don",
    "Freddy's", "Empire Bay", "504th", "Parachute Infantry",
    "Kraut", "Krauts", "Mick", "Micks", "Irish", "Italians",
    "Sicilian", "Sicilians", "Mr. Gurino", "Gurino",
]

URL = "https://translate.googleapis.com/translate_a/single?client=at&sl=en&tl=pt&dt=t&q={}"


def token_for(i):
    return chr(0xE000 + i)


def load_cache():
    if CACHE.exists():
        try:
            raw = json.loads(CACHE.read_text(encoding="utf-8"))
            return {k.lower(): v for k, v in raw.items()}
        except Exception:
            pass
    return {}


def save_cache(cache):
    CACHE.write_text(json.dumps(cache, ensure_ascii=False, indent=2), encoding="utf-8")


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


def apply_keep_terms(texto):
    protected = []
    for i, term in enumerate(KEEP_TERMS):
        if term in texto:
            token = token_for(i)
            protected.append((token, term))
            texto = texto.replace(term, token)
    return texto, protected


def restore_keep_terms(texto, protected):
    for token, term in protected:
        texto = texto.replace(token, term)
    return texto


def is_bad_translation(texto_pt, protected):
    for token, _ in protected:
        if token in texto_pt:
            return True
    return False


def translate_google_at(text):
    """Traduz via Google Translate `client=at` endpoint."""
    url = URL.format(urllib.parse.quote(text))
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req, timeout=15) as r:
        data = json.loads(r.read().decode())
    return "".join(p[0] for p in data[0] if p[0])


def translate_one(text_en, cache):
    if not text_en:
        return None
    if text_en in cache:
        cached = cache[text_en]
        if cached.startswith("[FALHOU]"):
            return None  # re-tenta
        return cached

    masked, protected = apply_keep_terms(text_en)
    last_err = None
    for attempt in range(4):
        try:
            r = translate_google_at(masked)
            r = restore_keep_terms(r, protected).strip().strip('"').strip("'")
            if not is_bad_translation(r, protected) and len(r) > 0:
                cache[text_en] = r
                return r
            # Fallback sem máscara
            r = translate_google_at(text_en)
            cache[text_en] = r.strip().strip('"').strip("'")
            return cache[text_en]
        except urllib.error.HTTPError as e:
            last_err = e
            if e.code == 429:
                time.sleep(10.0 * (attempt + 1))  # backoff longo
            else:
                time.sleep(2.0 * (attempt + 1))
        except Exception as e:
            last_err = e
            time.sleep(2.0 * (attempt + 1))
    cache[text_en] = f"[FALHOU] {text_en}"
    return None


def main():
    by_text = collect_unique_texts()
    print(f"[INFO] {len(by_text)} textos únicos", flush=True)
    cache = load_cache()
    validos = sum(1 for v in cache.values() if not v.startswith("[FALHOU]"))
    print(f"[INFO] cache: {validos} válidos, {len(by_text)-validos} pendentes", flush=True)

    saida = []
    done = 0
    erros = 0
    t0 = time.time()
    for texto_norm, ocs in by_text.items():
        texto_en = ocs[0][3]
        pt = translate_one(texto_en, cache)
        if pt is None:
            erros += 1
        done += 1
        for sds, slot, personagem, _ in ocs:
            saida.append((sds, slot, personagem, texto_en, pt or ""))
        if done % 25 == 0 or done == len(by_text):
            elapsed = time.time() - t0
            rate = (done - validos) / elapsed if elapsed > 0 else 0
            print(f"[PROG] {done}/{len(by_text)} (validos={validos}, erros={erros}) "
                  f"em {elapsed:.1f}s ({rate:.2f}/s novos)", flush=True)
            save_cache(cache)

    save_cache(cache)

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
    validos = sum(1 for v in cache.values() if not v.startswith("[FALHOU]"))
    print(f"[OK] {len(visto)} linhas escritas em {OUT}", flush=True)
    print(f"[OK] {total_pt} linhas com PT-BR válido, {validos} textos únicos traduzidos", flush=True)


if __name__ == "__main__":
    main()
