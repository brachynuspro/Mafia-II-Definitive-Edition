# Notas REA — Sessao 3 (15/10/2026) — F1b cifra + F6 writer

## Resultado
- F1b cifra: tentativa avancada de decifrar `sdsconfig.bin` com cifras alternativas.
  Nenhuma chave candidata produziu texto natural >90% printable.
- F6 writer: escrevi `escrever-sds.mjs` como prototipo best-effort, mas a premissa
  de "SDSs armazenam audio em zlib simples" esta ERRADA. O audio FSB5 vem da
  descompactacao via classe `SoundSector` do MafiaToolkit, que tem estrutura
  proprietaria do Illusion Engine. Sem decompilar essa classe (dnSpy) ou REA no
  `.exe`, F6 nao pode ser implementado confiavelmente.
- F5d: script `tts-elevenlabs.mjs` preparado. Requer API key + voice_ids.

## Descobertas desta sessao

### 1. SDS nao armazena audio bruto em zlib simples
O `extrair-sds.mjs` aplicado a:
- `pc/sds/speech/apdcivblack_a1.sds` (328 KB, 2 sound sectors)
- `pc/sds/script_sounds/dlc02_sounds01.sds` (497 KB, so metadata)

O segundo arquivo tem **ZERO** blocos zlib validos, mesmo tamanho >100 KB.
O payload do primeiro (16384 B descomprimido) e metadata de animacao facial
(`FxAnimSet`, `Face`, `FxAnalysisFonix`, `OC3 Entertainment` strings), NAO FSB5.
Os 17 zlib magics no `apdcivblack_a1.sds` se sobrepoem (apenas 2 sao streams
validos independentes; os outros 15 sao inicios falsos dentro do stream principal).

Conclusao: o SDS v19 **NAO** armazena audio em zlib direto. O audio FSB5 vive
em:
- Outro slot do mesmo SDS (Sound sector type=0x9000?) comprimido com codec
  custom (nao zlib), OU
- Arquivo/container separado referenciado pelo SDS, OU
- Cifrado com TEA/XXTEA + depois compactado, descriptografado pela classe
  `SoundSector.ReadSDS` do MafiaToolkit.

Qualquer uma das hipoteses exige mapear a estrutura do Sound sector.

### 2. Cifra do sdsconfig.bin e variante TEA nao-padrao

| Tentativa | Resultado |
|---|---|
| XOR keystream ('psds', 'sdsconfig', 'SDS') | <5% printable |
| XOR com bytes do .exe em 0x3EFA40 | 25% printable (ruido) |
| XOR com string 'sdsconfig' em 0x186E259 | 5% printable |
| XOR com string 'full' em 0x18525B0 | <5% |
| XOR com string 'Brazilian' em 0x18526B0 | <5% |
| ADD com chave 'SDS19' | **84%** printable (mas nao natural) |
| RC4 com todas as chaves candidatas | <5% |
| TEA (32 rounds, delta=0x9E3779B9) com chaves candidatas | <30% |
| XTEA com chaves candidatas | <30% |
| TEA com primeiros 16B do proprio payload como key | 39% |

Estrutura do cipher: bytes em 0x08..0x29C estao na faixa 0x86..0x9E com 0xFF
intercalado. **EDIT/sdsconfig.bin e pc/sds/sdsconfig.bin compartilham bytes
identicos em 0x0C..0x1F** (apenas off1 difere: 0x29C vs 0x2AA).

Hipoteses:
1. Cifra de fluxo com keystream derivado de uma chave fixa de 16 bytes
   desconhecida, gerada em runtime via obfuscacao no .exe.
2. Round-key rotation per-bloco (cada 8 B usa proxima subkey).
3. Custom cipher do Illusion Engine, nao TEA-padrao.

Sem disassembler (Ghidra/IDA), testar essas hipoteses exige centenas de
tentativas de brute-force com keys random.

### 3. Limitacoes do F6 writer prototipo

O `escrever-sds.mjs` escrito presume:
- Cada Sound resource esta em seu proprio bloco zlib no SDS.
- O zlib contem exatamente `u8 nameLen + name + u32 fileSize + FSB5`.

Nenhuma das duas premissas se confirmou. A premissa 1 e falsa (varios records
compartilham blocos zlib ou usam codec diferente). A premissa 2 e parcialmente
verdadeira (o MCP extrai assim, mas a estrutura interna do SDS antes de chegar
nesse formato nao e zlib puro).

Para F6 virar realidade:
- Decompilar `MafiaToolkit.dll` (3.9 MB, .NET 8) com **dnSpy** ou **ILSpy**
- Mapear `ResourceTypes.Sound.SoundSectorBase.ReadSDS()` e suas classes filhas
- Identificar codec/compressao/cifra usada para Sound
- Replicar o pipeline inverso no writer Node

### 4. Eliminados do roadmap

- F2b.5 (FSB5->WAV): **JA FEITO** (16.802 WAVs em `04-export\wav\`, duracoes
  em `04-export\duracoes.csv`). Nao precisa re-executar.
- Sound sector e apenas zlib: **falso** (notas-rea-f1b.md esta desatualizado).

## Ferramentas criadas nesta sessao

| Arquivo | Funcao |
|---|---|
| `DublagemIA\02-ferramentas\decifrar-psds-2.mjs` | Brute-force cifra com strings do .exe como key (XOR/ADD/RC4/TEA). Nao funcionou. |
| `DublagemIA\02-ferramentas\escrever-sds.mjs` | PROTOTIPO F6: writer Sound resource. Premissas falsas; NAO usar em producao. |
| `DublagemIA\02-ferramentas\tts-elevenlabs.mjs` | F5d: geracao ElevenLabs Multilingual v2 + ffmpeg atempo. Requer API key + voice_ids. |
| `%USERPROFILE%\AppData\Local\Temp\kilo\inspect-sds.mjs` | Probe do layout SDS — confirmou que audio NAO esta em zlib direto. |
| `%USERPROFILE%\AppData\Local\Temp\kilo\inspect-payload.mjs` | Probe do payload zlib — confirmou metadata de FaceAnim, nao audio. |

## Proximos passos (ordenados por impacto)

1. **Instalar Ghidra** ou **IDA Free** e:
   - Carregar `Mafia II Definitive Edition.exe` (37 MB).
   - Disassemble funcao em 0x3EFA40 (decifradora sdsconfig.bin).
   - Identificar algoritmo exato (parece TEA modificado / cifra custom).
   - Seguir xref a 0x3EFA40 + 5 call sites -> encontrar quem chama
     decifracao e qual chave e' passada.
2. **Decompilar MafiaToolkit.dll** com **dnSpy** (.NET 8 supported):
   - Abrir `DublagemIA\02-ferramentas\MafiaToolkit\MafiaToolkit.dll`.
   - Navegar ate `ResourceTypes.Sound.SoundSectorBase.ReadSDS`.
   - Exportar codigo IL equivalente para C# e portar para Node ESM.
3. **Com Ghidra+dnSpy**: completar `escrever-sds.mjs` e testar com 1 SDS
   (1 sound resource modificado), validando via FmodProbe + jogo.
4. **Paralelo**: rodar `tts-elevenlabs.mjs --prototipo=1` quando API key estiver
   disponivel. Configurar ElevenLabs Voice Library com clones dos atores EN.

## Limitacoes conhecidas
- Ate ter o writer funcional, **NENHUM SDS pode ser modificado** sem risco de
  corromper o jogo. Smoke-tests com SDS modificado devem SEMPRE ser feitos em
  copia (ex.: copiar `pc/sds/speech/shop.sds` para `pc/teste/`).
- O caminho `pc/sds_br/` nao tem audio (apenas `dabing_resources.xml` e
  `sds_list.txt`). Mesmo que F6 funcione, e' necessario F1b (entender o loader)
  para forcar o jogo a carregar de `sds_br` em vez do fallback EN.
- F5d (ElevenLabs free tier) cobre ~50 falas (~10k chars). Para 6.706 falas
  completas, plano pago (~$22/mes starter) ou Coqui XTTS local (precisa GPU).
