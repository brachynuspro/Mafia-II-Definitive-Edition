# verificar-integridade.ps1 - confere, depois de falhas no disco, se os SDS da dublagem estao integros:
#   1) cada SDS de 08-repack\saida e de 08-repack\backup-original abre no SdsTool (cabecalho/indice validos);
#   2) o arquivo instalado no jogo e identico ao da saida.
# Saida: 08-repack\integridade.txt (lista do que falhou).
$ErrorActionPreference = 'Continue'
$r = Split-Path $PSScriptRoot
$pc = 'D:\SteamLibrary\steamapps\common\Mafia II Definitive Edition\pc'
$tool = "$r\08-repack\SdsTool\bin\Release\net8.0-windows\SdsTool.exe"
$rel = "$r\08-repack\integridade.txt"
$falhas = New-Object System.Collections.Generic.List[string]
function Valido($f) {
  $p = Start-Process $tool -ArgumentList 'info', "`"$f`"" -WindowStyle Hidden -PassThru -RedirectStandardOutput "$r\08-repack\_tmp\int.txt"
  if (-not $p.WaitForExit(60000)) { $p.Kill(); return $false }
  return ((Get-Content "$r\08-repack\_tmp\int.txt" -Raw) -match 'versao=19')
}
foreach ($pasta in 'saida', 'backup-original') {
  $base = "$r\08-repack\$pasta\pc"; $n = 0
  foreach ($f in Get-ChildItem $base -Recurse -Filter *.sds) {
    $n++; $relf = $f.FullName.Substring($base.Length + 1)
    if (-not (Valido $f.FullName)) { $falhas.Add("$pasta INVALIDO: $relf") }
    if ($pasta -eq 'saida') {
      $alvo = Join-Path $pc $relf
      if (-not (Test-Path $alvo)) { $falhas.Add("jogo AUSENTE: $relf") }
      elseif ((Get-FileHash $alvo).Hash -ne (Get-FileHash $f.FullName).Hash) { $falhas.Add("jogo DIFERENTE da saida: $relf") }
    }
  }
  "$pasta : $n conferidos" | Out-File $rel -Append -Encoding utf8
}
"FALHAS: $($falhas.Count)" | Out-File $rel -Append -Encoding utf8
$falhas | Out-File $rel -Append -Encoding utf8
"FIM $(Get-Date)" | Out-File $rel -Append -Encoding utf8
