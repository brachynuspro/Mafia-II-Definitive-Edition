# Instalador da Dublagem PT-BR - Mafia II: Definitive Edition (Windows)
# Chamado por instalar-windows.bat. Pergunta a pasta do jogo, faz backup dos originais e copia a dublagem.
$ErrorActionPreference = 'Stop'
$pacote = Split-Path $PSScriptRoot
$origem = Join-Path $pacote 'dublagem\pc'
$NOME = 'Mafia II Definitive Edition'

function Achar-Jogo {
  $steam = (Get-ItemProperty 'HKCU:\Software\Valve\Steam' -ErrorAction SilentlyContinue).SteamPath
  $libs = @()
  if ($steam) {
    $libs += $steam
    $vdf = Join-Path $steam 'steamapps\libraryfolders.vdf'
    if (Test-Path $vdf) { $libs += Select-String -Path $vdf -Pattern '"path"\s+"([^"]+)"' | ForEach-Object { $_.Matches[0].Groups[1].Value -replace '\\\\', '\' } }
  }
  foreach ($l in $libs | Select-Object -Unique) { $c = Join-Path $l "steamapps\common\$NOME"; if (Test-Path (Join-Path $c 'pc\sds')) { return $c } }
  return $null
}
function Perfis { @(Get-ChildItem (Join-Path ([Environment]::GetFolderPath('MyDocuments')) "My Games\$NOME\Data\profiles") -Recurse -Filter settings.xml -ErrorAction SilentlyContinue) }
# Instalacao limpa nao tem 'info' em pc\sds. Outra traducao as vezes copia para la o 'info' do pt-BR:
# o jogo le o 'info' de todas as pastas pc\sds* e passa a achar que o portugues esta na pasta de ingles.
function Limpar-PastaIngles {
  $info = Join-Path $jogo 'pc\sds\info'
  if (-not (Test-Path $info)) { return }
  $txt = [IO.File]::ReadAllText($info)
  if ($txt -match '<id>English</id>') { return }
  $dest = Join-Path $jogo 'DublagemPTBR-backup\removidos-de-pc-sds'
  New-Item -ItemType Directory -Force $dest | Out-Null
  $n = 0
  foreach ($f in 'info', 'dabing_resources.xml', 'sds_list.txt') {
    $p = Join-Path $jogo "pc\sds\$f"
    if (Test-Path $p) { Move-Item $p (Join-Path $dest $f) -Force; $n++ }
  }
  Write-Host "  Havia um 'info' de outro idioma em pc\sds (resto de outra traducao), que fazia o jogo carregar o ingles." -ForegroundColor Yellow
  Write-Host "  $n arquivo(s) guardado(s) em: $dest"
}
function Ativar-Portugues {
  Limpar-PastaIngles
  $cfgs = Perfis
  if (-not $cfgs.Count) { Write-Host "  Nenhum perfil do jogo encontrado. Abra o jogo uma vez, feche, e rode o instalador de novo (opcao 3)." -ForegroundColor Yellow; return }
  foreach ($c in $cfgs) {
    $bak = "$($c.FullName).antes-dublagem"
    if (-not (Test-Path $bak)) { Copy-Item $c.FullName $bak }
    $txt = [IO.File]::ReadAllText($c.FullName)
    $novo = [regex]::Replace($txt, '<Language>[^<]*</Language>', '<Language>brazilian</Language>')
    if ($novo -ne $txt) { [IO.File]::WriteAllText($c.FullName, $novo, (New-Object Text.UTF8Encoding($false))) }
    Write-Host "  Idioma do perfil $($c.Directory.Name): portugues (Brasil)"
  }
}

Write-Host ''
Write-Host '=============================================================' -ForegroundColor Cyan
Write-Host '   Dublagem PT-BR  -  Mafia II: Definitive Edition'            -ForegroundColor Cyan
Write-Host '=============================================================' -ForegroundColor Cyan
Write-Host ''
if (-not (Test-Path $origem)) { Write-Host "Pasta 'dublagem' nao encontrada ao lado do instalador. Extraia o pacote inteiro." -ForegroundColor Red; exit 1 }

# 1) pasta do jogo
$sug = Achar-Jogo
while ($true) {
  if ($sug) { Write-Host "Pasta do jogo encontrada: $sug"; $resp = Read-Host 'Pressione ENTER para usar essa pasta, ou digite/arraste outra' }
  else { $resp = Read-Host "Digite (ou arraste aqui) a pasta de instalacao do jogo, ex.: C:\Program Files (x86)\Steam\steamapps\common\$NOME" }
  $jogo = if ([string]::IsNullOrWhiteSpace($resp)) { $sug } else { $resp.Trim().Trim('"').Trim("'").TrimEnd('\') }
  if ($jogo -and (Split-Path $jogo -Leaf) -eq 'pc') { $jogo = Split-Path $jogo }
  if ($jogo -and (Test-Path (Join-Path $jogo 'pc\sds'))) { break }
  Write-Host "  Essa pasta nao parece ser a do jogo (falta 'pc\sds'). Tente de novo." -ForegroundColor Yellow
  $sug = $null
}
$backup = Join-Path $jogo 'DublagemPTBR-backup\pc'

# 2) acao
Write-Host ''
Write-Host '  1) Instalar a dublagem'
Write-Host '  2) Remover a dublagem (restaurar os arquivos originais)'
Write-Host '  3) Apenas ativar o idioma portugues no jogo'
$op = Read-Host 'Escolha (1/2/3)'
if (Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -match 'Mafia' }) { Write-Host 'Feche o jogo antes de continuar.' -ForegroundColor Red; exit 1 }

switch ($op) {
  '1' {
    $arqs = @(Get-ChildItem $origem -Recurse -Filter *.sds); $n = 0; $pulados = 0
    foreach ($a in $arqs) {
      $rel = $a.FullName.Substring($origem.Length + 1)
      $alvo = Join-Path $jogo "pc\$rel"; $bak = Join-Path $backup $rel
      Write-Progress -Activity 'Instalando a dublagem' -Status $rel -PercentComplete (100 * $n / $arqs.Count)
      if (-not (Test-Path $alvo)) { $pulados++; continue }
      if (-not (Test-Path $bak)) { New-Item -ItemType Directory -Force (Split-Path $bak) | Out-Null; Copy-Item $alvo $bak }
      Copy-Item $a.FullName $alvo -Force; $n++
    }
    Write-Progress -Activity 'Instalando a dublagem' -Completed
    Write-Host ''
    Write-Host "  $n arquivo(s) instalado(s). Originais guardados em: $backup" -ForegroundColor Green
    if ($pulados) { Write-Host "  $pulados arquivo(s) nao existem nesta versao do jogo e foram ignorados." -ForegroundColor Yellow }
    Ativar-Portugues
    Write-Host ''; Write-Host 'Pronto! Abra o jogo e bom divertimento.' -ForegroundColor Green
  }
  '2' {
    $rem = Join-Path $jogo 'DublagemPTBR-backup\removidos-de-pc-sds'
    if (Test-Path $rem) {   # devolve o que a instalacao tirou de pc\sds (estado exato de antes)
      Get-ChildItem $rem -File | ForEach-Object { Move-Item $_.FullName (Join-Path $jogo "pc\sds\$($_.Name)") -Force }
      Remove-Item $rem -Recurse -Force
      Write-Host "  Arquivos de outra traducao devolvidos para pc\sds." -ForegroundColor Yellow
    }
    if (-not (Test-Path $backup)) { Write-Host '  Nenhum backup encontrado. Use "Verificar integridade dos arquivos" na Steam.' -ForegroundColor Yellow }
    else {
      $n = 0
      foreach ($b in Get-ChildItem $backup -Recurse -Filter *.sds) { Copy-Item $b.FullName (Join-Path $jogo "pc\$($b.FullName.Substring($backup.Length + 1))") -Force; $n++ }
      Remove-Item (Split-Path $backup) -Recurse -Force
      Write-Host "  $n arquivo(s) original(is) restaurado(s)." -ForegroundColor Green
    }
    foreach ($b in Get-ChildItem (Join-Path ([Environment]::GetFolderPath('MyDocuments')) "My Games\$NOME\Data\profiles") -Recurse -Filter settings.xml.antes-dublagem -ErrorAction SilentlyContinue) {
      Copy-Item $b.FullName ($b.FullName -replace '\.antes-dublagem$', '') -Force; Remove-Item $b.FullName
      Write-Host "  Idioma original restaurado no perfil $($b.Directory.Name)."
    }
  }
  '3' { Ativar-Portugues }
  default { Write-Host 'Opcao invalida.' -ForegroundColor Red }
}
