# Notas REA — Sessao 2 (14/10/2026) — F2b FSB5→WAV

## Resultado
- F2b: **16.802 WAVs convertidos** de 16.806 FSB5 (4 falhas, 0,024%)
- Tempo: 29 minutos
- Ferramenta: `DublagemIA\06-fmod\Fsb5Batch` (C# .NET 8 + P/Invoke fmod64.dll)

## Descobertas desta sessao

### fmod64.dll (FMOD 5.0 build 101101) FUNCIONA para FSB5 v1
- Path: `D:\SteamLibrary\steamapps\common\Mafia II Definitive Edition\pc\fmod64.dll`
- Versao: 1.10.12 (build 101101 = 2010-11-01, FMOD 5.0.10)
- Exports: tanto C++ mangled (`?Create@System@FMOD@...`) quanto C-style (`FMOD5_System_Create`, `FMOD_System_Create`)

### API C-style do FMOD 5.0 (x64)
- `FMOD_System_Create(out IntPtr system)` -> FMOD_RESULT
- `FMOD_System_Init(IntPtr system, int maxChannels, int flags, IntPtr driverData)`
- `FMOD_System_CreateSound(IntPtr system, byte[] data, int mode, ref FMOD_CREATESOUNDEXINFO exinfo, out IntPtr sound)`
- `FMOD_Sound_GetFormat(sound, out type, out format, out channels, out bits)`
- `FMOD_Sound_GetLength(sound, out uint length, FMOD_TIMEUNIT_*)` - PCM retorna 0 mas MS retorna correto
- `FMOD_Sound_GetDefaults(sound, out float frequency, out int priority)`
- `FMOD_Sound_GetNumSubSounds(sound, out count)`
- `FMOD_Sound_GetSubSound(sound, int index, out IntPtr subsound)`
- `FMOD_Sound_GetOpenState(sound, out int openstate, out uint percentbufferused, out int starving, out int diskbusy)` — **5 args nao 4!**
- `FMOD_Sound_ReadData(sound, IntPtr buffer, uint lengthBytes, out uint read)` — funciona para compressed samples
- `FMOD_Sound_Lock(sound, uint offset, uint length, out ptr1, out ptr2, out len1, out len2)` — fallback
- `FMOD_Sound_Unlock(sound, ptr1, ptr2, len1, len2)`
- `FMOD_Sound_Release(sound)`
- `FMOD_System_Release(system)`

### Modos
- `FMOD_MODE_CREATESAMPLE = 0x4` - descomprime para PCM16 on load
- `FMOD_MODE_CREATECOMPRESSEDSAMPLE = 0x200` - mantem compressed, decodifica on play
- `FMOD_MODE_OPENMEMORY = 0x800`
- `FMOD_MODE_NONBLOCKING = 0x10`

### FMOD_CREATESOUNDEXINFO (x64)
- Struct com 36+ campos, Pack default (8 bytes)
- `cbsize` deve ser setado via `Marshal.SizeOf<T>()`
- CUIDADO: struct tem IntPtrs de 8 bytes misturados com int/uint de 4

### Ordem correta de chamadas
1. `FMOD_System_Create`
2. `FMOD_System_Init(sys, 32, NORMAL, NULL)`
3. `FMOD_System_CreateSound(sys, bytes, MODE_CREATESAMPLE | MODE_OPENMEMORY | MODE_NONBLOCKING, ref ex, out sound)` — primeiro tenta SAMPLE
4. se falhar, fallback: `MODE_CREATECOMPRESSEDSAMPLE | MODE_OPENMEMORY | MODE_NONBLOCKING`
5. **NAO precisa de openState loop nem update pump** (so funciona se for o EXATO codigo de Fsb5ToWav)
6. `FMOD_Sound_GetNumSubSounds` — FSB5 = 1 subsound
7. `FMOD_Sound_GetSubSound(sound, 0, out subsound)` — pega subsound
8. `FMOD_Sound_GetFormat(subsound, ...)` — ch=1 bits=16 freq=44100
9. `FMOD_Sound_GetLength(subsound, ...)` — PCM retorna 0, MS retorna duracao (4.4s = 4384ms)
10. `FMOD_Sound_GetDefaults(subsound, out freq)` — 44100
11. `FMOD_Sound_ReadData(subsound, buf, totalBytes, out read)` — funciona!
12. `Marshal.Copy(buf, pcm, 0, read)` + WriteWav
13. `FMOD_Sound_Release(sound)` + `FMOD_System_Release(sys)`

### Audio format dos FSB5
- 1 channel (mono), 16-bit, 44100 Hz
- Comprimento varia (alguns ~0.1s, outros 5s+)
- Compressed (provavelmente IMA ADPCM, ~26:1 ratio)

## Ferramentas criadas

| Arquivo | Funcao |
|---|---|
| `DublagemIA\06-fmod\Fsb5ToWav\Program.cs` | Conversor single-file (debug) |
| `DublagemIA\06-fmod\Fsb5Batch\Program.cs` | Conversor batch via lista |
| `%USERPROFILE%\AppData\Local\Temp\kilo\gerar-lista-fsb5.mjs` | Gera lista de FSB5 a converter |

## Falhas
4 FSB5 falharam (todos rc=13 FMOD_ERR_FORMAT ou rc=68 FMOD_ERR_NOTREADY). Provavelmente FSB5s com codec nao suportado (Vorbis?) ou corrompidos.

## Limite vs MafiaToolkit MCP
- MCP: extrai FSB5 raw, NAO decodifica
- fmod64.dll P/Invoke: decodifica para PCM WAV

## Proximos passos
1. F5: TTS PT-BR por personagem, encaixar duracao no WAV original
2. F6: Repack .sds v19 com audio PT-BR
3. F1b: REA sdsconfig.bin para entender `full=false`
