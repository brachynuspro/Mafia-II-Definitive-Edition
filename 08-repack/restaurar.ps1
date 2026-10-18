# restaurar.ps1 - devolve os .sds originais guardados por instalar.ps1.
# uso: powershell -ExecutionPolicy Bypass -File restaurar.ps1 [-Jogo <pasta do jogo>]
param([string]$Jogo)
$ErrorActionPreference = 'Stop'
if (-not $Jogo) {
  $p = $PSScriptRoot
  for ($i = 0; $i -lt 4 -and $p; $i++) { if (Test-Path (Join-Path $p 'pc\sds')) { $Jogo = $p; break }; $p = Split-Path $p }
}
if (-not $Jogo) {
  $steam = (Get-ItemProperty 'HKCU:\Software\Valve\Steam' -ErrorAction SilentlyContinue).SteamPath
  $libs = @($steam)
  $vdf = Join-Path $steam 'steamapps\libraryfolders.vdf'
  if (Test-Path $vdf) { $libs += Select-String -Path $vdf -Pattern '"path"\s+"([^"]+)"' | ForEach-Object { $_.Matches[0].Groups[1].Value -replace '\\\\', '\' } }
  foreach ($l in $libs) { $c = Join-Path $l 'steamapps\common\Mafia II Definitive Edition'; if (Test-Path (Join-Path $c 'pc\sds')) { $Jogo = $c; break } }
}
if (-not $Jogo) { Write-Host 'Nao encontrei o jogo. Use -Jogo "<pasta do jogo>"'; exit 1 }
$backup = Join-Path $PSScriptRoot 'backup-original\pc'
if (-not (Test-Path $backup)) { Write-Host 'nenhum backup encontrado (ou use "Verificar integridade dos arquivos" na Steam)'; exit 0 }
$n = 0
Get-ChildItem $backup -Recurse -Filter *.sds | ForEach-Object {
  $rel = $_.FullName.Substring($backup.Length + 1)
  Copy-Item $_.FullName (Join-Path $Jogo "pc\$rel") -Force; $n++
}
Write-Host "$n arquivo(s) original(is) restaurado(s) em $Jogo"

# devolve o settings.xml de cada perfil como estava antes da instalacao (idioma original)
$perfis = Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'My Games\Mafia II Definitive Edition\Data\profiles'
Get-ChildItem $perfis -Recurse -Filter settings.xml.antes-dublagem -ErrorAction SilentlyContinue | ForEach-Object {
  $alvo = $_.FullName -replace '\.antes-dublagem$', ''
  Copy-Item $_.FullName $alvo -Force; Remove-Item $_.FullName
  Write-Host "idioma original devolvido: $($_.Directory.Name)"
}
