# lote-e-instalar.ps1 - roda o lote de dublagem e, se o jogo estiver fechado, instala o resultado.
# Roda desacoplado (Start-Process), para sobreviver ao fechamento da sessao que o iniciou.
$r = Split-Path $PSScriptRoot
$env:TEMP = "$r\08-repack\_tmp"; $env:TMP = $env:TEMP
$log = "$r\08-repack\lote-saida.txt"
if (@(Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match 'dublar-lote' }).Count) { "[$(Get-Date)] lote ja estava rodando; nada a fazer" | Out-File $log -Append -Encoding utf8; exit }
node "$r\02-ferramentas\dublar-lote.mjs" *>> $log
& powershell -NoProfile -ExecutionPolicy Bypass -File "$r\02-ferramentas\dublar-copias-dlc.ps1" *>> $log   # copias das DLCs
if (@(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -match 'Mafia' }).Count) { "[$(Get-Date)] jogo aberto: instalacao adiada (rode instalar.ps1 depois)" | Out-File $log -Append -Encoding utf8; exit }
& powershell -NoProfile -ExecutionPolicy Bypass -File "$r\08-repack\instalar.ps1" *>> $log
"[$(Get-Date)] lote e instalacao terminados" | Out-File $log -Append -Encoding utf8
