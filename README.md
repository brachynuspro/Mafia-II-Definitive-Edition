# Dublagem PT-BR com IA — Mafia II: Definitive Edition

Dublagem não oficial em português do Brasil para *Mafia II: Definitive Edition* (Steam, appid 1030830),
feita com vozes sintéticas (TTS) e com cada fala encaixada no tempo do áudio original em inglês.

- **583 arquivos de áudio do jogo (`.sds`)**, cerca de **13 mil falas**
- Cutscenes e diálogos de missão da campanha e das DLCs
- Falas da cidade: pedestres, policiais, lojistas, bartenders, frentistas, jornaleiros e noticiário da rádio
- Gritos, risadas e falas em italiano/cantonês mantêm o áudio original

> Este repositório tem **só as ferramentas, a documentação e as traduções**. Nenhum áudio ou arquivo do jogo
> é distribuído aqui. Para gerar a dublagem é preciso ter o jogo original.

## Como instalar (para jogar)

1. Baixe o `Mafia2DE-Dublagem-PTBR.zip` na página de
   [Releases](https://github.com/brachynuspro/Mafia-II-Definitive-Edition/releases) e extraia o zip inteiro.
2. Feche o jogo e rode o instalador do seu sistema:

| Sistema | Como rodar |
|---|---|
| Windows | clique duas vezes em `instalar-windows.bat` |
| Linux (Bazzite, SteamOS/Steam Deck, ROG Ally, Ubuntu, Fedora, Arch...) | no terminal, dentro da pasta: `bash instalar-linux.sh` (sem sudo) |
| macOS (CrossOver / Whisky / Wine) | clique duas vezes em `instalar-mac.command` ou rode `python3 instalar.py` |

O instalador acha o jogo, guarda os originais em `DublagemPTBR-backup` e muda o idioma para português.
Para desinstalar, rode de novo e escolha "remover". Detalhes no `LEIA-ME.txt` do pacote.

---

## Como foi feito

### 1. Reconhecimento (descobrir como o jogo guarda a voz)

A documentação pública dizia que o jogo usa Wwise — **errado**. Mafia II DE usa **FMOD** e guarda tudo em
containers **`.sds` v19** (formato Gibbed.Illusion, compactação zlib). Cada fala é um recurso `Sound` dentro
do `.sds`, contendo um **FSB5** (Vorbis, 44,1 kHz, mono).

O jogo já traz um manifesto de produção de dublagem (`pc\sds_br\dabing_resources.xml`, 245 scripts → 6.706
WAVs), mas o pacote brasileiro é marcado `full=false`: tem legendas em PT-BR e o mesmo áudio em inglês.

Achados importantes pelo caminho:

- Com o idioma em PT-BR o motor carrega `pc\sds_br\<x>.sds`, não `pc\sds\<x>.sds` — os arquivos dublados de
  cutscene e missão precisam ir para `sds_br`.
- O idioma efetivo fica no `settings.xml` de cada perfil (`<Language>brazilian</Language>`); o menu do jogo
  não tem opção de idioma. A Steam só conta na **criação** do perfil: o launcher usa o idioma do
  `appmanifest_1030830.acf`. E um arquivo `info` de outro idioma esquecido em `pc\sds` (resto de outra
  tradução) faz o jogo carregar o inglês mesmo com tudo em português. Os instaladores tratam os três casos.
- A engenharia reversa do `.exe` (Ghidra) ajudou a entender o formato, mas no fim não foi preciso:
  o `MafiaToolkit.dll` já contém leitura **e escrita** de `.sds` v19.

### 2. Extração

- `.sds` → recursos individuais com o **MafiaToolkit** (via a ferramenta de linha de comando `08-repack\SdsTool`).
- FSB5 → WAV usando a própria `fmod64.dll` do jogo (`06-fmod\Fsb5ToWav`, `Fsb5Batch`).

### 3. Texto (o que é falado em cada fala)

- **Cutscenes e missões:** o roteiro oficial em PT-BR já existe nas legendas do jogo
  (`pc\sds_br\text\text_default.sds` → `TextDatabase.dat`). As chaves batem com o ID do áudio em ~98% dos casos.
  Prefixo `f_` = fala estrangeira (italiano) → mantém o original.
- **Falas de rua (~9 mil):** não têm legenda. O áudio em inglês foi **transcrito com Whisper**
  (faster-whisper `small.en`, CPU int8) e depois **traduzido por IA (LLM)**, adaptando para dublagem
  (frases curtas, cabendo no tempo, linguagem coloquial). Resultado em `03-legendas\traducao-rua-ia\`.
- Ajustes manuais (textos encurtados etc.) em `03-legendas\ajustes-dublagem.tsv`.

### 4. Quem fala o quê (vozes)

- Impressão vocal de cada fala com **WeSpeaker** (ONNX) → `embeddings-voz.py`.
- Agrupamento em "atores" (`agrupar-atores.py`): agrupamento guloso + fusão aglomerativa de centroides
  (cosseno ≥ 0,60). Vito e Joe viram grupos únicos (~1.100 e ~1.000 falas).
- Gênero pela impressão vocal (regressão logística, ~98% de acerto no treino), porque o tom engana —
  homem gritando passa de 200 Hz.
- Cada ator recebe uma voz TTS + fator de tom (`10-tts-local\vozes.json`, `voice-map.mjs`).

### 5. Síntese de voz e encaixe no tempo

Orquestrado por `02-ferramentas\dublar-sds.mjs`, para cada `.sds`:

1. Desempacota o `.sds` original
2. Gera a fala em PT-BR com **Kokoro TTS** (local, `kokoro-onnx` int8, vozes `pm_alex`, `pm_santa`, `pf_dora`)
3. Ajusta o tom por personagem (**rubberband** via ffmpeg)
4. Corta silêncio, acelera até 1,30× sem mudar o tom (**ffmpeg `atempo`**) e completa com silêncio até a
   **duração exata do original** (importante pelo lip sync das cutscenes)
5. Iguala o volume ao original
6. Converte para **FSB5 PCM16** (`wav-para-fsb5.mjs`, writer próprio validado bit a bit com a `fmod64.dll` do jogo)
7. Reempacota o `.sds` (`SdsTool pack`)

`dublar-lote.mjs` roda isso para todos os arquivos (retomável) e `painel.mjs` mostra o andamento em
`http://localhost:8765`.

Edge TTS e ElevenLabs também foram testados (`tts-edge-um.mjs`, `tts-elevenlabs.mjs`). O Edge foi abandonado
porque passou a bloquear (HTTP 429) com volume alto; o Kokoro roda na CPU, de graça, a ~1× tempo real.

### 6. Pacote e instalador

`10-pacote\Mafia2DE-Dublagem-PTBR\` tem os instaladores:

- **Windows:** `instalar-windows.bat` → `instalador\windows.ps1` (PowerShell)
- **Linux:** `instalar-linux.sh` (Bash). Reconhece a distribuição e o aparelho (Bazzite, SteamOS, Steam Deck,
  ROG Ally...), Steam nativa/Flatpak/Snap, acha o prefixo do Proton em qualquer biblioteca (no Bazzite ele
  fica na memória interna mesmo com o jogo no cartão SD), ajusta o idioma no `appmanifest` e nos perfis e tem
  modo `--diag` só para diagnóstico. Log em `instalador-linux.log`.
- **macOS (CrossOver/Whisky/Wine) e alternativa no Linux:** `instalar.py` (Python 3, só biblioteca padrão).
  Abre uma janela com tkinter ou cai para o modo terminal, ignora diferenças de maiúsculas/minúsculas,
  verifica espaço em disco, copia de forma atômica e grava tudo em `instalador.log`.

Os instaladores acham a pasta do jogo, fazem backup dos originais, copiam os `.sds` dublados e mudam o
idioma para português. Há opção para remover e restaurar tudo.

O zip de distribuição é gerado por `02-ferramentas\zipar-pacote.py`, que grava as permissões Unix
(scripts com 0755). Zips feitos pelo Windows perdem o bit de execução e dão "Permissão negada" no Linux.

---

## Ferramentas usadas

| Ferramenta | Para quê |
|---|---|
| [MafiaToolkit](https://github.com/Greavesy1899/MafiaToolkit) 2.36 | Ler e escrever `.sds` v19 (usado como biblioteca pelo `SdsTool`) |
| FMOD (`fmod64.dll` do próprio jogo) | Decodificar FSB5 e validar o writer FSB5 |
| [Ghidra](https://ghidra-sre.org/) | Engenharia reversa do executável (formato e carregamento por idioma) |
| [faster-whisper](https://github.com/SYSTRAN/faster-whisper) (`small.en`) + CTranslate2 4.4.0 | Transcrição do áudio em inglês |
| LLM (IA generativa) | Tradução/adaptação das falas de rua para dublagem |
| [Kokoro TTS](https://github.com/thewh1teagle/kokoro-onnx) (kokoro-onnx, int8) | Síntese de voz PT-BR, local |
| Edge TTS (`node-edge-tts`), ElevenLabs | Testes de TTS (não usados na versão final) |
| [WeSpeaker](https://github.com/wenet-e2e/wespeaker) (ONNX) | Impressão vocal para separar atores e gênero |
| [FFmpeg](https://ffmpeg.org/) 9 (`atempo`, `rubberband`, `silenceremove`) | Encaixe no tempo, tom e volume |
| Node.js (ESM) | Scripts de extração, orquestração, writer FSB5, painel |
| Python 3.12 (numpy, onnxruntime) | Transcrição, embeddings, agrupamento, TTS |
| C# / .NET 8 | `SdsTool`, `FmodProbe`, `Fsb5ToWav`, `Fsb5Batch` |
| PowerShell / Bash | Instalação, backup e restauração |
| Agentes de IA (Claude Code, Kilo) | Apoio na engenharia reversa, escrita dos scripts e documentação |

---

## Estrutura do repositório

| Pasta | Conteúdo |
|---|---|
| `00-planejamento\` | `PLANO.md` e notas de cada sessão (o diário técnico do projeto) + scripts Ghidra |
| `01-inventario\` | Manifesto das 6.706 falas do `dabing_resources.xml` |
| `02-ferramentas\` | Scripts Node/Python: extração, transcrição, TTS, orquestração, writer FSB5, painel |
| `03-legendas\` | Traduções de rua por IA, ajustes manuais, lista de personagens |
| `05-bancos\` | Índice de quais falas estão em qual `.sds` |
| `06-fmod\` | Projetos C# que usam a FMOD do jogo (sondagem e FSB5 → WAV) |
| `07-fsb5\` | Resultados das sondagens de FSB5 |
| `08-repack\` | `SdsTool` (unpack/pack de `.sds`) e scripts de instalar/restaurar para teste |
| `09-transcricao\` | Transcrições Whisper do áudio em inglês |
| `10-pacote\` | Instaladores e LEIA-ME do pacote final |
| `10-tts-local\` | Vozes Kokoro de cada papel (`vozes.json`) e elenco ator → personagem (`elenco.csv`) |

Ficam **fora** do Git (ver `.gitignore`): áudio e `.sds` do jogo, legendas oficiais extraídas, o projeto
Ghidra, o MafiaToolkit, modelos de IA e bibliotecas Python/Node. Tudo isso é baixado à parte ou regenerado
pelos scripts.

## Como reproduzir (resumo)

1. Tenha o jogo instalado pela Steam.
2. Baixe o MafiaToolkit 2.36 e extraia em `02-ferramentas\MafiaToolkit\`.
3. Instale Node.js, .NET 8 SDK, Python 3.12 e FFmpeg (com rubberband).
4. Baixe o modelo Kokoro (`kokoro-v1.0.int8.onnx` e `voices-v1.0.bin`) em `10-tts-local\modelos\`.
5. Compile o `SdsTool`: `dotnet build -c Release 08-repack\SdsTool`.
6. Dublar um arquivo: `node 02-ferramentas\dublar-sds.mjs <pc\sds_br\...\x.sds> <roteiro.csv>`
   (CSV `id;voz;texto_pt`; `=` mantém o áudio original). Em lote: `node 02-ferramentas\dublar-lote.mjs`.

Os scripts assumem o jogo em `D:\SteamLibrary\steamapps\common\Mafia II Definitive Edition` com este
repositório na subpasta `DublagemIA`; ajuste a raiz no topo de cada um. O FFmpeg é procurado na variável
`FFMPEG`, depois na instalação do winget e por fim no PATH.

---

## Licença

O código e as traduções deste repositório estão sob a [licença MIT](LICENSE). Ela **não** cobre o jogo, o
áudio, as legendas oficiais nem as marcas de *Mafia II*, que não fazem parte do repositório.

## Aviso

Projeto de fãs, sem fins comerciais e sem ligação com a 2K Games, a Hangar 13 ou a 2K Czech. *Mafia II* é
marca dos seus respectivos donos. É preciso ter o jogo original para usar a dublagem.
