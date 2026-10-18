# Notas REA — Sessao 4 (15/10/2026) — F1b cifra sdsconfig + F6 writer

## Resultado critico
- **F1b cifra sdsconfig.bin** = **cifra proprietária do .exe**, NAO a do Gibbed.Illusion. Loop XOR byte-a-byte com auto-referência visto em 0x3EFB30 (sem key externa). A cifra Gibbed TEA usa sum=0xC6EF3720 padrao; a do .exe usa sum=0x79FB0B01 ou 0xA62336C0 com rounds=5/32 — TENTEI sem sucesso.
- **F6 writer** = **formato Mafia II DE e proprietario**, diferente do Gibbed.Illusion (M2 classico). Gibbed falha em ler apdcivblack_a1.sds (offset 0x18 nao bate com BlockTableOffset esperado).
- Ambos os blockers so destravam com **Ghidra/IDA no `Mafia II Definitive Edition.exe`**.

## Descobertas desta sessao

### 1. Recuperei codigo-fonte do Gibbed.Illusion (zlib license)
- Repo: https://github.com/gibbed/Gibbed.Illusion
- Arquivos chave:
  - `ArchiveEncryption.cs` (4.5 KB) - cifra TEA custom para SDS archive
  - `ArchiveFile.cs` (10.8 KB) - reader/writer do formato classico
  - `BlockReaderStream.cs` (14 KB) - leitor de blocos zlib
  - `BlockWriterStream.cs` (7.6 KB) - escritor de blocos zlib
  - `TEA.cs` (2.1 KB) - TEA parametrizado (sum/delta/rounds)
  - `SdsConfigFile.cs` (4.4 KB) - parser do sdsconfig.bin (M2 classico, usa NOT byte na string table)
  - `Archive/FileHeader.cs`, `ResourceType.cs`, `ResourceHeader.cs`, `ResourceEntry.cs`
  - `Hashing/FNV32.cs`, `FNV64.cs`

### 2. Cifra TEA do Gibbed (NAO funciona em M2DE)
```
Key: [0x73766E46, 0x6D454D5A, 0x336A6D68, 0x38425072]
Settings:
  - sum=0x79FB0B01, delta=0x4B989BCD, rounds=5
  - sum=0xA62336C0, delta=0x9D3119B6, rounds=32
Valida: offset 0x90 deve ser 'tables/fsfh.bin' (FNV64=0x39DD22E69C74EC6F)
        offset 0x10000 e' header encriptado
Aplicado em: sdsconfig.bin (1618 B) -> NAO decifrou (arquivo <0x10000, sdsconfig usa formato diferente)
```

### 3. Cifra do sdsconfig.bin (M2DE)
- Magic: 'psds' (0x73647370) LE
- Version: 2
- Estrutura: 12 B header + 660 B cifrados (auto-referentes) + 950 B plain (tabela de indices)
- Loop de decifracao em 0x3EFA40 do .exe:
  - `cmp dword ptr [r13+0], 0x73647370` ('psds')
  - `cmp dword ptr [r13+4], 0x2` (n_sec=2)
  - Loop XOR byte-a-byte com auto-referencia: `xor dl, [rcx+rdi]; dec rdi; loop`
- **Nenhuma das cifras testadas (TEA Gibbed, XTEA, XOR, ADD, RC4) funcionou** porque a cifra real usa um esquema proprietario com key provavelmente gerada em runtime.

### 4. Formato SDS Mafia II DE e diferente do Gibbed
Layout DE (confirmado por inspecacao de `apdcivblack_a1.sds` 328765 B):
```
0x00-0x03: 'SDS\0' magic
0x04-0x07: 19 (version LE)
0x08-0x0B: 'PC\0\0' (platform BE = 0x50430000)
0x0C-0x0F: 0x5FFB74F3 (secondary magic v19 PC - FIXO)
0x10-0x13: 72 (n_slots LE)
0x14-0x17: 114 (strTblSize LE)
0x18-0x1B: 0x4F04F (dataOff = offset do XML trailer LE)
0x1C-0x1F: 0x268 (recOff LE) - mas primeiro record real esta em 0xA0
0x20-0x3B: 28 B reservados
0x3C..0x9F: string table (100 B = 0x3C ate 0x9F)
0xA0..0x1382: record 0 (32 B header + 4834 B zlib comp -> 16384 B decompress)
0x1382..0x13A7: gap 32 B (= 32 B de header do proximo record?)
0x13A7..0x334D: record 1 (32 B header + 8102 B zlib comp -> 16384 B decompress)
0x334E..0x4F04E: metadata/indices
0x4F04F..end: XML trailer (<?xml version="1.0"?><xml><ResourceInfo>...)
```

Notas sobre o payload:
- 17 zlib magic positions encontradas, mas so 2 sao streams validos.
- O payload dos 2 records (16384 B cada) e metadata de FaceAnim (FxAnalysisFonix, OC3 Entertainment).
- O audio FSB5 NAO esta visivel em busca simples - vem de decifragem/decodificacao interna do loader do .exe.

### 5. MafiaToolkit usa Gibbed para cifrados, outro path para plain
IL linha 457920-457928 mostra:
```il
call MemoryStream ArchiveEncryption::Unwrap(Stream)
  se retornar null (arquivo nao cifrado Gibbed), usa FileStream direto
callvirt void ArchiveFile::Deserialize(Stream)
```

O MafiaToolkit 2.36 deve ter adicionado suporte a M2DE em formato proprio. Codigo nao disponivel publicamente.

### 6. ildasm2 .NET 8 funciona com `DOTNET_ROLL_FORWARD=Major`
Path: `%USERPROFILE%\.dotnet\tools\ildasm.exe`
Versao: 0.12.4
Exige: env var `DOTNET_ROLL_FORWARD=Major` (assembly target .NET 7, runtime so tem 8.0)
Desassemblou MafiaToolkit.dll (3.9 MB, .NET 8) em 31 MB de IL (MafiaToolkit.il).

## Ferramentas criadas nesta sessao

| Arquivo | Funcao | Status |
|---|---|---|
| `DublagemIA\02-ferramentas\decifrar-psds-3.mjs` | TEA Gibbed em sdsconfig.bin | funciona para M2 classico; NAO para M2DE |
| `DublagemIA\02-ferramentas\decifrar-psds-4.mjs` | brute-force TEA Gibbed em varios offsets | nenhum hit em M2DE |
| `DublagemIA\02-ferramentas\sds-archive.mjs` | Port Node do Gibbed.ArchiveFile | funciona para M2 classico, le 0 records em M2DE |
| `DublagemIA\02-ferramentas\sds-de.mjs` | Leitor simples do formato M2DE | le header + records zlib, mas sem interpretacao dos 32 B de header |
| `%USERPROFILE%\AppData\Local\Temp\kilo\MafiaToolkit.il` | 31 MB IL disassembly do MafiaToolkit.dll | preservado para referencia |

## Bloqueios reais (requerem Ghidra/IDA no `.exe`)

1. **Cifra sdsconfig.bin** = proprietaria do .exe (loop XOR com auto-ref em 0x3EFB30).
   - Para decifrar, precisa disassemblar funcao 0x3EFA40 completa.
2. **Formato SDS DE** = proprietario, nao documentado em fonte aberta.
   - Para escrever SDS, precisa disassemblar o loader (0x3E9874, 0x3E9A04, 0x3F89B9, 0x3F8A0B, 0x3F8AE2 - 5 chamadores de 0x3EFA40).
3. **Source do Mafia II DE** = nao publico (2K/3D Realms proprietario).
4. **MafiaToolkit source** = nao publicado (apenas binarios em https://github.com/mafia-toolkit/mafia-toolkit).

## Recomendacao para proxima sessao

1. **Instalar Ghidra** (~200 MB) de https://ghidra-sre.org/
2. Criar projeto: import `Mafia II Definitive Edition.exe` (37 MB)
3. Analisar funcoes em 0x3EFA40, 0x3E9874-0x3F8AE2 (loop de leitura de sdsconfig + carregamento de SDS)
4. Compreender:
   - Algoritmo de decifragem do sdsconfig.bin
   - Layout exato do record do Sound sector (32 B de header entre zlib blocks)
   - Onde o audio FSB5 e' gerado a partir do record decodificado
5. Apos entendimento: completar `sds-archive.mjs` para M2DE e `decifrar-sdsconfig.mjs`

Tempo estimado: 1-2 sessoes de REA pesada.

## Alternativa: abordagem de patch no `.exe`
Se Ghidra nao for viavel, alternativa mais simples:
- Patchar a funcao que checa `full` em `dabing_resources.xml` para forcar `full=true`
- Isso deveria fazer o motor carregar audio do `sds_br` (ou cair em crash se nao houver audio)
- Risco: corromper install. Backup obrigatorio.
- Como patchar: localizar a string 'full' no .exe (offset 0x18525B0 segundo notas REA), seguir xref, substituir o byte que indica `full=false` por `full=true`.
- Tambem precisa resolver o problema de o `sds_br` nao ter audio real (so metadata).
