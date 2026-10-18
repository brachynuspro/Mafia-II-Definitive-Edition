# instalar.ps1 - instala a dublagem PT-BR (arquivos .sds de saida\pc) no Mafia II: Definitive Edition, com backup.
# Funciona em qualquer instalacao: procura o jogo nas bibliotecas da Steam, ou use -Jogo "C:\...\Mafia II Definitive Edition".
# uso: powershell -ExecutionPolicy Bypass -File instalar.ps1 [-Jogo <pasta do jogo>]
param([string]$Jogo)
$ErrorActionPreference = 'Stop'

function Achar-Jogo {
  $nome = 'Mafia II Definitive Edition'
  # 1) o pacote esta dentro da pasta do jogo (DublagemIA\08-repack)?
  $p = $PSScriptRoot
  for ($i = 0; $i -lt 4 -and $p; $i++) { if (Test-Path (Join-Path $p 'pc\sds')) { return $p }; $p = Split-Path $p }
  # 2) bibliotecas da Steam
  $steam = (Get-ItemProperty 'HKCU:\Software\Valve\Steam' -ErrorAction SilentlyContinue).SteamPath
  $libs = @()
  if ($steam) {
    $libs += $steam
    $vdf = Join-Path $steam 'steamapps\libraryfolders.vdf'
    if (Test-Path $vdf) { $libs += Select-String -Path $vdf -Pattern '"path"\s+"([^"]+)"' | ForEach-Object { $_.Matches[0].Groups[1].Value -replace '\\\\', '\' } }
  }
  foreach ($l in $libs | Select-Object -Unique) { $c = Join-Path $l "steamapps\common\$nome"; if (Test-Path (Join-Path $c 'pc\sds')) { return $c } }
  return $null
}

if (-not $Jogo) { $Jogo = Achar-Jogo }
if (-not $Jogo -or -not (Test-Path (Join-Path $Jogo 'pc\sds'))) { Write-Host 'Nao encontrei o jogo. Rode de novo com: -Jogo "<pasta do Mafia II Definitive Edition>"'; exit 1 }
$saida  = Join-Path $PSScriptRoot 'saida\pc'
$backup = Join-Path $PSScriptRoot 'backup-original\pc'
Write-Host "Jogo: $Jogo"
$n = 0
Get-ChildItem $saida -Recurse -Filter *.sds | ForEach-Object {
  $rel = $_.FullName.Substring($saida.Length + 1)
  $alvo = Join-Path $Jogo "pc\$rel"
  $bak  = Join-Path $backup $rel
  if (-not (Test-Path $alvo)) { Write-Warning "nao existe no jogo, pulando: $rel"; return }
  if (-not (Test-Path $bak)) { New-Item -ItemType Directory -Force (Split-Path $bak) | Out-Null; Copy-Item $alvo $bak }
  Copy-Item $_.FullName $alvo -Force
  $n++
}
# arquivos com backup que nao estao mais em saida\ -> devolve o original
Get-ChildItem $backup -Recurse -Filter *.sds -ErrorAction SilentlyContinue | ForEach-Object {
  $rel = $_.FullName.Substring($backup.Length + 1)
  if (-not (Test-Path (Join-Path $saida $rel))) { Copy-Item $_.FullName (Join-Path $Jogo "pc\$rel") -Force; Write-Host "original devolvido: $rel" }
}
Write-Host "$n arquivo(s) dublado(s) instalado(s). Originais guardados em $backup"

# idioma: o jogo le <Language> do settings.xml de cada perfil (ignora a Steam); so 'brazilian' carrega o sds_br
$perfis = Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'My Games\Mafia II Definitive Edition\Data\profiles'
$cfgs = @(Get-ChildItem $perfis -Recurse -Filter settings.xml -ErrorAction SilentlyContinue)
if (-not $cfgs.Count) { Write-Warning 'Nenhum perfil do jogo encontrado. Abra o jogo uma vez, feche e rode este instalador de novo para ativar o portugues.' }
foreach ($c in $cfgs) {
  $bak = "$($c.FullName).antes-dublagem"
  $velho = "$($c.FullName).backup-ingles"
  if (-not (Test-Path $bak) -and (Test-Path $velho)) { Move-Item $velho $bak }
  if (-not (Test-Path $bak)) { Copy-Item $c.FullName $bak }
  $txt = [IO.File]::ReadAllText($c.FullName)
  $novo = [regex]::Replace($txt, '<Language>[^<]*</Language>', '<Language>brazilian</Language>')
  if ($novo -ne $txt) { [IO.File]::WriteAllText($c.FullName, $novo, (New-Object Text.UTF8Encoding($false))) }
  Write-Host "idioma do perfil em portugues (Brasil): $($c.Directory.Name)"
}
