# Notas REA — Sessao 14/10/2026 (F1 + F3)

## Resultado
- F1 extracao: **16.806 arquivos FSB5** extraidos em `DublagemIA\04-export\wav-fsb5\`
- F3 manifesto: **6.631 / 6.706 matched (98.9%)** — `DublagemIA\04-export\manifesto-final.csv`
- Os 75 "missing" sao referencias do `dabing_resources.xml` que nao existem nos SDS (provavelmente divergencia entre BR e EN)
- F4 (texto) nao se aplica: dialogo NAO tem texto separado no SDS, so o audio via `DoTalk("XX_99_XX_XXXX")` em scripts Lua

## Descobertas desta sessao

### MCP do MafiaToolkit funciona
- Servidor: `http://localhost:5123/` (Kestrel, ListenLocalhost)
- Iniciado via `Start-Process MafiaToolkit.exe` SEM `--no-gui`
- Mostra MessageBox "Toolkit update" no startup que **bloqueia** o fluxo ate clicar OK
- Solucao: `PowerShell + Win32 PostMessage WM_COMMAND IDOK` para dispensar (script em `%USERPROFILE%\AppData\Local\Temp\kilo\dismiss-update-dialog.ps1`)
- Sem dispensar o dialogo, `open_sds_file` retorna NRE (porque `GameStorage.selectedGame` fica null ate `McpServerHost.Start` completar tudo)

### Como o SDS funciona
- Header: `SDS\0` + u32 version=19 + `PC\0\0` + u32 slotCount
- Resources indexados por tipo (FrameResource, MemFile, Script, Sound, Speech, FxAnimSet, Texture, Actors, FrameNameTable, XML)
- Sound resource = `u8 nameLen` + `name(nameLen bytes ASCII)` + `u32 fileSize` + `byte[fileSize] FSB5`
- Path do som: `Dabing/Script/05/04/05_04_0010` etc. (preserva casing original EN: Script/Generic/Cutscene)

### FSB5 v1
- 60-byte header + sample header (28 ou 364 bytes) + name table + data
- Mode 0x0f = PCM8/16/24/32 hints; formato real no sample header
- Sample header layout para v1 (28 bytes, 7 u32s): nameOffset, dataOffset, length, lengthUncompressed, defMixBin, format, loopStart
- **NAO foi possivel decodificar** o sample header — valores nao batem com spec publica do FMOD 4/5
- Provavelmente variante Mafia II custom, ou dados comprimidos
- **Caminho futuro**: usar `fmod64.dll` (FMOD 5.0 build 101101) via P/Invoke para decodificar FSB5 → WAV

## Ferramentas criadas nesta sessao

| Arquivo | Funcao |
|---|---|
| `DublagemIA\02-ferramentas\extrair-dialogos-mcp.mjs` | Extrai todos os Sound resources via MCP, salva FSB5 cru |
| `DublagemIA\02-ferramentas\extrair-especifico.mjs` | Extrai SDS especificos |
| `DublagemIA\02-ferramentas\extrair-faltando.mjs` | Extrai os SDS que faltam no manifesto |
| `DublagemIA\02-ferramentas\extrair-script.mjs` | Extrai SDS da pasta `pc\sds\script\` (missao scripts) |
| `DublagemIA\02-ferramentas\manifesto.mjs` | Cruza `dabing_resources.xml` com FSB5 extraidos |
| `DublagemIA\02-ferramentas\status.mjs` | Gera `_status.txt` com resumo |
| `%USERPROFILE%\AppData\Local\Temp\kilo\dismiss-update-dialog.ps1` | Dismiss MessageBox "Toolkit update" |

## Tamanhos
- FSB5 files: 16.806 arquivos
- Espaco: ~100 MB total
- Log de extracao: 17.060 linhas
- Manifesto: 1.89 MB CSV

## Como retomar (para proxima sessao)
1. Iniciar MafiaToolkit GUI: `Start-Process MafiaToolkit.exe -WorkingDirectory "...\MafiaToolkit"`
2. Aguardar ~5s e dispensar MessageBox com `dismiss-update-dialog.ps1`
3. MCP disponivel em `http://localhost:5123/`
4. Para testar: `node DublagemIA\02-ferramentas\mcp-call.mjs "http://localhost:5123/" open_sds_file @args.json`
5. Para FSB5→WAV: usar `fmod64.dll` (FMOD 5.0) em C# P/Invoke

## Limitacoes conhecidas
- Limite 1MB por chamada `extract_resource` (corta o XML `text_default.sds` em 1MB / 1.67MB)
- M2DE Diretorio: `D:\...\pc` (ja configurado em `MafiaToolkit.ini`)
- `oo2core_8_win64.dll` **nao existe** — FMOD 4.x usa so zlib para .sds
- `decode_resource` MCP so funciona para Actors/FrameResource/ItemDesc/Collisions/Effects, **nao para Sound**
- `text_default.sds` (BR) tem font metadata, nao subtitulos

## Proximos passos
1. **F2b**: FSB5→WAV converter usando fmod64.dll (FMOD 5.0 P/Invoke)
2. **F5**: TTS PT-BR por personagem (azure-tts ou similar) com encaixe de duracao
3. **F6**: Repack .sds v19 — **NENHUMA tool publica**, precisa implementar
4. **F1b**: REA do `sdsconfig.bin` para entender `full=false` + hash compartilhado
