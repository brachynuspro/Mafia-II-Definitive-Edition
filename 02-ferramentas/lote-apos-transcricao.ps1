# lote-apos-transcricao.ps1 - espera a transcricao (Whisper) terminar, regenera os roteiros e roda o lote de dublagem.
# Roda desacoplado (Start-Process), para sobreviver ao fechamento da sessao que o iniciou.
$r = Split-Path $PSScriptRoot
$env:TEMP = "$r\08-repack\_tmp"; $env:TMP = $env:TEMP
$log = "$r\08-repack\lote-saida.txt"
function Rodando($padrao, $nome) { @(Get-CimInstance Win32_Process -Filter "Name='$nome'" | Where-Object { $_.CommandLine -match $padrao }).Count -gt 0 }
"[$(Get-Date)] aguardando a transcricao terminar" | Out-File $log -Append -Encoding utf8
while (Rodando 'transcrever-audios' 'python.exe') { Start-Sleep 120 }
if (Rodando 'dublar-lote' 'node.exe') { "[$(Get-Date)] lote ja estava rodando; nada a fazer" | Out-File $log -Append -Encoding utf8; exit }
node "$r\02-ferramentas\gerar-roteiros.mjs" *>> $log
node "$r\02-ferramentas\dublar-lote.mjs" *>> $log
"[$(Get-Date)] lote terminou" | Out-File $log -Append -Encoding utf8
