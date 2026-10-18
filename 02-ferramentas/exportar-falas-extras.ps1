# exportar-falas-extras.ps1 - acha falas (recursos Dabing) em SDS do jogo que ficaram fora do voice-map,
# exporta o audio EN para 04-export\wav e acrescenta as falas ao 04-export\voice-map.csv.
# uso: powershell -File exportar-falas-extras.ps1 [-Pastas speech,script_sounds,fmv] [-Raiz <pc ou pc\dlcs\<dlc>>]
param([string]$Pastas = 'speech,speech_shops,script_sounds,fmv', [string]$Raiz)
$listaPastas = @($Pastas -split '[,\s]+' | Where-Object { $_ })   # $Pastas e [string]: guardar a lista nele a juntaria de volta
$ErrorActionPreference = 'Continue'   # stderr de exe nativo (Fsb5ToWav) nao pode abortar o script no PS 5.1
$r = Split-Path $PSScriptRoot
$jogo = if ($Raiz) { $Raiz } else { 'D:\SteamLibrary\steamapps\common\Mafia II Definitive Edition\pc' }
$tool = "$r\08-repack\SdsTool\bin\Release\net8.0-windows\SdsTool.exe"
$cv = "$r\06-fmod\Fsb5ToWav\bin\Release\net8.0\Fsb5ToWav.exe"
$wavDir = "$r\04-export\wav"; $vm = "$r\04-export\voice-map.csv"
$tmp = "$r\08-repack\_tmp\extras"
$noMapa = @{}; foreach ($l in Get-Content $vm | Select-Object -Skip 1) { $noMapa[($l -split '_Dabing_')[0]] = 1 }

# sds_br primeiro: quando o SDS existe nos dois pacotes, o jogo em PT usa o do sds_br
$cand = @{}
foreach ($pk in 'sds_br', 'sds') { foreach ($p in $listaPastas) {
  Get-ChildItem "$jogo\$pk\$p" -Filter *.sds -ErrorAction SilentlyContinue | ForEach-Object { if (-not $noMapa[$_.BaseName] -and -not $cand[$_.BaseName]) { $cand[$_.BaseName] = $_.FullName } }
} }
"candidatos: $($cand.Count)"
$novas = New-Object System.Collections.Generic.List[string]; $sdsCom = 0
foreach ($k in $cand.Keys | Sort-Object) {
  $d = "$tmp\$k"; if (Test-Path $d) { Remove-Item $d -Recurse -Force }
  if ((Get-Item $cand[$k]).Length -lt 8KB) { continue }       # SDS vazio (so cabecalho): o SdsTool trava neles
  $p = Start-Process $tool -ArgumentList 'unpack', "`"$($cand[$k])`"", "`"$d`"" -WindowStyle Hidden -PassThru
  if (-not $p.WaitForExit(120000)) { $p.Kill(); "  $k : TRAVOU no unpack, pulado"; continue }
  $base = "$d\extracted\$k.sds"
  $fsbs = @(Get-ChildItem "$base\Dabing" -Recurse -Filter *.fsb -ErrorAction SilentlyContinue)
  if ($fsbs.Count) {
    $sdsCom++
    foreach ($f in $fsbs) {
      $rel = $f.FullName.Substring($base.Length + 1) -replace '\.fsb$', ''          # Dabing\Cutscenes\1401\14_01_00_0010
      $wav = "${k}_" + ($rel -replace '\\', '_') + '.wav'
      if (-not (Test-Path "$wavDir\$wav")) { & $cv $f.FullName "$wavDir\$wav" *> $null }
      $nome = $rel -replace '\\', '/'
      $novas.Add(('{0},"{1}","{2}",M,,,,V2_antonio' -f $wav, $nome, ($nome -replace '^Dabing/[^/]+/', '')))
    }
    "  $k : $($fsbs.Count) falas"
  }
  Remove-Item $d -Recurse -Force
}
if ($novas.Count) { Add-Content $vm $novas -Encoding UTF8 }
"FIM: $sdsCom SDS com falas, $($novas.Count) falas acrescentadas ao voice-map"
