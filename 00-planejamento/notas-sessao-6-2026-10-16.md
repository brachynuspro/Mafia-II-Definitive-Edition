# Notas — Sessão 6 (16/10/2026) — F6 destravado: repack SDS + FSB5 + piloto in-game

## Resumo
- **Repack de .sds v19 do M2DE FUNCIONA** sem Ghidra. O `MafiaToolkit.dll` (2.35/2.36) contém
  `Gibbed.Mafia2.FileFormats.ArchiveFile` com `Deserialize/SaveResources` (unpack) e
  `BuildResources/Serialize` (pack). A conclusão das sessões 4–5 ("formato proprietário,
  requer Ghidra") estava errada: o problema era o parser caseiro, não o formato.
- Nova ferramenta `08-repack\SdsTool` (C# .NET 8, referencia o MafiaToolkit.dll, sem GUI):
  `SdsTool info|unpack|pack`. Ida e volta testada: 12/12 recursos byte-idênticos.
- **Writer FSB5 PCM16** (`02-ferramentas\wav-para-fsb5.mjs`). Validado com a `fmod64.dll` do
  jogo (via `06-fmod\Fsb5ToWav`): decodifica bit a bit igual à entrada.
- **Orquestrador** `02-ferramentas\dublar-sds.mjs`: unpack → TTS PT-BR → corta silêncio →
  acelera até 1,30× (atempo, sem mudar o tom) → completa com silêncio até a duração
  original → FSB5 → pack em `08-repack\saida\pc\...` (espelho; nunca escreve em `pc\`).
- **Piloto pronto**: `08-repack\saida\pc\sds\fmv\fmv0107_d.sds` — narração de abertura do
  Vito ("Operação Husky..."), 3 falas dubladas, 4 mantidas (interjeições + fala em italiano).
  Instalar: `08-repack\instalar.ps1` (faz backup). Desfazer: `08-repack\restaurar.ps1`.
  **Pendente: testar no jogo** (nova campanha → primeira cutscene).

## Formatos confirmados
- Dentro do SDS, recurso `Sound` = `u8 tamNome + nome + s32 tamanho + FSB5`. O MafiaToolkit
  expõe o FSB5 puro como `<nome>.fsb` e regrava sozinho.
- FSB5 v1 do jogo: cabeçalho 60 B, 1 sample, codec **Vorbis (modo 0xF)**, 44,1 kHz mono.
  Campo de 64 bits do sample: bit0 extra, bits1-4 índice de frequência, bits5-6 canais,
  bits7-33 offset/32, bits34-63 nº de amostras. Nosso writer usa PCM16 (modo 2), 22.050 Hz.
- SDS de cutscene (`fmv*_d.sds`) também traz `tables\Speech\*_fmv_subtitles.bin` (MemFile).

## Descobertas sobre o estado anterior
- As 14.426 falas TTS da F5c foram geradas com **texto placeholder** e apagadas na manhã de
  16/10 (pastas `tts-pt*` vazias). A tradução via Google (`traduzir-legendas.py`) travou em ~11%.
- As legendas extraídas só se ligam ao ID do áudio nas cutscenes (~3 mil). Falas de missão
  (`01_99_03_0880`) e de rua (`StreetTalks_*`) não têm texto associado.
- **Solução: transcrever o áudio EN com Whisper** (`02-ferramentas\transcrever-audios.py`,
  faster-whisper small.en, CPU int8). Qualidade ótima no teste; detecta inclusive falas em
  italiano (que devem ficar no original). Velocidade ≈ 1,3× tempo real → ~8 h para as ~10 h
  de fala. Rodando em segundo plano; saída `09-transcricao\transcricoes-en.small.en.csv`
  (retomável). Ordem: Script → Cutscenes → Generic.

## Armadilhas desta máquina
- **Disco C: com 0 bytes livres.** Apontar TEMP/TMP, NUGET_PACKAGES, PIP_CACHE_DIR e HF_HOME
  para o D:. O Bash do Claude Code falha (usa temp no C:); usar PowerShell.
- `torch` global quebrado (`c10.dll`, WinError 1114) e `ctranslate2` 4.8.3 dá access violation.
  Usar `ctranslate2==4.4.0` em `09-transcricao\_pylib` + `sys.modules['torch']=None`.
- PyAV instalado é incompatível com faster-whisper 1.1.1 → o script lê WAV com `wave`+numpy.
- **Edge TTS dá 429 com frequência** (mesmo em 3 falas). `dublar-sds.mjs` isola cada chamada
  em processo filho (`tts-edge-um.mjs`), tenta 6× com espera crescente e guarda cache em
  `08-repack\_cache-tts`. Mesmo assim, **não escala para ~16 mil falas**.

## Próximos passos
1. **Testar o piloto no jogo** (instalar.ps1 → nova campanha). Confirma que o loader aceita
   SDS reempacotado + FSB5 PCM16. Se falhar, testar SDS reempacotado sem alteração (isola
   repack vs. codec).
2. Ao terminar a transcrição: gerar CSV por SDS (`03-legendas\traducoes-ia\<sds>.csv`,
   colunas `id;voz;texto_pt`) e traduzir com IA (adaptação para dublagem, cabendo no tempo).
   Interjeições, gritos e falas em italiano → `=` (mantém original).
3. Escolher TTS para escala (Edge não aguenta): local (Kokoro/Piper, grátis, CPU) ou pago com
   clonagem (ElevenLabs). Clonar a voz dos atores originais é o que mais melhora o resultado.
4. Se o tamanho/memória dos SDS com PCM16 incomodar: escrever FSB5 IMA-ADPCM (≈4× menor),
   validando com Fsb5ToWav do mesmo jeito.

## Atualização (16/10/2026, tarde)
- **Por que o piloto não mudou nada no jogo:** com o idioma em PT-BR o motor carrega `pc\sds_br\<x>.sds`
  (mesmo áudio EN + tabela de legendas própria). `dublar-sds.mjs` agora usa a cópia BR como base e grava em
  `08-repack\saida\pc\sds_br\`. `instalar.ps1` devolve originais que saíram da `saida\`.
- **Roteiro oficial PT-BR encontrado:** `pc\sds_br\text\text_default.sds` → `tables\TextDatabase.dat`
  (texto `chave:legenda`). Cutscenes: chave = id do áudio (98,6%). Missão: áudio `MM_99_CC_SSSS` → chave
  `3MMCCSSSS` (97,8%). Prefixo `f_` = fala estrangeira (italiano) → manter original. Exportado em
  `03-legendas\legendas-oficiais-pt.csv`. Roteiros por SDS: `03-legendas\roteiros\*.csv` (`gerar-roteiros.mjs`).
  Obs.: as legendas dentro dos `fmv*_d.sds` do sds_br estão em polonês; não usar.
- **Falas de rua (8.956) não têm legenda** → transcrição Whisper só delas (em andamento) + tradução por IA.
- **Runtime VC++ ausente no sistema** (causa das falhas de torch/onnxruntime/ct2 4.8.3). Cópia 14.50 x64 do
  OneDrive em `09-transcricao\_vcrt`, pré-carregada via ctypes nos scripts Python.
- **TTS local Kokoro** (`10-tts-local`, kokoro-onnx int8, vozes pm_alex/pm_santa/pf_dora). ~1× tempo real na
  CPU. Edge TTS caiu para ~1 fala/min (429) e foi abandonado para escala. Vozes em `10-tts-local\vozes.json`.
- **Identificação de atores:** `embeddings-voz.py` (WeSpeaker ONNX) + `agrupar-atores.py` → `04-export\atores.csv`,
  `atores-resumo.csv`. Ajuste manual: `05-bancos\vozes-manuais.csv` (ator;voz).
- `dublar-sds.mjs` reescrito: Kokoro em lote, cache, pitch (rubberband), volume igualado ao original.
- Lote: `dublar-lote.mjs` (retomável, log em `08-repack\dublar-lote.log`). Cadeia automática em
  `08-repack\cadeia.log`.
- Amostras para ouvir: `08-repack\amostras\` (A original, B Edge, C Kokoro + legenda oficial).

## Atualização (16/10/2026, noite)
- **Agrupamento de atores refeito** (`agrupar-atores.py`): guloso + fusão aglomerativa de centroides (cosseno ≥ 0,60)
  + absorção de grupos < 4 falas. Vito (`ator001`, ~1.136 falas) e Joe (`ator002`, ~1.006) viraram grupos únicos.
  Conversas de rua: locutores separados dentro de cada arquétipo, vozes em rodízio.
- **Gênero pela impressão vocal**, não pelo tom (homens gritando passam de 200 Hz): regressão logística
  balanceada treinada com ~5 mil falas de arquétipos de gênero conhecido (Gangster*, Police*, Vito, Joe... vs
  APDCivFemale, CivilFemale, BasicFemale, Angela). Acurácia de treino 98,5%. Francesca e Marta saem femininas.
- **Lote em execução** desde 19:46 (`dublar-lote.mjs`, ~1 min por SDS pequeno). Painel de andamento:
  `node 02-ferramentas\painel.mjs` → http://localhost:8765 (ou `DublagemIA\abrir-painel.cmd`).
- Traduções de rua por IA: `03-legendas\traducao-rua-ia\bloco-00N.tsv` (723 textos únicos até agora).
  Pendentes: `node 02-ferramentas\pendentes-traducao.cjs <transcricoes.csv> <pasta-traducoes> <n>`.
- Ao fim da transcrição: traduzir o restante, rodar `gerar-roteiros.mjs` e de novo `dublar-lote.mjs`
  (pula o que já está pronto).
