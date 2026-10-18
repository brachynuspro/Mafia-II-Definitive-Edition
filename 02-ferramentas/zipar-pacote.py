#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Gera o zip de distribuição da dublagem com permissões Unix.

O Compress-Archive / "Enviar para > Pasta compactada" do Windows não grava permissões:
no Linux/macOS os scripts saem sem o bit de execução e dão "Permissão negada".
Aqui cada entrada é marcada como criada em Unix, com 0755 para scripts e 0644 para o resto.
Os .sds vão sem compressão (já são compactados; comprimir de novo só gasta tempo).

uso: python 02-ferramentas\\zipar-pacote.py [pasta-do-pacote] [saida.zip]
     padrão: 10-pacote\\Mafia2DE-Dublagem-PTBR  ->  10-pacote\\Mafia2DE-Dublagem-PTBR.zip
"""
import os
import sys
import time
import zipfile
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
PASTA = Path(sys.argv[1]) if len(sys.argv) > 1 else RAIZ / "10-pacote" / "Mafia2DE-Dublagem-PTBR"
SAIDA = Path(sys.argv[2]) if len(sys.argv) > 2 else PASTA.with_suffix(".zip")
EXECUTAVEIS = {".py", ".sh", ".command"}
IGNORAR = {"__pycache__", "instalador.log", "instalador-linux.log"}

tmp = SAIDA.with_name(SAIDA.name + ".tmp")
arquivos = sorted(p for p in PASTA.rglob("*") if not (IGNORAR & set(p.relative_to(PASTA).parts)))
t0 = time.time()
with zipfile.ZipFile(str(tmp), "w", zipfile.ZIP_DEFLATED, compresslevel=6) as z:
    for i, p in enumerate(arquivos, 1):
        nome = (PASTA.name / p.relative_to(PASTA)).as_posix()
        if p.is_dir():
            info = zipfile.ZipInfo(nome + "/", time.localtime(p.stat().st_mtime)[:6])
            info.create_system = 3
            info.external_attr = (0o40755 << 16) | 0x10
            z.writestr(info, b"")
            continue
        info = zipfile.ZipInfo.from_file(str(p), nome)
        info.create_system = 3  # Unix: faz o unzip/Ark/Nautilus/Finder respeitar o modo abaixo
        modo = 0o755 if p.suffix.lower() in EXECUTAVEIS else 0o644
        info.external_attr = (0o100000 | modo) << 16
        info.compress_type = zipfile.ZIP_STORED if p.suffix.lower() == ".sds" else zipfile.ZIP_DEFLATED
        with open(p, "rb") as f, z.open(info, "w", force_zip64=True) as dst:
            while True:
                bloco = f.read(1 << 20)
                if not bloco:
                    break
                dst.write(bloco)
        if i % 50 == 0:
            print("  %d/%d" % (i, len(arquivos)), flush=True)
os.replace(str(tmp), str(SAIDA))
print("zip: %s (%.2f GB, %d entradas, %.0f s)" % (SAIDA, SAIDA.stat().st_size / 2**30, len(arquivos), time.time() - t0))
