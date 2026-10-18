# empacotar.ps1 - guarda a dublagem FORA da pasta do jogo (desinstalar pela Steam apaga a pasta do jogo inteira).
#   <Destino>\instalar.ps1, restaurar.ps1, LEIA-ME.txt, saida\pc\...   -> pacote pronto para qualquer instalacao
#   <Destino>\projeto\                                                -> (opcional, -Projeto) roteiros, traducoes,
#                                                                         ferramentas e configs, sem arquivos regeneraveis
# Incremental (robocopy): rodar de novo so copia o que mudou.
# uso: powershell -ExecutionPolicy Bypass -File empacotar.ps1 [-Destino D:\Mafia2-Dublagem-PTBR] [-Projeto] [-Zip]
param([string]$Destino = 'D:\Mafia2-Dublagem-PTBR', [switch]$Projeto, [switch]$Zip)
$ErrorActionPreference = 'Stop'
$aqui = $PSScriptRoot
$dub  = Split-Path $aqui
New-Item -ItemType Directory -Force $Destino | Out-Null

robocopy (Join-Path $aqui 'saida') (Join-Path $Destino 'saida') *.sds /MIR /NFL /NDL /NJH /NP | Out-Null
Copy-Item (Join-Path $aqui 'instalar.ps1'), (Join-Path $aqui 'restaurar.ps1') $Destino -Force
@"
DUBLAGEM PT-BR (IA) - MAFIA II: DEFINITIVE EDITION
==================================================
Instalar:   clique com o botao direito em instalar.ps1 > Executar com o PowerShell
            (ou: powershell -ExecutionPolicy Bypass -File instalar.ps1)
            O jogo e encontrado sozinho nas bibliotecas da Steam. Se nao achar:
            powershell -ExecutionPolicy Bypass -File instalar.ps1 -Jogo "D:\...\Mafia II Definitive Edition"
Desfazer:   restaurar.ps1  (ou Steam > Propriedades > Arquivos instalados > Verificar integridade)
Jogar:      idioma do jogo em Portugues (Brasil). As legendas continuam as oficiais.
Atualizacao da Steam ou verificacao de integridade desfaz a dublagem: basta rodar instalar.ps1 de novo.
Uso pessoal. Audio gerado por TTS a partir das legendas oficiais e de traducao por IA.
"@ | Out-File (Join-Path $Destino 'LEIA-ME.txt') -Encoding utf8

if ($Projeto) {
  $excluir = @('wav', 'wav-fsb5', 'batch-extraidos', 'apdcivblack_a1', 'embeddings', '_trabalho', '_tmp', '_nuget', '_tools',
               '_decomp', '_inspect', '_pylib', '_pylib_ort', '_modelos', 'modelos', 'node_modules', 'saida', 'backup-original',
               'bin', 'obj', 'tts-pt', 'tts-pt-stretched', '_descartado', '_cache-tts')
  robocopy $dub (Join-Path $Destino 'projeto') /MIR /XD $excluir /XF *.sds *.fsb *.fsb5 *.bik *.zip *.npy /NFL /NDL /NJH /NP | Out-Null
}
if ($Zip) {
  $z = "$Destino.zip"; if (Test-Path $z) { Remove-Item $z }
  Compress-Archive -Path (Join-Path $Destino '*') -DestinationPath $z -CompressionLevel Fastest
  Write-Host "zip: $z"
}
$gb = (Get-ChildItem $Destino -Recurse -File | Measure-Object Length -Sum).Sum / 1GB
Write-Host ("Pacote em {0} ({1:N2} GB, {2} arquivos .sds)" -f $Destino, $gb, (Get-ChildItem (Join-Path $Destino 'saida') -Recurse -Filter *.sds).Count)
