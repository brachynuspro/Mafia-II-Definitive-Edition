# dublar-copias-dlc.ps1 - dubla as copias que as DLCs de historia tem de SDS que tambem existem no jogo base
# (ex.: dlc_joe_ja, vendormalt). Ao jogar a DLC, o jogo le pc\dlcs\<dlc>\sds_br\...; algumas copias sao
# diferentes da do jogo base, entao cada uma e dublada a partir dela mesma, com o roteiro do mesmo nome.
# Saida: 08-repack\saida\pc\dlcs\<dlc>\sds_br\... (os instaladores copiam pelo caminho relativo).
$ErrorActionPreference = 'Continue'
$r = Split-Path $PSScriptRoot
$pc = 'D:\SteamLibrary\steamapps\common\Mafia II Definitive Edition\pc'
$rot = "$r\03-legendas\roteiros"; $saida = "$r\08-repack\saida\pc"
$log = "$r\08-repack\dublar-lote.log"
$env:TEMP = "$r\08-repack\_tmp"; $env:TMP = $env:TEMP
# caminho que o lote ja dubla para cada SDS (coluna caminho da _lista): nao repetir
$doLote = @{}; foreach ($l in Get-Content "$rot\_lista.csv" | Select-Object -Skip 1) { $c = $l.Split(';'); if ($c[1]) { $doLote[$c[1].ToLower()] = 1 } }
$ok = 0; $pulados = 0; $erros = 0
foreach ($dlc in 'cnt_joes_adventures', 'cnt_jimmys_vendetta', 'cnt_betrayal_of_jimmy') {
  foreach ($f in Get-ChildItem "$pc\dlcs\$dlc\sds_br" -Recurse -Filter *.sds -ErrorAction SilentlyContinue) {
    if ($f.Directory.Name -eq 'gui' -or $f.Length -lt 8KB) { continue }
    $roteiro = "$rot\$($f.BaseName).csv"
    if (-not (Test-Path $roteiro) -or $doLote[$f.FullName.ToLower()]) { continue }
    $out = Join-Path $saida $f.FullName.Substring($pc.Length + 1)
    if ((Test-Path $out) -and (Get-Item $out).LastWriteTime -gt (Get-Item $roteiro).LastWriteTime) { $pulados++; continue }
    $t0 = Get-Date
    $res = & node "$r\02-ferramentas\dublar-sds.mjs" $f.FullName $roteiro 2>&1 | Out-String
    $rel = $f.FullName.Substring($pc.Length + 1)
    if ($LASTEXITCODE -eq 0) { $ok++; "[$((Get-Date).ToString('o'))] [dlc] OK $rel ($([int]((Get-Date) - $t0).TotalSeconds)s)" | Out-File $log -Append -Encoding utf8 }
    else { $erros++; "[$((Get-Date).ToString('o'))] [dlc] ERRO $rel : $($res.Trim().Split("`n")[-1])" | Out-File $log -Append -Encoding utf8 }
  }
}
"[$((Get-Date).ToString('o'))] [dlc] FIM ok=$ok pulados=$pulados erros=$erros" | Out-File $log -Append -Encoding utf8
"FIM ok=$ok pulados=$pulados erros=$erros"
