# Notas REA — F1b e adjacentes

> Levantamento de engenharia reversa do executável e do formato SDS, realizado em 14/10/2026.
> Complementa `00-planejamento/PLANO.md` com achados novos e correções.

## 1. Correções ao PLANO.md

### 1.1 Header do SDS v19 está ERRADO no PLANO

O PLANO afirma (linhas 23-30) que o header SDS v19 é:
```
53 44 53 00 13 00 00 00 50 43 00 00 48 00 00 00
```
com `n_recursos = 0x48 = 72` no offset 0x0C. **Errado.**

A estrutura real, lida de `pc\sds\speech\apdcivblack_a1.sds`:

| Offset | Valor | Significado |
|---|---|---|
| 0x00 | `53 44 53 00` | magic "SDS\0" |
| 0x04 | 0x13 (u32 LE) | versão 19 |
| 0x08 | `50 43 00 00` | plataforma "PC\0\0" |
| 0x0C | `0x5FFB74F3` (constante) | magic secundário da v19 PC — NÃO é n_recursos |
| 0x10 | 0x48 = 72 (u32 LE) | n_slots (nº de slots pré-alocados) |
| 0x14 | 0x72 = 114 (u32 LE) | tamanho da tabela de strings |
| 0x18 | 0x4F04F (u32 LE) | offset do **índice XML** no fim do arquivo |
| 0x1C | 0x268 (u32 LE) | offset do **primeiro registro** (não cabeçalho do índice) |
| 0x20-0x3B | zeros | flags/reservado |

**Conclusão:** `n_recursos = 72` está em 0x10, não 0x0C. E o `dataOff` que parecia estranho é o **offset do índice XML** (não dos dados compactados).

### 1.2 Estrutura interna do SDS v19 (apdcivblack_a1.sds)

Verificado empiricamente com 328.765 B:

- **0x00-0x1B**: header (28 B)
- **0x1C-0x3B**: header do índice (32 B) — contém pointers
- **0x3C-0xAB**: tabela de strings (114 B) — nomes de tipos ("FxAnimSet", "Sound", "UEzl", etc.)
- **0x3C-0x9B**: **primeiro registro de metadados** (96 B) — tamanho, tipo, subtipo, flags
- **0x9C-0x1382**: **primeiro bloco compactado** (zlib, 4834 B comp → 16384 B decomp, adler32 validado)
- **0x1382-0x13A6**: gap de 32 B = **registro do segundo recurso**
- **0x13A7-0x334D**: **segundo bloco compactado** (zlib, 8102 B comp → 16384 B decomp, adler32 validado)
- **0x334E-0x4F04E**: ~309 KB de **metadados/índices** (não-zlib, possivelmente referências a outros arquivos)
- **0x4F04F-fim**: **índice XML** (`<?xml version="1.0" ...?><xml><ResourceInfo>...<TypeName>FxAnimSet</TypeName>...`)

**Conclusão:** o arquivo tem **2 sound sectors com payload** (16384 B cada = 32 KB total de áudio) e metadados XML no fim. O `n_slots=72` é o número de slots pré-alocados, não recursos reais.

### 1.3 Oodle DLL NÃO está em `pc\`

PLANO e AGENTS.md dizem que `oo2core_8_win64.dll` está em `pc\`. **Errado** — busca global em `C:\` e `D:\` não encontrou. O jogo aparentemente não usa Oodle em runtime (apenas zlib). O `MafiaToolkit\OodleSharp.dll` é o binding .NET, mas a DLL nativa não está presente.

`MafiaToolkit` é uma aplicação GUI (WeifenLuo.WinFormsUI.Docking) sem modo CLI — não dá para automatizar. Mas ela tem código aberto de extração que pode ser reaproveitado (ver §3).

## 2. Achados do `Mafia II Definitive Edition.exe`

Tamanho: 37.324.288 B. String-scan via `varredura-binaria.mjs`:

| Keyword | Hits (ASCII) | Onde |
|---|---|---|
| `sds_br`, `sds_en`, `sds_de` | 0 | — |
| `dabing`, `speech_shops`, `script_sounds` | 0 | — |
| `audio_hash_value` | 1 (0x18525E8) | header do índice — chave do formato `sdsconfig.bin` |
| `full` | 30 (0x18525B0) | header do índice — campo `<full>` |
| `sdsconfig` | 1 (0x186E259) | path para o arquivo de configuração |
| `psds` (magic) | 1 (0x3EFAD2) | função validadora de `sdsconfig.bin` |
| `/sds/` | 51 | paths de SDS fixos (apex, tables, cars, etc.) |
| `/sds_` (com sufixo) | 0 | sufixo é calculado em runtime |
| `sds_*` | 1 (0x184DC6C) | string template `sds_*` (provavelmente glob para pacotes localizados) |
| `__sds_base_id` | 1 (0x184DC78) | variável global de base |
| `sdsNameTable.txt`, `legacySdsNameTable.txt` | 1 cada (0x186E318, 0x186E330) | tabelas de nomes (NÃO existem em `pc\`) |
| `lastLang_1.01` | 1 (0x184DC8C) | chave de registry/config — último idioma |
| `Brazilian` (pt-BR) | 1 (0x18526B0) | **locale válido hardcoded** — confirma suporte |
| `en-gb`, `de-DE`, `fr-FR`, `it-IT`, `ko-KR`, `es-ES`, `zh-CN`, `zh-HK`, `ru-RU`, `ja-JP`, `pl-PL`, `en-CZ`, `es-MX` | 1 cada | tabela de locales |

**Hashes conhecidos (PLANO.md) NÃO estão hardcoded no `.exe`** (0 hits): `936745AD` (BR), `2E54CDB8` (JP), `777526080` (audio_hash_value). Provavelmente calculados em runtime.

**Função decifradora de `sdsconfig.bin`:** 5 chamadores (CALL E8 → 0x3EFA40) em 0x3E9874, 0x3E9A04, 0x3F89B9, 0x3F8A0B, 0x3F8AE2. Verificar xrefs a `0x186E259` (`sdsconfig.bin`) para encontrar quem carrega o arquivo.

## 3. MafiaToolkit.dll (inspeção via `ildasm`)

Caminho: `DublagemIA\02-ferramentas\MafiaToolkit\MafiaToolkit.dll` (3.9 MB, .NET 8). Classes relevantes:

- `ResourceTypes.Sound.SoundSectorBase.ReadSDS(MemoryStream, Endian)` — método base para ler sound sectors
- `ResourceTypes.Sound.SoundSectorNormal.ReadSDS(...)` — implementação para SDS de civis
- `Gibbed.Illusion.FileFormats.Hashing.FNV64`/`FNV32` — funções de hash do formato Gibbed

O layout do `SoundSector` (lido do IL):
```
uint16 count (Unk0.Length)
uint16[count] Unk0
uint32 Unk1
uint32 Unk2
String8 Name (length-prefixed)
int16 Unk3
uint16 Unk4
uint16 Unk5
bool bBasicSceneOnly
```

## 4. Ferramentas criadas/adaptadas nesta etapa

| Ferramenta | Função | Tamanho |
|---|---|---|
| `02-ferramentas\varredura-binaria.mjs` | conta ocorrências de strings em binário (ASCII + UTF-16LE) | ~700 B |
| `02-ferramentas\extrair-strings.mjs` | extrai todas as strings ASCII imprimíveis com offset | ~700 B |
| `02-ferramentas\xref-pe.mjs` | encontra referências cruzadas (LEA RIP-relative) em PE x64 | ~1.1 KB |
| `02-ferramentas\decifrar-psds.mjs` | tenta decifrar `sdsconfig.bin` com TEA/XTEA e chaves candidatas (NÃO funcionou) | ~2.5 KB |
| `02-ferramentas\extrair-sds.mjs` | parser+extrator SDS v19 com validação adler32 | ~3.5 KB |
| `FmodProbe\Program.cs:53-66` | corrigido para aceitar paths com espaço | patch |

## 5. F1b — Status e próximos passos

**Resolvido:**
- Função decifradora de `sdsconfig.bin` identificada (0x3EFA40, 5 chamadores)
- Estrutura do header SDS v19 corrigida
- Locale `Brazilian` (pt-BR) hardcoded no `.exe`
- Extrair-sds.mjs funcional (valida adler32, detecta fim de bloco zlib)

**Pendente:**
- Decifrar `sdsconfig.bin` para entender a tabela de hashes/locales. TEA/XTEA com chaves candidatas não funcionou. Próximas tentativas: cifra de fluxo com keystream derivado do header, ou análise do call site 0x3EFA40 com disassembler.
- Localizar xrefs a `sdsconfig.bin` (0x186E259) — provavelmente via `mov` indireto ou ponteiro de vtable.
- Entender a lógica que decide entre `sds` e `sds_br` em runtime. Hipótese: o motor lê `sdsconfig.bin`, verifica o `audio_hash_value` do pacote, e decide se carrega ou cai no fallback inglês.

## 6. F1 — Extração de SDS

`extrair-sds.mjs` extrai blocos zlib de SDS v19, validando adler32. **Limitação atual:** o SDS `apdcivblack_a1.sds` tem 72 slots mas apenas 2 com payload zlib. Os outros 70 são **metadados/referências** (provavelmente apontam para outros arquivos via `sdsNameTable.txt` que não existe em `pc\`).

**Para F1-F2, próximos passos:**
1. Reusar a lógica do MafiaToolkit (classe `SoundSector`) para parsear registros de 96 B.
2. Identificar quais registros têm payload zlib e quais são apenas metadados.
3. Extrair os WAVs de dentro dos blocos zlib.
4. Fazer batch em todos os .sds de voz (script_sounds, speech, speech_shops, fmv).

## 7. Correções pendentes ao AGENTS.md

- `oo2core_8_win64.dll` **NÃO** está em `pc\` — remover/corrigir menção no AGENTS.md
- PLANO.md linhas 23-30 (header SDS v19) — atualizar com a estrutura correta
- `sdsNameTable.txt` e `legacySdsNameTable.txt` NÃO existem em `pc\` (apenas no `.exe`)
- AMOSTRA `02_02_00_0020.fsb5` em `07-fsb5\` **NÃO é FSB5** — é SDS embutido com magic `#Dab`
- FMOD Ex (`fmodex64.dll`) é build `fmod4` (não suporta FSB5 v1); o jogo também tem `fmod64.dll` (FMOD 5.x C++). Música/rádio usa `.fsb` (não `.fsb5`).
