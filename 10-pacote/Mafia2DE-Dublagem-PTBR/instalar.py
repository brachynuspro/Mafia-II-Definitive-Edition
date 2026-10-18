#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Instalador da Dublagem PT-BR - Mafia II: Definitive Edition.

Funciona no Linux (Steam/Proton, inclusive Steam Deck, Flatpak e Snap), no macOS
(CrossOver/Whisky/Wine) e no Windows. Usa só a biblioteca padrão do Python 3.6+.
Abre uma janela se o tkinter estiver disponível; senão, roda no terminal.

uso:  python3 instalar.py               (janela, ou terminal se não houver tkinter)
      python3 instalar.py --terminal    (força o modo terminal)

Tudo o que acontece fica registrado em instalador.log, ao lado deste arquivo.
"""
import os
import platform
import queue
import re
import shutil
import subprocess
import sys
import threading
import time
import traceback
from pathlib import Path
from urllib.parse import unquote

APPID = "1030830"
NOME = "Mafia II Definitive Edition"
EXE = "Mafia II Definitive Edition.exe"
PACOTE = Path(__file__).resolve().parent
ORIGEM = PACOTE / "dublagem" / "pc"
LOG = PACOTE / "instalador.log"
SO = platform.system()  # Linux, Darwin, Windows
HOME = Path.home()
SUFIXO_BACKUP_PERFIL = ".antes-dublagem"
ROOT = SO != "Windows" and os.geteuid() == 0


def homes():
    """Pastas pessoais onde procurar a Steam. Como root (sudo), olha as dos usuários."""
    if not ROOT:
        return [HOME]
    r = []
    usuario = os.environ.get("SUDO_USER")
    if usuario:
        try:
            import pwd
            r.append(Path(pwd.getpwnam(usuario).pw_dir))
        except (ImportError, KeyError):
            pass
    for base in ("/home", "/Users"):
        try:
            r += [p for p in Path(base).iterdir() if p.is_dir()]
        except OSError:
            pass
    return r + [HOME]


def igualar_dono(novo, referencia):
    """Como root, devolve o arquivo novo ao dono do original (senão a Steam/o jogo perdem acesso)."""
    if not ROOT:
        return
    try:
        st = os.stat(str(referencia))
        os.chown(str(novo), st.st_uid, st.st_gid)
    except OSError:
        pass

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(errors="replace")
    except Exception:
        pass


# --- saída (terminal ou janela) + log ------------------------------------------
_escrever = print


def info(msg=""):
    try:
        with open(LOG, "a", encoding="utf-8") as f:
            f.write(time.strftime("%H:%M:%S ") + msg + "\n")
    except OSError:
        pass
    _escrever(msg)


class Erro(Exception):
    """Erro com mensagem para o usuário (sem traceback)."""


# --- caminhos sem diferenciar maiúsculas (Linux/macOS diferenciam) -------------
def achar_ci(base, partes):
    """Resolve base/partes ignorando maiúsculas/minúsculas. None se não existir."""
    cur = Path(base)
    for p in partes:
        cand = cur / p
        if cand.exists():
            cur = cand
            continue
        try:
            baixo = p.lower()
            cand = next((c for c in cur.iterdir() if c.name.lower() == baixo), None)
        except OSError:
            cand = None
        if cand is None:
            return None
        cur = cand
    return cur


def eh_pasta_do_jogo(p):
    if not p:
        return False
    sds = achar_ci(p, ["pc", "sds"])
    return bool(sds and sds.is_dir())


# --- onde está o Steam / o jogo ------------------------------------------------
def raizes_steam():
    r = []
    if SO == "Windows":
        try:
            import winreg
            for hive, chave in ((winreg.HKEY_CURRENT_USER, r"Software\Valve\Steam"),
                                (winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\WOW6432Node\Valve\Steam")):
                try:
                    with winreg.OpenKey(hive, chave) as k:
                        for nome in ("SteamPath", "InstallPath"):
                            try:
                                r.append(Path(winreg.QueryValueEx(k, nome)[0]))
                            except OSError:
                                pass
                except OSError:
                    pass
        except ImportError:
            pass
        r.append(Path(os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)")) / "Steam")
    elif SO == "Darwin":
        garrafas = []
        for h in homes():
            for b in (h / "Library/Application Support/CrossOver/Bottles",
                      h / "Library/Containers/com.isaacmarovitz.Whisky/Bottles"):
                try:
                    garrafas += [x for x in b.iterdir() if x.is_dir()]
                except OSError:
                    pass
            garrafas.append(h / ".wine")
        for g in garrafas:
            for s in ("drive_c/Program Files (x86)/Steam", "drive_c/Program Files/Steam"):
                r.append(g / s)
    else:
        for h in homes():
            for s in (".steam/steam", ".steam/root", ".local/share/Steam",
                      ".var/app/com.valvesoftware.Steam/.local/share/Steam",  # Flatpak
                      ".var/app/com.valvesoftware.Steam/data/Steam",
                      "snap/steam/common/.local/share/Steam",                 # Snap
                      ".wine/drive_c/Program Files (x86)/Steam"):
                r.append(h / s)
    return r


def bibliotecas():
    libs = []
    for raiz in raizes_steam():
        if not raiz.is_dir():
            continue
        libs.append(raiz)
        vdf = achar_ci(raiz, ["steamapps", "libraryfolders.vdf"])
        if not vdf:
            continue
        try:
            txt = vdf.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        for m in re.finditer(r'"path"\s+"([^"]+)"', txt):
            libs.append(Path(m.group(1).replace("\\\\", "\\")))
    vistos, saida = set(), []
    for l in libs:
        try:
            k = str(l.resolve())
        except OSError:
            k = str(l)
        if k not in vistos and l.is_dir():
            vistos.add(k)
            saida.append(l)
    return saida


def achar_jogo():
    for lib in bibliotecas():
        c = achar_ci(lib, ["steamapps", "common", NOME])
        if eh_pasta_do_jogo(c):
            return c
    return None


def limpar_caminho(txt):
    """Aceita caminho digitado, colado ou arrastado para o terminal."""
    t = txt.strip()
    if t.startswith("file://"):
        t = unquote(t[7:])
    if len(t) >= 2 and t[0] == t[-1] and t[0] in "'\"":
        t = t[1:-1]
    if SO != "Windows":
        t = re.sub(r"\\(.)", r"\1", t)  # "Mafia\ II" -> "Mafia II"
    t = t.rstrip("/\\") or t
    p = Path(os.path.expanduser(t))
    if p.name.lower() == "pc":
        p = p.parent
    return p


# --- perfis do jogo (settings.xml guarda o idioma) -----------------------------
def varrer_prefixos_proton():
    """Equivale a:  find ~/.local/share/Steam ~/.steam ~/.var/app/com.valvesoftware.Steam /run/media /mnt
                         -path '*compatdata/1030830/pfx'
    Acha o prefixo do Proton deste jogo em qualquer biblioteca/disco (Bazzite, Steam Deck, cartão SD,
    disco do Windows montado...). Só desce em steamapps/compatdata/<APPID>, sem varrer os jogos."""
    raizes = []
    for h in homes():
        raizes += [h / ".local/share/Steam", h / ".steam", h / ".var/app/com.valvesoftware.Steam"]
    raizes += [Path("/run/media"), Path("/mnt"), Path("/media")]
    achados, vistos = [], set()
    for raiz in raizes:
        if not raiz.is_dir():
            continue
        base = len(raiz.parts)
        for atual, pastas, _ in os.walk(str(raiz), followlinks=False):
            cur = Path(atual)
            prof = len(cur.parts) - base
            nome = cur.name.lower()
            if nome == "pfx" and cur.parent.name == APPID and cur.parent.parent.name.lower() == "compatdata":
                k = os.path.realpath(atual)
                if k not in vistos:
                    vistos.add(k)
                    achados.append(cur)
                pastas[:] = []
                continue
            if nome == "steamapps":        # dentro de steamapps só interessa compatdata
                pastas[:] = [p for p in pastas if p.lower() == "compatdata"]
            elif nome == "compatdata":     # e dentro de compatdata, só a pasta deste jogo
                pastas[:] = [p for p in pastas if p == APPID]
            elif cur.parent.name == APPID:  # compatdata/1030830 -> só pfx
                pastas[:] = [p for p in pastas if p.lower() == "pfx"]
            elif prof >= 9:                # não varre o disco inteiro
                pastas[:] = []
            else:                          # ignora pastas ocultas pesadas e lixeiras (exceto as da Steam)
                pastas[:] = [p for p in pastas if not p.startswith((".Trash", "$RECYCLE", "System Volume"))
                             and (not p.startswith(".") or p in (".local", ".steam", ".var", ".wine"))]
    return achados


def pastas_documentos(jogo):
    docs = []
    if SO == "Windows":
        try:
            import ctypes
            buf = ctypes.create_unicode_buffer(260)
            ctypes.windll.shell32.SHGetFolderPathW(None, 5, None, 0, buf)  # CSIDL_PERSONAL
            docs.append(Path(buf.value))
        except Exception:
            pass
        docs += [HOME / "Documents", HOME / "OneDrive" / "Documents", HOME / "OneDrive" / "Documentos"]
        return docs
    # Wine/Proton: <prefixo>/drive_c/users/<usuario>/Documents
    prefixos = []
    s = str(jogo)
    i = s.find("/drive_c/")
    if i >= 0:  # CrossOver, Whisky, Wine, Lutris
        prefixos.append(Path(s[:i]))
    # Proton: o prefixo pode estar em qualquer biblioteca, não só na do jogo
    for lib in bibliotecas() + [Path(jogo).parent.parent.parent]:
        p = achar_ci(lib, ["steamapps", "compatdata", APPID, "pfx"])
        if p:
            prefixos.append(p)
    if SO == "Linux":  # e em qualquer outro lugar (o prefixo nem sempre fica na biblioteca do jogo)
        prefixos += varrer_prefixos_proton()
    vistos = set()
    for pfx in prefixos:
        k = os.path.realpath(str(pfx))
        if k in vistos:
            continue
        vistos.add(k)
        info("  Prefixo do Proton: " + str(pfx))
        users = achar_ci(pfx, ["drive_c", "users"])
        if not users:
            continue
        try:
            contas = list(users.iterdir())
        except OSError:
            continue
        for u in contas:
            for d in ("Documents", "My Documents"):
                c = achar_ci(u, [d])
                if c and c.is_dir():
                    docs.append(c)
    return docs


def perfis(jogo, nome_arquivo="settings.xml"):
    vistos, saida = set(), []
    for d in pastas_documentos(jogo):
        base = achar_ci(d, ["My Games", NOME, "Data", "profiles"])
        if not base or not base.is_dir():
            continue
        for raiz, _, arquivos in os.walk(str(base)):
            for a in arquivos:
                if a.lower() == nome_arquivo.lower():
                    p = Path(raiz) / a
                    k = str(p.resolve())
                    if k not in vistos:
                        vistos.add(k)
                        saida.append(p)
    return saida


# --- idioma do jogo na Steam ---------------------------------------------------
# O launcher do jogo (Mafia2Launcher) só usa o <Language> do settings.xml se ele já existir; senão usa o
# idioma que a STEAM define para o jogo e grava esse valor no perfil. Por isso os dois precisam estar em pt-BR.
IDIOMA = "brazilian"
CAMINHO_MANUAL = "Steam > Biblioteca > Mafia II: Definitive Edition > Propriedades > Geral > Idioma > Português (Brasil)"


def steam_aberta():
    try:
        if SO == "Linux":
            for p in Path("/proc").iterdir():
                if p.name.isdigit():
                    try:
                        cmd = (p / "cmdline").read_bytes()
                    except OSError:
                        continue
                    if b"ubuntu12_32/steam" in cmd or b"com.valvesoftware.Steam" in cmd:
                        return True
            return False
        if SO == "Windows":
            out = subprocess.run(["tasklist", "/FI", "IMAGENAME eq steam.exe", "/NH"], stdout=subprocess.PIPE,
                                 stderr=subprocess.DEVNULL, universal_newlines=True).stdout
            return "steam.exe" in out.lower()
        out = subprocess.run(["ps", "-axo", "command"], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                             universal_newlines=True).stdout
        return "steam" in out.lower()
    except Exception:
        return False


def manifestos():
    r, vistos = [], set()
    for lib in bibliotecas():
        m = achar_ci(lib, ["steamapps", "appmanifest_%s.acf" % APPID])
        if m and m.is_file() and os.path.realpath(str(m)) not in vistos:
            vistos.add(os.path.realpath(str(m)))
            r.append(m)
    return r


def _blocos_idioma(linhas):
    """Indices (linha_do_bloco, abre, fecha, linha_language|None) dos blocos UserConfig/MountedConfig."""
    res, prof, pend, aberto = {}, 0, None, None
    for i, l in enumerate(linhas):
        t = l.strip()
        if t in ('"UserConfig"', '"MountedConfig"') and prof == 1:
            pend = t
        elif t == "{":
            prof += 1
            if pend:
                aberto = [pend, i, None, None]
                pend = None
        elif t == "}":
            if aberto and prof == 2:
                aberto[2] = i
                res[aberto[0]] = aberto
                aberto = None
            prof -= 1
        elif aberto and prof == 2 and t.startswith('"language"'):
            aberto[3] = i
    return res


def idioma_steam(acf):
    linhas = acf.read_text(encoding="utf-8", errors="replace").splitlines()
    b = _blocos_idioma(linhas).get('"UserConfig"')
    if b and b[3] is not None:
        m = re.search(r'"language"\s+"([^"]*)"', linhas[b[3]])
        return m.group(1) if m else ""
    return ""


def ajustar_idioma_steam(acf, lang):
    bruto = acf.read_bytes().decode("utf-8", errors="replace")
    fim = "\r\n" if "\r\n" in bruto else "\n"
    linhas = bruto.splitlines()
    nova = '\t\t"language"\t\t"%s"' % lang
    blocos = _blocos_idioma(linhas)
    for nome in ('"UserConfig"', '"MountedConfig"'):
        b = blocos.get(nome)
        if b and b[3] is not None:
            linhas[b[3]] = nova
    sem_lang = sorted((b for b in blocos.values() if b[3] is None), key=lambda b: b[2], reverse=True)
    for b in sem_lang:                                         # insere de baixo para cima (índices estáveis)
        linhas.insert(b[2], nova)
    faltam = [n for n in ('"UserConfig"', '"MountedConfig"') if n not in blocos]
    if faltam:
        ultimo = max(i for i, l in enumerate(linhas) if l.strip() == "}")
        extra = []
        for n in faltam:
            extra += ["\t" + n, "\t{", nova, "\t}"]
        linhas[ultimo:ultimo] = extra
    tmp = acf.with_name(acf.name + ".tmp-dublagem")
    tmp.write_bytes((fim.join(linhas) + fim).encode("utf-8"))
    igualar_dono(tmp, acf)
    os.replace(str(tmp), str(acf))


def arquivo_idioma_anterior(jogo):
    return pasta_backup(jogo).parent / "idioma-steam-anterior.txt"


def ativar_idioma_steam(jogo):
    """Põe o jogo em pt-BR na Steam. Só mexe com a Steam fechada (aberta, ela regrava o arquivo)."""
    acfs = manifestos()
    if not acfs:
        info("  (não achei o appmanifest do jogo; confira em: " + CAMINHO_MANUAL + ")")
        return
    for acf in acfs:
        atual = idioma_steam(acf) or "english"
        if atual == IDIOMA:
            info("  Steam: o jogo já está em português (Brasil).")
            continue
        if steam_aberta():
            info("  ATENÇÃO: a Steam está com o jogo em '%s'. Por isso o jogo cria o perfil em inglês." % atual)
            info("  Feche a Steam e rode a opção \"Só ativar o idioma português\", ou mude na mão em:")
            info("    " + CAMINHO_MANUAL)
            continue
        ant = arquivo_idioma_anterior(jogo)
        if not ant.exists():
            criar_pastas(ant.parent, jogo)
            ant.write_text(atual + "\n", encoding="utf-8")
        ajustar_idioma_steam(acf, IDIOMA)
        info("  Steam: idioma do jogo trocado de '%s' para português (Brasil)." % atual)


# Uma instalação limpa não tem 'info' em pc/sds. Outra tradução às vezes copia para lá o 'info' do pt-BR
# (+ dabing_resources.xml e sds_list.txt): o jogo lê o 'info' de todas as pastas pc/sds* e, como o de
# pc/sds é lido por último, passa a achar que o português está na pasta de inglês.
EXTRAS_PC_SDS = ("info", "dabing_resources.xml", "sds_list.txt")


def pasta_removidos(jogo):
    return pasta_backup(jogo).parent / "removidos-de-pc-sds"


def limpar_pasta_ingles(jogo):
    arq = achar_ci(jogo, ["pc", "sds", "info"])
    if not arq or not arq.is_file():
        return
    txt = arq.read_text(encoding="utf-8", errors="replace")
    if "<id>English</id>" in txt:
        return
    m = re.search(r"<id>([^<]*)", txt)
    info("  Há um arquivo de idioma '%s' dentro de pc/sds. Ele não vem da Steam (costuma ser resto de outra"
         % (m.group(1) if m else "?"))
    info("  tradução) e faz o jogo carregar a pasta de inglês mesmo com o perfil em português.")
    dest = pasta_removidos(jogo)
    criar_pastas(dest, jogo)
    n = 0
    for nome in EXTRAS_PC_SDS:
        f = achar_ci(jogo, ["pc", "sds", nome])
        if f and f.is_file():
            os.replace(str(f), str(dest / nome))
            n += 1
    info("  %d arquivo(s) tirado(s) de pc/sds e guardado(s) em %s" % (n, dest))


def ativar_portugues(jogo):
    limpar_pasta_ingles(jogo)
    ativar_idioma_steam(jogo)
    cfgs = perfis(jogo)
    if not cfgs:
        info("  Nenhum perfil do jogo encontrado (o jogo ainda não foi aberto neste computador).")
        info("  Com o jogo em português na Steam, o perfil já é criado em português na primeira vez.")
        info("  Se mesmo assim abrir em inglês: feche o jogo e use a opção \"Só ativar o idioma português\".")
        return False
    for c in cfgs:
        bak = c.with_name(c.name + SUFIXO_BACKUP_PERFIL)
        if not bak.exists():
            shutil.copy2(str(c), str(bak))
            igualar_dono(bak, c)
        txt = c.read_bytes().decode("latin-1")  # preserva os bytes do arquivo
        novo, n = re.subn(r"<Language>[^<]*</Language>", "<Language>brazilian</Language>", txt)
        if n == 0:
            info("  AVISO: sem <Language> em " + str(c))
            continue
        if novo != txt:
            c.write_bytes(novo.encode("latin-1"))
        info("  Idioma do perfil " + c.parent.name + ": português (Brasil)")
    return True


# --- jogo aberto? --------------------------------------------------------------
def jogo_aberto():
    try:
        if SO == "Linux":
            alvo = EXE.encode()
            for p in Path("/proc").iterdir():
                if p.name.isdigit():
                    try:
                        if alvo in (p / "cmdline").read_bytes():
                            return True
                    except OSError:
                        pass
            return False
        if SO == "Windows":
            cmd = ["tasklist", "/FI", "IMAGENAME eq " + EXE, "/NH"]
        else:
            cmd = ["ps", "-axo", "command"]
        out = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                             universal_newlines=True).stdout
        return EXE.lower() in out.lower()
    except Exception:
        return False


# --- instalar / remover --------------------------------------------------------
def copiar_seguro(origem, destino, dono=None):
    """Copia para um temporário e troca no fim: nunca deixa arquivo pela metade.
    dono: arquivo cujo dono o novo herda quando rodando como root (padrão: o destino atual)."""
    dono = dono or (destino if destino.exists() else destino.parent)
    tmp = destino.with_name(destino.name + ".tmp-dublagem")
    try:
        shutil.copyfile(str(origem), str(tmp))
    except PermissionError:
        raise Erro("Sem permissão para gravar em " + str(destino.parent) + ".\n"
                   "  Se o jogo está numa partição NTFS/exFAT, ela precisa estar montada com escrita para o seu usuário.")
    if tmp.stat().st_size != origem.stat().st_size:
        tmp.unlink()
        raise Erro("Cópia incompleta de " + str(origem) + " (disco cheio?)")
    igualar_dono(tmp, dono)
    os.replace(str(tmp), str(destino))


def criar_pastas(pasta, referencia):
    """mkdir -p que, como root, deixa as pastas novas com o dono da pasta do jogo."""
    faltando = []
    p = Path(pasta)
    while not p.exists():
        faltando.append(p)
        p = p.parent
    for d in reversed(faltando):
        d.mkdir()
        igualar_dono(d, referencia)


def pasta_backup(jogo):
    return Path(jogo) / "DublagemPTBR-backup" / "pc"


def instalar(jogo, progresso):
    if not ORIGEM.is_dir():
        raise Erro("Pasta 'dublagem' não encontrada ao lado do instalador. Extraia o pacote inteiro.")
    pc = achar_ci(jogo, ["pc"])
    backup = pasta_backup(jogo)
    arqs = sorted(p for p in ORIGEM.rglob("*") if p.is_file() and p.suffix.lower() == ".sds")
    if not arqs:
        raise Erro("Nenhum arquivo .sds dentro de 'dublagem'. O pacote está incompleto.")

    pares, ausentes = [], []
    for a in arqs:
        rel = a.relative_to(ORIGEM)
        alvo = achar_ci(pc, rel.parts)
        if alvo and alvo.is_file():
            pares.append((a, alvo, backup / alvo.relative_to(pc)))
        else:
            ausentes.append(str(rel))

    precisa = sum(alvo.stat().st_size for _, alvo, bak in pares if not bak.exists())
    precisa += max((a.stat().st_size for a, _, _ in pares), default=0)
    livre = shutil.disk_usage(str(jogo)).free
    if precisa > livre:
        raise Erro("Espaço insuficiente no disco do jogo: precisa de %.0f MB para o backup, há %.0f MB livres."
                   % (precisa / 2**20, livre / 2**20))

    info("Instalando %d arquivo(s) em %s" % (len(pares), jogo))
    for i, (a, alvo, bak) in enumerate(pares, 1):
        if not bak.exists():
            criar_pastas(bak.parent, jogo)
            copiar_seguro(alvo, bak, dono=alvo)
        copiar_seguro(a, alvo)
        progresso(i, len(pares))
    info("")
    info("  %d arquivo(s) instalado(s). Originais guardados em: %s" % (len(pares), backup))
    if ausentes:
        info("  %d arquivo(s) não existem nesta versão do jogo e foram ignorados (lista no instalador.log)." % len(ausentes))
        try:
            with open(LOG, "a", encoding="utf-8") as f:
                f.write("".join("    ausente: %s\n" % x for x in ausentes))
        except OSError:
            pass
    ativar_portugues(jogo)
    info("")
    info("Pronto! Abra o jogo e bom divertimento.")


def remover(jogo, progresso):
    pc = achar_ci(jogo, ["pc"])
    backup = pasta_backup(jogo)
    try:  # idioma que a Steam tinha antes (fica dentro da pasta de backup, que é apagada abaixo)
        idioma_antes = arquivo_idioma_anterior(jogo).read_text(encoding="utf-8").strip()
    except OSError:
        idioma_antes = ""
    if idioma_antes and idioma_antes != IDIOMA:
        if steam_aberta():
            info("  A Steam está aberta: para voltar o jogo para '%s', use: %s" % (idioma_antes, CAMINHO_MANUAL.replace("Português (Brasil)", idioma_antes)))
        else:
            for acf in manifestos():
                ajustar_idioma_steam(acf, idioma_antes)
            info("  Steam: idioma do jogo devolvido para '%s'." % idioma_antes)
    rem = pasta_removidos(jogo)
    if rem.is_dir():  # devolve o que a instalação tirou de pc/sds (estado exato de antes)
        for f in rem.iterdir():
            if f.is_file():
                os.replace(str(f), str(Path(pc) / "sds" / f.name))
        shutil.rmtree(str(rem))
        info("  Arquivos de outra tradução devolvidos para pc/sds (com eles o jogo carrega o inglês).")
    if not backup.is_dir():
        info("  Nenhum backup encontrado. Use na Steam: Propriedades > Arquivos instalados >")
        info("  Verificar integridade dos arquivos.")
    else:
        arqs = [p for p in backup.rglob("*") if p.is_file()]
        for i, b in enumerate(arqs, 1):
            rel = b.relative_to(backup)
            alvo = achar_ci(pc, rel.parts) or (pc / rel)
            copiar_seguro(b, alvo)
            progresso(i, len(arqs))
        shutil.rmtree(str(backup.parent))
        info("  %d arquivo(s) original(is) restaurado(s)." % len(arqs))
    for b in perfis(jogo, "settings.xml" + SUFIXO_BACKUP_PERFIL):
        os.replace(str(b), str(b.with_name("settings.xml")))
        info("  Idioma original restaurado no perfil " + b.parent.name + ".")
    info("")
    info("Dublagem removida.")


ACOES = {"1": ("Instalar a dublagem", instalar),
         "2": ("Remover a dublagem (restaurar os originais)", remover),
         "3": ("Só ativar o idioma português", lambda jogo, progresso: ativar_portugues(jogo))}


def executar(op, jogo, progresso):
    info("=== %s | %s | Python %s | root=%s | jogo: %s"
         % (ACOES[op][0], platform.platform(), platform.python_version(), ROOT, jogo))
    if jogo_aberto():
        raise Erro("O jogo está aberto. Feche o jogo e tente de novo.")
    ACOES[op][1](Path(jogo), progresso)


# --- modo terminal -------------------------------------------------------------
def modo_terminal():
    print()
    print("=============================================================")
    print("   Dublagem PT-BR  -  Mafia II: Definitive Edition")
    print("=============================================================")
    print()
    sug = achar_jogo()
    while True:
        if sug:
            print("Pasta do jogo encontrada: " + str(sug))
            resp = input("ENTER para usar essa pasta, ou digite/arraste outra: ")
        else:
            resp = input("Digite (ou arraste aqui) a pasta do jogo (a que contém a pasta 'pc'): ")
        jogo = sug if not resp.strip() else limpar_caminho(resp)
        if eh_pasta_do_jogo(jogo):
            break
        print("  Essa pasta não parece ser a do jogo (falta 'pc/sds'). Tente de novo.")
        sug = None
    print()
    for k, (nome, _) in ACOES.items():
        print("  %s) %s" % (k, nome))
    op = input("Escolha (1/2/3): ").strip()
    if op not in ACOES:
        print("Opção inválida.")
        return 1

    def progresso(i, total):
        if i % 10 == 0 or i == total:
            sys.stdout.write("\r  %d/%d " % (i, total))
            sys.stdout.flush()
            if i == total:
                print()

    try:
        executar(op, jogo, progresso)
        return 0
    except Erro as e:
        info("ERRO: " + str(e))
    except Exception:
        info("ERRO inesperado:\n" + traceback.format_exc())
    info("Detalhes em: " + str(LOG))
    return 1


# --- modo janela ---------------------------------------------------------------
def modo_janela():
    import tkinter as tk
    from tkinter import filedialog, messagebox, ttk

    janela = tk.Tk()
    janela.title("Dublagem PT-BR - Mafia II: Definitive Edition")
    janela.minsize(620, 420)
    fila = queue.Queue()

    global _escrever
    _escrever = lambda msg: fila.put(("log", msg))

    quadro = ttk.Frame(janela, padding=12)
    quadro.pack(fill="both", expand=True)
    ttk.Label(quadro, text="Dublagem PT-BR  -  Mafia II: Definitive Edition",
              font=("TkDefaultFont", 13, "bold")).pack(anchor="w")
    ttk.Label(quadro, text="Pasta do jogo (a que contém a pasta 'pc'):").pack(anchor="w", pady=(10, 2))

    linha = ttk.Frame(quadro)
    linha.pack(fill="x")
    pasta = tk.StringVar(value=str(achar_jogo() or ""))
    ttk.Entry(linha, textvariable=pasta).pack(side="left", fill="x", expand=True)

    def procurar():
        p = filedialog.askdirectory(title="Escolha a pasta do Mafia II Definitive Edition",
                                    initialdir=pasta.get() or str(HOME))
        if p:
            pasta.set(p)
    ttk.Button(linha, text="Procurar...", command=procurar).pack(side="left", padx=(6, 0))

    botoes = ttk.Frame(quadro)
    botoes.pack(fill="x", pady=10)
    barra = ttk.Progressbar(quadro, mode="determinate")
    barra.pack(fill="x")
    texto = tk.Text(quadro, height=12, wrap="word", state="disabled")
    texto.pack(fill="both", expand=True, pady=(8, 0))

    widgets = []

    def rodar(op):
        jogo = limpar_caminho(pasta.get()) if pasta.get().strip() else None
        if not eh_pasta_do_jogo(jogo):
            messagebox.showwarning("Pasta inválida", "Essa pasta não parece ser a do jogo (falta 'pc/sds').")
            return
        if op == "2" and not messagebox.askyesno("Remover", "Restaurar os arquivos originais do jogo?"):
            return
        for w in widgets:
            w.state(["disabled"])
        barra["value"] = 0

        def tarefa():
            try:
                executar(op, jogo, lambda i, t: fila.put(("prog", 100.0 * i / t)))
                fila.put(("fim", None))
            except Erro as e:
                info("ERRO: " + str(e))
                fila.put(("fim", str(e)))
            except Exception:
                info("ERRO inesperado:\n" + traceback.format_exc())
                fila.put(("fim", "Erro inesperado. Detalhes em:\n" + str(LOG)))
        threading.Thread(target=tarefa, daemon=True).start()

    for k, (nome, _) in ACOES.items():
        b = ttk.Button(botoes, text=nome, command=lambda k=k: rodar(k))
        b.pack(side="left", padx=(0, 6))
        widgets.append(b)

    def bombear():
        try:
            while True:
                tipo, val = fila.get_nowait()
                if tipo == "log":
                    texto.configure(state="normal")
                    texto.insert("end", val + "\n")
                    texto.see("end")
                    texto.configure(state="disabled")
                elif tipo == "prog":
                    barra["value"] = val
                elif tipo == "fim":
                    for w in widgets:
                        w.state(["!disabled"])
                    if val:
                        messagebox.showerror("Erro", val)
        except queue.Empty:
            pass
        janela.after(100, bombear)

    if not pasta.get():
        info("Pasta do jogo não encontrada automaticamente. Use \"Procurar...\".")
    janela.after(100, bombear)
    janela.mainloop()


def main():
    # No Linux, o instalar-linux.sh é o instalador completo (detecta Bazzite/SteamOS/distros, Steam nativa,
    # Flatpak e Snap, fecha e reabre a Steam). --sem-bash força este script.
    if SO == "Linux" and "--sem-bash" not in sys.argv:
        sh = PACOTE / "instalar-linux.sh"
        if sh.is_file() and shutil.which("bash"):
            print("Linux: abrindo o instalador para Linux (instalar-linux.sh)...")
            sys.stdout.flush()
            os.execvp("bash", ["bash", str(sh)])
    if ROOT:
        print("Aviso: rodando como root. Não precisa de sudo; use:  python3 instalar.py")
        print("(vou continuar e manter os arquivos com o dono original)\n")
    if "--terminal" not in sys.argv:
        tem_tela = SO in ("Windows", "Darwin") or os.environ.get("DISPLAY") or os.environ.get("WAYLAND_DISPLAY")
        if tem_tela:
            try:
                modo_janela()
                return 0
            except Exception as e:  # sem tkinter ou sem tela: cai para o terminal
                info("(janela indisponível: %s; usando o terminal)" % e)
    return modo_terminal()


if __name__ == "__main__":
    sys.exit(main())
