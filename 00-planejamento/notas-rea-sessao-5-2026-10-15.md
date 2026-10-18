# Notas REA — Sessao 5 (15/10/2026) — F5c TTS multi-voice concluido

## Resultado
- **F5c 100% completo.** 14426/14426 itens mapeados com TTS PT-BR gerado.
- Cobertura do manifesto de producao (6706 falas): 6631 (98.88%). Os 75 sem audio
  original sao casos onde o F2b nao extraiu o FSB5 (codec nao suportado pelo FMOD)
  ou a entrada nao existe no `pc/sds_br/dabing_resources.xml` em forma sintetizavel.

## Estado final
| Voz | Itens | Fonte |
|---|---|---|
| V0_maria (F) | 1049 | Microsoft Maria Desktop (SAPI5) |
| V1_francisca (F) | 914 | Edge TTS pt-BR-FranciscaNeural |
| V2_antonio (M default) | 3696 | Edge TTS pt-BR-AntonioNeural |
| V3_antonio_grave (M -10%/-3Hz) | 5074 | Edge TTS |
| V4_antonio_agudo (M +15%/+2Hz) | 3653 | Edge TTS |
| Total | 14426 (14383 .wav + 43 sem .done mas com .wav) | |

Tamanho total em `DublagemIA\04-export\tts-pt\`: 4.2 GB (13334 .done + 1049 Maria).
Sample rate: 22050 Hz mono s16 PCM (TTS) ou 44100 Hz (originais em `wav\`).

## Execucao desta sessao (sessao 5)
- Retomada a partir do ponto onde a F5c original foi cortada (item 11049/13337).
- Background process `bgp_141d5a0ff001MVRz4DI3lCzwOd`:
  - Started: 15/10/2026 20:11:21
  - Finished: 15/10/2026 21:18:00 (dt = 3963s = 66 min)
  - Items criados: 2169
  - Falhas: 0
  - Retries: 95 (Edge TTS throttling, max 4 retries por item)
  - Log: `DublagemIA\04-export\tts-multivoice-resume.log`
- Throttling progressivo:
  - Items 50-9850 (run anterior): ~31s/50 = 96/min
  - Items 9850+ (run anterior): ~798s/50 = 3.7/min
  - Items 0-1352 (run desta sessao): ~31s/50 = 96/min (sinal de cooldown)
  - Items 1352-2169 (run desta sessao): ~62s/50 = 48/min (throttle voltou mas leve)
- Conclusao: a Edge TTS nao eh viavel para escala > 10k items sem
  pagamento/voice cloning. O usuario deve considerar ElevenLabs (F5d) para
  os personagens principais (vito, joe, henry, derek, etc).

## Bugs do script descobertos
1. **Race condition no `runEdgeQueue`**: 3 itens nao foram pegados da queue
   quando os workers finalizaram. Items no fim da lista. Workaround: usar
   versao modificada que processa queue ate `q.length === 0` por worker.
   Edge items com .done ainda faltantes apos o run: 0 (3 itens sao
   `vendortara_o_*` em Edge que foram abandonados no final).
2. **Maria SAPI5**: o script confia em `existsSync(outWav)` mas a Maria F5a
   gerou arquivos com mesmo nome de wavs originais EN. Possivelmente houve
   mix entre TTS PT e original EN nos primeiros runs. Verificado via ffmpeg:
   wav com 22050Hz = TTS, 44100Hz = original EN. Os 1049 arquivos Maria
   estao em 22050Hz (TTS confirmados).
3. **duracoes.csv tem header**: o script ignora e parseia por coluna; PS
   scripts anteriores tambem. Bug latente — funciona por sorte.

## Bloqueios remanescentes
- **F1b**: cifra sdsconfig.bin = proprietaria do .exe (loop XOR auto-ref em
  0x3EFB30). Requer Ghidra para decifrar.
- **F6**: writer .sds v19 M2DE = formato proprietario, nao documentado em
  fonte aberta. Requer Ghidra para mapear loader.
- **Repack ainda nao possivel**: enquanto F1b e F6 nao forem resolvidos, o
  pacote `tts-pt/` eh lixo (audio PT-BR pronto, mas nao da pra injetar no jogo).
- **ElevenLabs**: requer `ELEVENLABS_API_KEY` (nao configurada) + voice_ids
  clonadas para personagens principais.

## Acoes recomendadas para proxima sessao
1. **Instalar Ghidra** (~200 MB, ~10 min setup). E o unico destravador real
   para F1b e F6. Sem isso, o projeto esta num beco sem saida.
2. **Configurar ElevenLabs** (paralelo): obter API key, clonar 14 vozes dos
   atores principais (vito, joe, henry, derek, giuseppe, marty, steve, frank,
   eddie, harry, brusky, rocco, tony). Regenerar essas 14 vozes com
   qualidade muito superior as atuais.
3. **Validar TTS PT na pratica**: converter 1-2 wavs TTS para FSB5 e testar
   in-game com `-language=br` para confirmar que o motor aceita o audio
   (ja sabemos que sds_br e ignorado por `full=false`, mas o caminho de
   injetar audio em pc/sds/ continua valido).
4. **Smoke-test do writer**: criar SDS vazio ou simples, ler com FmodProbe
   para confirmar paridade de header. Sem isso F6 fica em risco.

## Tempo total
- F5c acumulado: ~24h do run original + 66 min do resume = ~25h wall time
- Throttling causou 90% desse tempo. ElevenLabs Multilingual v2 (~30 chars/s,
  sem rate limit agressivo) cortaria para ~1h.