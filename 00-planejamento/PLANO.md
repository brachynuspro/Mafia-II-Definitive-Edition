# Dublagem com IA — Mafia II: Definitive Edition

**Appid Steam:** 1030830 · **Instalação:** `D:\SteamLibrary\steamapps\common\Mafia II Definitive Edition`
**Data do levantamento:** 14/10/2026 · **Fase:** F0 concluída

---

## 1. O que a pesquisa na web errou

A documentação pública e o `CLAUDE.md` do MafiaToolkit apontam para **Wwise (`.bnk`/`.wem`/`.pck`)**.
**Isso não se aplica ao Mafia II DE.** O conteúdo real em disco é:

| O que a web diz | O que existe em disco |
|---|---|
| Wwise / BNK / WEM / PCK | **Nenhum** desses arquivos no jogo |
| — | **FMOD/FSB** — `fmod.dll`, `fmod64.dll`, `fmodex64.dll` em `pc\` |
| — | **12.421 arquivos `.sds`** (39,4 GB) — o container real de assets |

> O `.fsb` aqui é só **música e rádio** (`pc\sds\music\`, 600 arquivos). **A voz não está em `.fsb`.**

## 2. Container SDS — formato confirmado

Cabeçalho lido de `pc\sds\speech\apdcivblack_a1.sds`:

```
53 44 53 00   "SDS\0"
13 00 00 00   versão = 0x13 = 19        -> SDS v19 (Mafia II / DE)
50 43 00 00   plataforma "PC\0\0"
48 00 00 00   nº de recursos = 72
```

- Herdado do formato **Gibbed.Illusion**
- Compactação: **zlib** e/ou **Oodle** (`oo2core_8_win64.dll` da própria pasta do jogo)
- Arquivos criptografados usam **TEA**

## 3. Onde vive cada tipo de áudio

| Caminho | Conteúdo | Volume |
|---|---|---|
| `pc\sds\speech\` | 276 `.sds` — barks de civis (`apdcivblack`, `apdcivfemale`, …) | 108 MB |
| `pc\sds\speech_shops\` | Barks de lojistas | — |
| `pc\sds\script_sounds\` | **Diálogo de missão** | — |
| `pc\sds\fmv\` | **Diálogo de cutscene** (cenas `.bik` de 3,7 GB) | — |
| `pc\sds\sound_city\`, `sound_default\` | SFX ambiente | — |
| `pc\sds\music\` | Música + rádio (inclusive "speech" = locutor de rádio, **não é diálogo**) | 391 MB |

## 4. ★ O jogo já traz o manifesto oficial de dublagem

**`pc\sds_br\dabing_resources.xml`** (919 KB) é o índice de produção usado pela 2K/3D Realms.
Não é documentação de terceiros — é artefato do build. Ele mapeia **245 scripts → 6.706 WAVs**:

```xml
<sds name="script_sounds\m05_sounds_5.xml">
  <resource name="c:\p4v\...\mafia2\edit\sounds\dabing\script\05\04\05_04_0010.wav" />
```

Padrão de nome: `script\<missão>\<capítulo>\<missão>_<capítulo>_<slot>.wav`

- `4342` falas de **script** (diálogo de missão)
- `2298` falas **generic** (lojistas, NPCs)
- `66` falas de **cutscene**

`pc\sds_br\sds_list.txt` lista os ~430 XML localizados do pacote BR.

## 5. ★ O jogo NÃO tem dublagem em português brasileiro

> ⚠️ **Correção.** Uma primeira leitura do tamanho dos arquivos sugeriu que `sds_br` continha áudio
> dublado. **Não contém.** Verificação por conteúdo abaixo.

### 5.1 Agrupamento por hash entre idiomas

Mesmos arquivos, SHA-256, amostragem de 40 arquivos do `sds_br`:

| Hash | Idiomas | Interpretação |
|---|---|---|
| `936745AD4D27` | **BR, LatAm, PL** | payload byte-idêntico entre si |
| `2E54CDB81AD3` | **JP, KR, Chinês simplif., Chinês trad.** | payload byte-idêntico entre si |
| `589DE245` / `F146B20B` / `1148EA80` / `53A5C72C` / `F4BE664A` / `04D1AA31` | DE, FR, IT, RU, SPA, CZ | **um hash por idioma** |

Português, Espanhol e Polonês **não podem** compartilhar áudio — o conteúdo é idêntico byte a byte.
Logo não há voz em português no pacote BR.

O flag `<full>` confirma o padrão:

| `full=true` — **dub real** | `full=false` — **sem dub** |
|---|---|
| en, de, fr, it, ru, spa, cz, pl | br, jp, kr, latam, sc, tc |

Os pacotes `full=false` compartilham `audio_hash_value = 777526080`; os `full=true` têm hash único.

### 5.2 Delta de tamanho BR − EN, por subpasta

Todos os 491 `.sds` do `sds_br` têm equivalente em `pc\sds`:

| Subpasta | Arquivos | Delta médio | Tamanho médio | Leitura |
|---|---|---|---|---|
| `text` | 2 | **+39.650 B** | 564 KB | legendas traduzidas — delta grande |
| `script` | 11 | +280 B | 1.314 KB | strings de missão |
| `fmv` | 140 | **+209 B** | 1.508 KB | delta minúsculo → **áudio = inglês** |
| `script_sounds` | 178 | **+204 B** | 590 KB | delta minúsculo → **áudio = inglês** |
| `gui` | 74 | +82 B | 931 KB | strings de UI |
| `speech_shops` | 81 | **0 B** | 525 KB | **byte-idêntico ao inglês** |
| `missionscript` | 5 | −3.439 B | 28 KB | strings substituídas por menores |

`speech_shops` tem delta **exatamente zero** nos 81 arquivos. Áudio dublado produziria variação de
centenas de KB, não de ~200 bytes.

### 5.3 Consequência

Não existe dublagem BR para substituir — vamos **criar a primeira**. Isso é melhor e pior:

- **Melhor:** o esqueleto já existe. `dabing_resources.xml` define os 6.706 slots e o
  `sds_list.txt` lista os ~430 scripts localizados. O jogo já lê desse diretório.
- **Pior:** o flag `full=false` pode fazer o motor **ignorar** áudio nesse pacote e cair no inglês.
  **Este é o primeiro ponto a resolver com o REA** — localizar no executável a decisão que lê
  `full` / `audio_hash_value` e o fallback de idioma.

## 6. Pipeline corrigido

| Fase | Tarefa | Ferramenta |
|---|---|---|
| ✅ **F0** | Reconhecimento, manifesto, formato do container | PowerShell + leitura de header |
| **F1** | Descompactar os `.sds` de voz (zlib/Oodle) | MafiaToolkit (SDS v19) / SDS Tool |
| **F1b** | **REA**: achar no exe a lógica de `full` / `audio_hash_value` / fallback de idioma | REA + RE no binário |
| **F2** | Extrair os WAVs de dentro dos `.sds` | MafiaToolkit `extract_resource` |
| **F3** | Cruzar WAV ↔ script ↔ legenda → manifesto final | `01-inventario/manifesto-dublagem.csv` como base |
| **F4** | Extrair o **texto original** (legendas) para saber o que é falado | `sds_br\text\text_default.sds`, `pc\sds\text\` |
| **F5** | TTS por personagem, com encaixe na duração original | TTS + alongamento temporal |
| **F6** | Re-empacotar `.sds` e testar no jogo | MafiaToolkit (repack) |
| **F7** | Painel de progresso | a definir |

### Por onde o REA entra
1. **Reverter `Mafia II Definitive Edition.exe`** (35,6 MB) e as DLLs de FMOD — descobrir como o jogo
   resolve e carrega os banks por idioma (`audio_hash_value`, `sds_br`) e onde valida integridade.
2. **Reconstruir o `.sds`** — a parte de escrita não é coberta por tool nenhum.
3. **Validar** que o pacote repackado é aceito pelo loader (checksum/TEA).

## 7. Riscos

- **Lip sync**: cutscenes com `.bik` têm boca sincronizada ao áudio original. Trocar a fala exige
  gerar áudio com a **mesma duração** — é o gargalo real do projeto.
- **TEA + Oodle** no repack podem exigir a `oo2core_8_win64.dll` original.
- **Ritmo PT-BR ≠ EN**: dublagem brasileira oficial costuma ser adaptável; dublagem IA na duração
  original vai soar "apertada" em falas longas.
- **Direito autoral**: substituir áudio na sua própria cópia para uso pessoal/mod é o caminho normal.
  Distribuir um pacote comercial exigiria direitos de 2K/3D Realms e dos interpretes originais.

## 8. Artefatos

- `01-inventario/manifesto-dublagem.csv` — 6.706 falas com pacote SDS, missão, capítulo, slot e caminho de origem