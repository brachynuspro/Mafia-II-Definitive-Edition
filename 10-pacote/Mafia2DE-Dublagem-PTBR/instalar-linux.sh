#!/usr/bin/env bash
# =============================================================================
#  Dublagem PT-BR - Mafia II: Definitive Edition - instalador para Linux
#  Bazzite, SteamOS/Steam Deck, Fedora, Ubuntu, Arch... (Steam nativa, Flatpak ou Snap + Proton)
#
#  uso:  bash instalar-linux.sh                 (menu)
#        bash instalar-linux.sh --instalar      (instala direto)
#        bash instalar-linux.sh --idioma        (so corrige o idioma)
#        bash instalar-linux.sh --remover       (restaura os originais)
#        bash instalar-linux.sh --diag          (so mostra o diagnostico)
#        opcoes extras: --sim (responde "sim" sozinho)  --jogo <pasta do jogo>
#
#  Por que o jogo ficava em ingles (tres causas, todas tratadas aqui):
#    1) o idioma do jogo na Steam (steamapps/appmanifest_1030830.acf): o launcher
#       usa esse idioma para criar o perfil na primeira vez;
#    2) o <Language> dos perfis (settings.xml) dentro do prefixo do Proton;
#    3) um arquivo 'info' de outro idioma dentro de pc/sds (resto de outra
#       traducao): o jogo le o 'info' de todas as pastas pc/sds* e, com ele,
#       carrega a pasta de ingles mesmo com o perfil em portugues.
# =============================================================================
set -u

APPID=1030830
NOME="Mafia II Definitive Edition"
EXE="Mafia II Definitive Edition.exe"
IDIOMA=brazilian
PACOTE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ORIGEM="$PACOTE/dublagem/pc"
LOG="$PACOTE/instalador-linux.log"
CASA="${DUB_HOME:-$HOME}"                         # DUB_HOME/DUB_OS_RELEASE: so para testes
OS_RELEASE="${DUB_OS_RELEASE:-/etc/os-release}"

# --- sem sudo: como root, os arquivos do jogo ficariam com dono root e a Steam perderia acesso ---
if [ "$(id -u)" = 0 ] && [ -z "${DUB_HOME:-}" ]; then
  if [ -n "${SUDO_USER:-}" ] && [ "$SUDO_USER" != root ]; then
    echo "Não precisa de sudo. Rodando de novo como '$SUDO_USER'..."
    exec sudo -u "$SUDO_USER" -H bash "$0" "$@"
  fi
  echo "Rode como o seu usuário normal, sem sudo:  bash instalar-linux.sh"
  exit 1
fi

# --- se foi aberto com dois cliques (sem terminal), reabre num terminal -------------------
# (só com tela: por SSH ou com a entrada redirecionada, segue no próprio processo)
if [ ! -t 0 ] && [ -z "${DUB_NO_TERM:-}" ] && [ -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ] && [ ! -p /dev/stdin ] && [ ! -f /dev/stdin ]; then
  for t in konsole ptyxis kgx gnome-terminal xfce4-terminal alacritty kitty xterm; do
    if command -v "$t" >/dev/null 2>&1; then
      case "$t" in
        konsole|xfce4-terminal|xterm|alacritty|kitty) exec "$t" -e bash "$0" "$@" ;;
        *) exec "$t" -- bash "$0" "$@" ;;
      esac
    fi
  done
fi

# --- opções da linha de comando ----------------------------------------------------------
ACAO=""; AUTO=0; JOGO_ARG=""
while [ $# -gt 0 ]; do
  case "$1" in
    --instalar) ACAO=1 ;;
    --remover)  ACAO=2 ;;
    --idioma)   ACAO=3 ;;
    --diag)     ACAO=4 ;;
    --sim|-y)   AUTO=1 ;;
    --jogo)     shift; JOGO_ARG="${1:-}" ;;
    -h|--help)  sed -n '2,20p' "$0"; exit 0 ;;
    *) echo "Opção desconhecida: $1 (use --help)"; exit 1 ;;
  esac
  shift
done

# --- visual ------------------------------------------------------------------------------
if [ -t 1 ]; then
  B=$'\033[1m'; D=$'\033[2m'; R=$'\033[0m'; VERM=$'\033[31m'; VERD=$'\033[32m'; AMAR=$'\033[33m'; AZUL=$'\033[36m'
else B=""; D=""; R=""; VERM=""; VERD=""; AMAR=""; AZUL=""; fi
log()   { printf '%s %s\n' "$(date +%H:%M:%S)" "$*" >> "$LOG" 2>/dev/null; }
say()   { printf '%s\n' "$*"; log "$*"; }
ok()    { printf '  %s✔%s %s\n' "$VERD" "$R" "$*"; log "OK   $*"; }
aviso() { printf '  %s⚠%s %s\n' "$AMAR" "$R" "$*"; log "AVISO $*"; }
falha() { printf '  %s✖%s %s\n' "$VERM" "$R" "$*"; log "ERRO $*"; }
etapa() { printf '\n%s%s▸ %s%s\n' "$B" "$AZUL" "$*" "$R"; log "== $*"; }
pergunta() { local r; printf '%s?%s %s ' "$B" "$R" "$1" >&2; IFS= read -r r || r=""; log "pergunta: $1 -> $r"; printf '%s' "$r"; }   # texto no stderr: so a resposta vai para $(...)
sim() { local r; if [ "$AUTO" = 1 ]; then log "pergunta: $1 -> sim (--sim)"; return 0; fi
        r="$(pergunta "$1 [S/n]")"; case "$r" in [nN]*) return 1 ;; *) return 0 ;; esac; }
barra() {  # barra <atual> <total> <texto>   (só num terminal; em log/SSH não polui a saída)
  [ -t 1 ] || return 0
  local i=$1 t=$2 w=30 n; n=$(( t > 0 ? i * w / t : w ))
  printf '\r  %s[%s%s]%s %3d%% %s' "$AZUL" "$(printf '%*s' "$n" '' | tr ' ' '#')" "$(printf '%*s' $((w - n)) '')" "$R" $(( t > 0 ? i * 100 / t : 100 )) "$3"
}

banner() {
  printf '\n%s' "$B"
  printf '   ╔══════════════════════════════════════════════════════╗\n'
  printf '   ║   Dublagem PT-BR  ·  Mafia II: Definitive Edition    ║\n'
  printf '   ║                instalador para Linux                 ║\n'
  printf '   ╚══════════════════════════════════════════════════════╝\n'
  printf '%s' "$R"
}

# =============================================================================
#  1) SISTEMA
# =============================================================================
SISTEMA="Linux"; IMUTAVEL=0; DECK=0; DISTRO_ID=""; DISTRO_LIKE=""; VARIANTE=""; FAMILIA="outra"; PORTATIL=""
detectar_sistema() {
  if [ -r "$OS_RELEASE" ]; then
    DISTRO_ID="$(. "$OS_RELEASE" 2>/dev/null; printf '%s' "${ID:-}")"
    DISTRO_LIKE="$(. "$OS_RELEASE" 2>/dev/null; printf '%s' "${ID_LIKE:-}")"
    VARIANTE="$(. "$OS_RELEASE" 2>/dev/null; printf '%s' "${VARIANT_ID:-}")"
    SISTEMA="$(. "$OS_RELEASE" 2>/dev/null; printf '%s' "${PRETTY_NAME:-${NAME:-Linux}}")"
  fi
  # família: decide as mensagens e o que esperar da Steam e dos discos
  case " $DISTRO_ID " in
    " bazzite ")                                         FAMILIA=bazzite ;;
    " steamos "|" holoiso "|" chimeraos "|" steamfork ") FAMILIA=steamos ;;
    *)
      case " $DISTRO_ID $DISTRO_LIKE " in
        *" fedora "*|*" rhel "*|*" nobara "*)                                    FAMILIA=fedora ;;
        *" debian "*|*" ubuntu "*)                                               FAMILIA=debian ;;
        *" arch "*|*" manjaro "*|*" endeavouros "*|*" cachyos "*|*" garuda "*)   FAMILIA=arch ;;
        *" suse "*|*" opensuse "*)                                               FAMILIA=suse ;;
      esac ;;
  esac
  [ -e /run/ostree-booted ] && IMUTAVEL=1
  case "$FAMILIA" in bazzite|steamos) IMUTAVEL=1 ;; esac
  local vend prod fam
  vend="$(cat /sys/devices/virtual/dmi/id/sys_vendor 2>/dev/null)"
  prod="$(cat /sys/devices/virtual/dmi/id/product_name 2>/dev/null)"
  fam="$(cat /sys/devices/virtual/dmi/id/product_family 2>/dev/null)"
  case "$vend|$prod|$fam" in
    Valve*Jupiter*|Valve*Galileo*) DECK=1; PORTATIL="Steam Deck" ;;
    *"ROG Ally"*)                  PORTATIL="${fam:-ROG Ally}" ;;
    *"Legion Go"*|LENOVO*83E1*|LENOVO*83L3*|LENOVO*83N*) PORTATIL="Lenovo Legion Go" ;;
    *"Claw"*)                      PORTATIL="MSI Claw" ;;
    *AYANEO*|*AYN*|*GPD*|*ONE-NETBOOK*|*OneXPlayer*) PORTATIL="portátil ($prod)" ;;
  esac
}
descrever_sistema() {
  say "  $SISTEMA$( [ "$IMUTAVEL" = 1 ] && printf ' · imutável')$( [ -n "$PORTATIL" ] && printf ' · %s' "$PORTATIL")"
  case "$FAMILIA" in
    bazzite) ok "Bazzite detectado ($VARIANTE): Steam e Proton já vêm prontos; não precisa de sudo nem instalar nada" ;;
    steamos) ok "SteamOS detectado: Steam e Proton já vêm prontos; rode pelo Modo Desktop" ;;
    fedora|debian|arch|suse) ok "Linux $FAMILIA detectado: vou procurar a Steam nativa, Flatpak e Snap" ;;
    *) say "  Distribuição não reconhecida: vou procurar a Steam nativa, Flatpak e Snap mesmo assim" ;;
  esac
}

# =============================================================================
#  2) STEAM, BIBLIOTECAS, JOGO, PROTON
# =============================================================================
STEAMS=()        # raizes da Steam encontradas (nativa, flatpak, snap)
TIPOS=()         # nativa | flatpak | snap
LIBS=()          # bibliotecas (pastas que contem steamapps/)
JOGO=""; LIB_JOGO=""; FS_JOGO=""

adicionar_lib() {
  local l="$1" x
  [ -d "$l/steamapps" ] || return 0
  l="$(cd "$l" && pwd -P)"
  for x in "${LIBS[@]+"${LIBS[@]}"}"; do [ "$x" = "$l" ] && return 0; done
  LIBS+=("$l")
}
detectar_steam() {
  local s tipo real visto x
  for par in "nativa:$CASA/.local/share/Steam" "nativa:$CASA/.steam/steam" "nativa:$CASA/.steam/root" \
             "flatpak:$CASA/.var/app/com.valvesoftware.Steam/.local/share/Steam" \
             "flatpak:$CASA/.var/app/com.valvesoftware.Steam/data/Steam" \
             "snap:$CASA/snap/steam/common/.local/share/Steam"; do
    tipo="${par%%:*}"; s="${par#*:}"
    [ -d "$s/steamapps" ] || continue
    real="$(cd "$s" && pwd -P)"; visto=0
    for x in "${STEAMS[@]+"${STEAMS[@]}"}"; do [ "$x" = "$real" ] && visto=1; done
    [ "$visto" = 1 ] && continue
    STEAMS+=("$real"); TIPOS+=("$tipo")
    adicionar_lib "$real"
    if [ -f "$real/steamapps/libraryfolders.vdf" ]; then
      while IFS= read -r l; do adicionar_lib "$l"; done < <(sed -n 's/^[[:space:]]*"path"[[:space:]]*"\(.*\)"[[:space:]]*$/\1/p' "$real/steamapps/libraryfolders.vdf" | sed 's/\\\\/\\/g')
    fi
  done
}
achar_jogo() {
  local l
  for l in "${LIBS[@]+"${LIBS[@]}"}"; do
    if [ -d "$l/steamapps/common/$NOME/pc/sds" ]; then JOGO="$l/steamapps/common/$NOME"; LIB_JOGO="$l"; return 0; fi
  done
  return 1
}
escolher_pasta() {
  local p=""
  if [ -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ]; then
    if command -v kdialog >/dev/null 2>&1; then p="$(kdialog --title 'Escolha a pasta do Mafia II Definitive Edition' --getexistingdirectory "$CASA" 2>/dev/null)"
    elif command -v zenity >/dev/null 2>&1; then p="$(zenity --file-selection --directory --title='Escolha a pasta do Mafia II Definitive Edition' 2>/dev/null)"; fi
  fi
  [ -n "$p" ] || p="$(pergunta "Digite (ou arraste aqui) a pasta do jogo, a que contém a pasta 'pc':")"
  p="$(printf '%s' "$p" | sed -e "s/^[[:space:]]*['\"]//" -e "s/['\"][[:space:]]*$//" -e 's/[[:space:]]*$//' -e 's#^file://##' -e 's/\\\(.\)/\1/g' -e 's#/$##')"
  [ "$(basename "${p:-x}")" = "pc" ] && p="$(dirname "$p")"
  printf '%s' "$p"
}
tipo_fs() { command -v findmnt >/dev/null 2>&1 && findmnt -n -o FSTYPE --target "$1" 2>/dev/null | head -n1; }
DISCO_SO_LEITURA=0
avaliar_disco() {   # avalia o disco do jogo pelo sistema de arquivos e pelo driver de montagem
  local fs src opts
  command -v findmnt >/dev/null 2>&1 || return 0
  fs="$(tipo_fs "$JOGO")"; FS_JOGO="$fs"
  src="$(findmnt -n -o SOURCE --target "$JOGO" 2>/dev/null | head -n1)"
  opts="$(findmnt -n -o OPTIONS --target "$JOGO" 2>/dev/null | head -n1)"
  case ",$opts," in
    *,ro,*) DISCO_SO_LEITURA=1
            falha "O disco do jogo ($src) está montado SÓ PARA LEITURA."
            say  "    Se for um disco do Windows: no Windows, desligue a 'Inicialização rápida' e desligue o PC"
            say  "    (não hiberne); depois monte o disco de novo aqui." ;;
  esac
  case "$fs" in
    fuseblk|ntfs-3g)
      if ps -eo args 2>/dev/null | grep -F -- "$src" | grep -q 'lowntfs-3g.*ignore_case'; then
        ok "Disco NTFS montado com lowntfs-3g + ignore_case ($src): funciona bem com o Proton"
      else
        aviso "Disco NTFS ($src) montado com ntfs-3g. Costuma funcionar; se o jogo der erro, mova-o para um"
        say  "    disco Linux (ext4/btrfs) pela Steam: Propriedades › Arquivos instalados › Mover."
      fi ;;
    ntfs3|ntfs)
      aviso "Disco NTFS ($src) com o driver 'ntfs3', que diferencia maiúsculas/minúsculas."
      say  "    O Proton pode falhar nele. Se o jogo der erro, mova-o para um disco Linux (ext4/btrfs)"
      say  "    pela Steam: Propriedades › Arquivos instalados › Mover." ;;
    exfat|vfat)
      aviso "Disco $fs ($src): funciona para os arquivos do jogo, mas o Proton é mais estável em ext4/btrfs." ;;
    ext4|btrfs|xfs|f2fs|bcachefs|zfs)
      ok "Disco do jogo: $fs ($src)" ;;
    "") : ;;
    *) say "  Disco do jogo: $fs ($src)" ;;
  esac
}

# prefixos do Proton deste jogo (pode ficar em qualquer biblioteca) + prefixo Wine se o jogo estiver num drive_c
PREFIXOS=()
achar_prefixos() {
  local l p x
  PREFIXOS=()
  for l in "${LIBS[@]+"${LIBS[@]}"}" "${STEAMS[@]+"${STEAMS[@]}"}"; do
    p="$l/steamapps/compatdata/$APPID/pfx"
    [ -d "$p" ] || continue
    p="$(cd "$p" && pwd -P)"
    for x in "${PREFIXOS[@]+"${PREFIXOS[@]}"}"; do [ "$x" = "$p" ] && continue 2; done
    PREFIXOS+=("$p")
  done
  case "$JOGO" in */drive_c/*) PREFIXOS+=("${JOGO%%/drive_c/*}") ;; esac
}
listar_perfis() {   # settings.xml de todos os perfis (inclusive temporaryprofile)
  local p
  for p in "${PREFIXOS[@]+"${PREFIXOS[@]}"}"; do
    # -L: em alguns Protons "Documents"/"My Documents" sao links; readlink -f tira os repetidos
    find -L "$p/drive_c/users" -maxdepth 10 -type f -iname 'settings.xml' -ipath "*/My Games/$NOME/Data/profiles/*" 2>/dev/null \
      | while IFS= read -r f; do readlink -f "$f"; done
  done | sort -u
}
listar_manifestos() {
  local l
  for l in "${LIBS[@]+"${LIBS[@]}"}"; do [ -f "$l/steamapps/appmanifest_$APPID.acf" ] && printf '%s\n' "$l/steamapps/appmanifest_$APPID.acf"; done
}
idioma_steam() {   # idioma configurado para o jogo na Steam (UserConfig)
  awk 'BEGIN{d=0} {t=$0; gsub(/^[ \t]+|[ \t]+$/,"",t)}
       t=="{"{d++; if(want){blk=1; bd=d; want=0}; next} t=="}"{if(blk&&d==bd)blk=0; d--; next}
       t=="\"UserConfig\""{want=1; next}
       blk && t ~ /^"language"/ {gsub(/^"language"[ \t]+"|"$/,"",t); print t; exit}' "$1"
}

# =============================================================================
#  3) PROCESSOS
# =============================================================================
rodando() { command -v pgrep >/dev/null 2>&1 && pgrep -f "$1" >/dev/null 2>&1; }
jogo_aberto() { rodando "$EXE" || rodando "Mafia2Launcher"; }
steam_aberta() { rodando 'ubuntu12_32/steam' || rodando 'com.valvesoftware.Steam' || { command -v pgrep >/dev/null 2>&1 && pgrep -x steam >/dev/null 2>&1; }; }
STEAM_TIPO_ATIVA="nativa"
fechar_steam() {
  say "  Fechando a Steam..."
  rodando 'com.valvesoftware.Steam' && STEAM_TIPO_ATIVA=flatpak   # fecha (e depois reabre) a que estiver aberta
  if [ "$STEAM_TIPO_ATIVA" = "flatpak" ]; then flatpak run com.valvesoftware.Steam -shutdown >/dev/null 2>&1 &
  elif command -v steam >/dev/null 2>&1; then steam -shutdown >/dev/null 2>&1 &
  fi
  local i
  for i in $(seq 1 60); do steam_aberta || return 0; sleep 1; done
  return 1
}
abrir_steam() {
  if [ "$STEAM_TIPO_ATIVA" = "flatpak" ]; then (setsid flatpak run com.valvesoftware.Steam >/dev/null 2>&1 &)
  elif command -v steam >/dev/null 2>&1; then (setsid steam >/dev/null 2>&1 &)
  fi
}

# =============================================================================
#  4) ACOES
# =============================================================================
ajustar_manifesto() {   # ajustar_manifesto <acf> <idioma>: troca/insere "language" em UserConfig e MountedConfig
  local acf="$1" lang="$2" tmp="$1.tmp-dublagem"
  awk -v lang="$lang" '
    function linha_lang(ind){ printf "%s\"language\"\t\t\"%s\"\n", ind, lang }
    BEGIN{d=0}
    {t=$0; gsub(/^[ \t]+|[ \t]+$/,"",t)}
    t=="\"UserConfig\""||t=="\"MountedConfig\"" { if(d==1){want=t} print; next }
    t=="{" { d++; if(want!=""){blk=want; bd=d; achou=0; want=""} print; next }
    t=="}" {
      if(blk!="" && d==bd){ if(!achou) linha_lang("\t\t"); if(blk=="\"UserConfig\"")tem_uc=1; else tem_mc=1; blk="" }
      if(d==1){ if(!tem_uc){print "\t\"UserConfig\"\n\t{"; linha_lang("\t\t"); print "\t}"} if(!tem_mc){print "\t\"MountedConfig\"\n\t{"; linha_lang("\t\t"); print "\t}"} }
      d--; print; next }
    blk!="" && t ~ /^"language"/ { linha_lang("\t\t"); achou=1; next }
    { print }' "$acf" > "$tmp" && [ -s "$tmp" ] && mv -f "$tmp" "$acf"
}

# Uma instalação limpa não tem 'info' em pc/sds. Outra tradução às vezes copia para lá o 'info' do
# pt-BR (+ dabing_resources.xml e sds_list.txt): o jogo lê o 'info' de todas as pastas pc/sds* e,
# como o de pc/sds é lido por último, passa a achar que o português está na pasta de inglês.
REMOVIDOS="DublagemPTBR-backup/removidos-de-pc-sds"
info_estranho() { [ -f "$JOGO/pc/sds/info" ] && ! grep -q '<id>English</id>' "$JOGO/pc/sds/info" 2>/dev/null; }
limpar_pasta_ingles() {
  local f n=0 dest="$JOGO/$REMOVIDOS" id
  info_estranho || return 0
  id="$(grep -o '<id>[^<]*' "$JOGO/pc/sds/info" 2>/dev/null | head -n1 | cut -c5-)"
  etapa "Corrigindo a pasta de inglês (pc/sds)"
  aviso "Há um arquivo de idioma '${id:-?}' dentro de pc/sds. Ele não vem da Steam (costuma ser resto de"
  say  "    outra tradução) e faz o jogo carregar a pasta de inglês mesmo com o perfil em português."
  mkdir -p "$dest" || { falha "Não consegui criar $dest"; return 1; }
  for f in info dabing_resources.xml sds_list.txt; do
    [ -f "$JOGO/pc/sds/$f" ] || continue
    mv -f "$JOGO/pc/sds/$f" "$dest/$f" && n=$((n + 1)) || { falha "Não consegui mover pc/sds/$f"; return 1; }
  done
  ok "$n arquivo(s) tirado(s) de pc/sds e guardado(s) em ${D}$dest${R}"
}

corrigir_idioma() {   # pasta de inglês + Steam + perfis
  local acf atual mudar=() c bak n=0
  limpar_pasta_ingles || return 1
  etapa "Idioma do jogo na Steam"
  while IFS= read -r acf; do
    [ -n "$acf" ] || continue
    atual="$(idioma_steam "$acf")"
    if [ "$atual" = "$IDIOMA" ]; then ok "Steam já está em português (Brasil) para o jogo"
    else aviso "Steam está com o jogo em '${atual:-english}' → precisa ser '$IDIOMA'"; mudar+=("$acf"); fi
  done < <(listar_manifestos)
  if [ "${#mudar[@]}" -gt 0 ]; then
    local pode=1
    if steam_aberta; then
      say "  A Steam regrava esse arquivo enquanto está aberta, então ela precisa ser fechada um instante."
      if sim "Posso fechar a Steam, ajustar e abrir de novo?"; then fechar_steam || { falha "A Steam não fechou sozinha. Feche-a e rode o instalador de novo (opção 3)."; pode=0; }
      else pode=0; fi
    fi
    if [ "$pode" = 1 ]; then
      for acf in "${mudar[@]}"; do
        mkdir -p "$JOGO/DublagemPTBR-backup"
        [ -f "$JOGO/DublagemPTBR-backup/idioma-steam-anterior.txt" ] || printf '%s\n' "$(idioma_steam "$acf")" > "$JOGO/DublagemPTBR-backup/idioma-steam-anterior.txt"
        ajustar_manifesto "$acf" "$IDIOMA" && ok "Idioma do jogo na Steam: português (Brasil)" || falha "Não consegui alterar $acf"
      done
      STEAM_REABRIR=1
    else
      aviso "Faça manualmente: Steam › Biblioteca › Mafia II: Definitive Edition › Propriedades › Geral › Idioma › Português (Brasil)"
    fi
  fi

  etapa "Idioma dos perfis do jogo (Proton)"
  achar_prefixos
  if [ "${#PREFIXOS[@]}" -eq 0 ]; then
    aviso "O jogo ainda não foi aberto neste computador (não há prefixo do Proton)."
    say  "    Tudo bem: com a Steam em português, o jogo já cria o perfil em português na primeira vez."
    return 0
  fi
  for c in "${PREFIXOS[@]}"; do ok "Prefixo do Proton: ${D}$c${R}"; done
  while IFS= read -r c; do
    [ -n "$c" ] || continue
    bak="$c.antes-dublagem"
    [ -f "$bak" ] || cp "$c" "$bak"
    if grep -q '<Language>' "$c"; then
      sed "s#<Language>[^<]*</Language>#<Language>$IDIOMA</Language>#" "$c" > "$c.tmp-dublagem" && mv -f "$c.tmp-dublagem" "$c"
    else
      sed "s#<Game>#<Game>\n    <Language>$IDIOMA</Language>#" "$c" > "$c.tmp-dublagem" && mv -f "$c.tmp-dublagem" "$c"
    fi
    n=$((n + 1)); ok "Perfil $(basename "$(dirname "$c")"): português (Brasil)"
  done < <(listar_perfis)
  [ "$n" -gt 0 ] || { aviso "Nenhum perfil ainda (o jogo foi instalado mas não aberto)."; say "    Com a Steam em português, o primeiro perfil já nasce em português."; }
}

instalar_arquivos() {
  local backup="$JOGO/DublagemPTBR-backup/pc" total=0 i=0 n=0 iguais=0 ausentes=0 a rel alvo bak
  etapa "Copiando a dublagem"
  [ -d "$ORIGEM" ] || { falha "Pasta 'dublagem' não encontrada ao lado do instalador. Extraia o pacote inteiro."; return 1; }
  total=$(find "$ORIGEM" -type f -iname '*.sds' | wc -l | tr -d ' ')
  [ "$total" -gt 0 ] || { falha "O pacote não tem arquivos .sds."; return 1; }
  local tmpf="$JOGO/.teste-escrita-dublagem"
  if [ "$DISCO_SO_LEITURA" = 1 ] || ! ( : > "$tmpf" ) 2>/dev/null; then
    falha "Sem permissão de escrita em $JOGO"
    say  "    Se o jogo está num disco do Windows (NTFS), ele precisa estar montado com escrita para o seu usuário."
    return 1
  fi
  rm -f "$tmpf"
  # espaço para guardar os originais que ainda não têm backup (+ folga de um arquivo)
  local precisa=0 livre maior=0 t
  while IFS= read -r -d '' a; do
    rel="${a#"$ORIGEM"/}"; alvo="$JOGO/pc/$rel"
    [ -f "$alvo" ] || continue
    t=$(stat -c %s "$alvo" 2>/dev/null || echo 0); [ "$t" -gt "$maior" ] && maior=$t
    [ -f "$backup/$rel" ] || precisa=$((precisa + t))
  done < <(find "$ORIGEM" -type f -iname '*.sds' -print0)
  livre=$(df -P -k "$JOGO" 2>/dev/null | awk 'NR==2{print $4 * 1024}')
  if [ -n "$livre" ] && [ $((precisa + maior)) -gt "$livre" ]; then
    falha "Espaço insuficiente no disco do jogo: precisa de $(( (precisa + maior) / 1048576 )) MB para guardar os originais, há $(( livre / 1048576 )) MB livres."
    return 1
  fi
  igual() { if command -v cmp >/dev/null 2>&1; then cmp -s "$1" "$2"; else [ "$(md5sum < "$1")" = "$(md5sum < "$2")" ]; fi; }
  while IFS= read -r -d '' a; do
    i=$((i + 1)); rel="${a#"$ORIGEM"/}"; alvo="$JOGO/pc/$rel"; bak="$backup/$rel"
    barra "$i" "$total" ""
    if [ ! -f "$alvo" ]; then ausentes=$((ausentes + 1)); log "ausente: $rel"; continue; fi
    if igual "$a" "$alvo"; then iguais=$((iguais + 1)); continue; fi   # ja instalado: nao faz backup de arquivo dublado
    # cp sem -p: em discos NTFS/exFAT preservar permissoes falha
    if [ ! -f "$bak" ]; then mkdir -p "$(dirname "$bak")" && cp "$alvo" "$bak" || { echo; falha "Falha ao guardar o original de $rel"; return 1; }; fi
    cp "$a" "$alvo.tmp-dublagem" && [ "$(wc -c < "$a")" = "$(wc -c < "$alvo.tmp-dublagem")" ] && mv -f "$alvo.tmp-dublagem" "$alvo" \
      || { echo; rm -f "$alvo.tmp-dublagem"; falha "Falha ao copiar $rel (disco cheio?)"; return 1; }
    n=$((n + 1))
  done < <(find "$ORIGEM" -type f -iname '*.sds' -print0 | sort -z)
  echo
  ok "$n arquivo(s) instalado(s)$( [ "$iguais" -gt 0 ] && printf ', %d já estavam instalados' "$iguais")"
  [ -d "$backup" ] && ok "Originais guardados em ${D}$backup${R}"
  [ "$ausentes" -gt 0 ] && aviso "$ausentes arquivo(s) não existem nesta versão do jogo e foram ignorados (lista no log)"
  return 0
}

remover() {
  local backup="$JOGO/DublagemPTBR-backup/pc" n=0 b c ant acf
  etapa "Restaurando os arquivos originais"
  if [ -d "$backup" ]; then
    while IFS= read -r -d '' b; do cp -f "$b" "$JOGO/pc/${b#"$backup"/}" && n=$((n + 1)); done < <(find "$backup" -type f -print0)
    ok "$n arquivo(s) original(is) restaurado(s)"
  else aviso "Nenhum backup encontrado. Na Steam: Propriedades › Arquivos instalados › Verificar integridade."; fi
  etapa "Restaurando o idioma"
  achar_prefixos
  while IFS= read -r c; do [ -f "$c.antes-dublagem" ] && mv -f "$c.antes-dublagem" "$c" && ok "Perfil $(basename "$(dirname "$c")") restaurado"; done < <(listar_perfis)
  ant="$(cat "$JOGO/DublagemPTBR-backup/idioma-steam-anterior.txt" 2>/dev/null)"
  if [ -n "$ant" ] && [ "$ant" != "$IDIOMA" ]; then
    if steam_aberta && sim "Fechar a Steam para devolver o idioma '$ant' ao jogo?"; then fechar_steam; STEAM_REABRIR=1; fi
    if ! steam_aberta; then while IFS= read -r acf; do ajustar_manifesto "$acf" "$ant" && ok "Idioma do jogo na Steam: $ant"; done < <(listar_manifestos); fi
  fi
  if [ -d "$JOGO/$REMOVIDOS" ]; then   # devolve o que a instalação tirou de pc/sds (estado exato de antes)
    for b in "$JOGO/$REMOVIDOS"/*; do [ -f "$b" ] && mv -f "$b" "$JOGO/pc/sds/"; done
    aviso "Arquivos de outra tradução devolvidos para pc/sds (com eles o jogo carrega o inglês)"
  fi
  rm -rf "$JOGO/DublagemPTBR-backup"
}

verificar() {   # checklist final
  local total ok_n=0 a rel acf c pt=0 en=0
  etapa "Verificação"
  total=$(find "$ORIGEM" -type f -iname '*.sds' 2>/dev/null | wc -l | tr -d ' ')
  while IFS= read -r -d '' a; do rel="${a#"$ORIGEM"/}"; [ -f "$JOGO/pc/$rel" ] && [ "$(wc -c < "$a")" = "$(wc -c < "$JOGO/pc/$rel")" ] && ok_n=$((ok_n + 1)); done < <(find "$ORIGEM" -type f -iname '*.sds' -print0)
  [ "$ok_n" -gt 0 ] && ok "Arquivos dublados no jogo: $ok_n de $total" || falha "Nenhum arquivo dublado no jogo"
  if [ -f "$JOGO/pc/sds_br/info" ] && grep -q '<id>Brazilianportuguese</id>' "$JOGO/pc/sds_br/info"; then ok "Pacote de idioma pt-BR do jogo presente (pc/sds_br)"
  else falha "pc/sds_br/info não existe ou não é pt-BR: na Steam, Propriedades › Arquivos instalados › Verificar integridade"; fi
  if info_estranho; then falha "Há um 'info' de outro idioma em pc/sds: o jogo vai carregar o inglês (rode a opção 3)"
  else ok "Pasta de inglês (pc/sds) sem arquivos de outro idioma"; fi
  while IFS= read -r acf; do
    [ "$(idioma_steam "$acf")" = "$IDIOMA" ] && ok "Steam: jogo em português (Brasil)" || aviso "Steam: jogo em '$(idioma_steam "$acf")' (ajuste em Propriedades › Geral › Idioma)"
  done < <(listar_manifestos)
  achar_prefixos
  while IFS= read -r c; do [ -n "$c" ] || continue; grep -q "<Language>$IDIOMA</Language>" "$c" && pt=$((pt + 1)) || en=$((en + 1)); done < <(listar_perfis)
  if [ $((pt + en)) -eq 0 ]; then aviso "Perfil do jogo: ainda não criado (será criado em português na primeira vez que abrir)"
  elif [ "$en" -eq 0 ]; then ok "Perfis do jogo em português: $pt"
  else falha "Perfis ainda em outro idioma: $en (rode a opção 3)"; fi
}

diagnostico() {
  local i
  etapa "Sistema"
  descrever_sistema
  etapa "Steam"
  if [ "${#STEAMS[@]}" -eq 0 ]; then falha "Nenhuma instalação da Steam encontrada em $CASA"; fi
  for i in "${!STEAMS[@]}"; do ok "Steam ${TIPOS[$i]}: ${D}${STEAMS[$i]}${R}"; done
  for i in "${LIBS[@]+"${LIBS[@]}"}"; do say "    biblioteca: $i"; done
  steam_aberta && say "  Steam: aberta" || say "  Steam: fechada"
  etapa "Jogo"
  if [ -n "$JOGO" ]; then
    ok "Pasta do jogo: ${D}$JOGO${R}"
    avaliar_disco
  else falha "Jogo não encontrado nas bibliotecas da Steam"; fi
  achar_prefixos
  [ "${#PREFIXOS[@]}" -gt 0 ] && for i in "${PREFIXOS[@]}"; do ok "Prefixo do Proton: ${D}$i${R}"; done || aviso "Sem prefixo do Proton: o jogo ainda não foi aberto aqui"
  [ -n "$JOGO" ] && verificar
}

# =============================================================================
#  PRINCIPAL
# =============================================================================
STEAM_REABRIR=0
: >> "$LOG" 2>/dev/null
log "======== $(date) | $(uname -a) | args: acao=${ACAO:-menu} sim=$AUTO jogo=${JOGO_ARG:-auto}"
banner
detectar_sistema; detectar_steam
log "sistema: $SISTEMA | id=$DISTRO_ID like=$DISTRO_LIKE variante=$VARIANTE familia=$FAMILIA portatil=${PORTATIL:-nao}"
[ "${TIPOS[0]:-}" = "flatpak" ] && STEAM_TIPO_ATIVA=flatpak
if [ -n "$JOGO_ARG" ]; then JOGO="${JOGO_ARG%/}"; [ "$(basename "$JOGO")" = "pc" ] && JOGO="$(dirname "$JOGO")"; else achar_jogo || true; fi

if [ "$ACAO" = 4 ]; then diagnostico; say ""; say "Relatório salvo em: $LOG"; exit 0; fi

etapa "Verificando o sistema"
descrever_sistema
[ "${#STEAMS[@]}" -gt 0 ] && for i in "${!STEAMS[@]}"; do ok "Steam ${TIPOS[$i]} encontrada: ${D}${STEAMS[$i]}${R}"; done || aviso "Não achei a Steam na pasta pessoal"

while [ -z "$JOGO" ] || [ ! -d "$JOGO/pc/sds" ]; do
  [ -n "$JOGO" ] && aviso "Essa pasta não parece ser a do jogo (falta 'pc/sds'): $JOGO"
  [ -n "$ACAO" ] && [ ! -t 0 ] && { falha "Pasta do jogo não encontrada. Use --jogo <pasta>."; exit 1; }
  JOGO="$(escolher_pasta)"
  [ -n "$JOGO" ] || { falha "Nenhuma pasta escolhida."; exit 1; }
done
ok "Jogo: ${D}$JOGO${R}"
avaliar_disco
fs="$FS_JOGO"

if jogo_aberto; then falha "O jogo está aberto. Feche o jogo e rode o instalador de novo."; exit 1; fi

if [ -n "$ACAO" ]; then OP="$ACAO"
else
  printf '\n'
  printf '  %s1%s  Instalar a dublagem %s(arquivos + idioma)%s\n' "$B" "$R" "$D" "$R"
  printf '  %s2%s  Remover a dublagem %s(restaura tudo)%s\n' "$B" "$R" "$D" "$R"
  printf '  %s3%s  Só corrigir o idioma %s(se o jogo ainda aparece em inglês)%s\n' "$B" "$R" "$D" "$R"
  printf '  %s4%s  Diagnóstico %s(mostra o que foi encontrado, sem mudar nada)%s\n' "$B" "$R" "$D" "$R"
  OP="$(pergunta "Escolha [1]:")"; OP="${OP:-1}"
fi
log "opcao: $OP | jogo: $JOGO | fs: $fs"

case "$OP" in
  1) instalar_arquivos && corrigir_idioma && verificar ;;
  2) remover ;;
  3) corrigir_idioma && verificar ;;
  4) diagnostico ;;
  *) falha "Opção inválida."; exit 1 ;;
esac

if [ "$STEAM_REABRIR" = 1 ] && ! steam_aberta; then say ""; say "  Abrindo a Steam de novo..."; abrir_steam; fi
say ""
[ "$OP" = 1 ] || [ "$OP" = 3 ] && say "${B}Pronto!${R} Abra o jogo pela Steam. Se ainda aparecer em inglês, rode a opção 4 e mande o arquivo:"
say "  ${D}$LOG${R}"
