# 打包前准备「随软件分发」的依赖到 src-tauri/resources/bin
# 在有网络/本机已装 FFmpeg、Tesseract 的机器上执行一次即可。
# 这些大文件默认不进 Git，安装包会带上它们。

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$bin = Join-Path $root 'src-tauri\resources\bin'
New-Item -ItemType Directory -Force -Path "$bin\tesseract\tessdata","$bin\ffmpeg" | Out-Null

# --- Tesseract ---
$tessSrc = @(
  'C:\Program Files\Tesseract-OCR',
  "$env:LOCALAPPDATA\Programs\Tesseract-OCR"
) | Where-Object { Test-Path (Join-Path $_ 'tesseract.exe') } | Select-Object -First 1

if ($tessSrc) {
  Write-Host "Copying Tesseract from $tessSrc"
  Get-ChildItem $tessSrc -File | Where-Object { $_.Extension -in '.exe','.dll' } |
    Where-Object { $_.BaseName -notin @('cntraining','lstmeval','lstmtraining','merge_unicharsets','mftraining','set_unicharset_properties','shapeclustering','text2image','unicharset_extractor','combine_lang_model','classifier_tester','dawg2wordlist','tesseract-uninstall','winpath','ambiguous_words') } |
    Copy-Item -Destination "$bin\tesseract\" -Force
  foreach ($lang in @('eng.traineddata','chi_sim.traineddata')) {
    $c = @("$env:USERPROFILE\tessdata\$lang", "$tessSrc\tessdata\$lang")
    $f = $c | Where-Object { Test-Path $_ } | Select-Object -First 1
    if ($f) { Copy-Item $f "$bin\tesseract\tessdata\" -Force }
  }
  Write-Host "Tesseract OK"
} else {
  Write-Warning 'Tesseract not found on this machine — OCR will fall back to Windows OCR'
}

# --- FFmpeg ---
$ffSrc = @(
  'C:\ffmpeg\bin\ffmpeg.exe',
  "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\ffmpeg-8.1.2-full_build\bin\ffmpeg.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1
# 也查 PATH
if (-not $ffSrc) {
  $c = Get-Command ffmpeg -ErrorAction SilentlyContinue
  if ($c) { $ffSrc = $c.Source }
}
if ($ffSrc) {
  Copy-Item $ffSrc "$bin\ffmpeg\ffmpeg.exe" -Force
  $fp = Join-Path (Split-Path $ffSrc) 'ffprobe.exe'
  if (Test-Path $fp) { Copy-Item $fp "$bin\ffmpeg\ffprobe.exe" -Force }
  Write-Host "FFmpeg OK: $ffSrc"
} else {
  Write-Warning 'FFmpeg not found — download from https://www.gyan.dev/ffmpeg/builds/ and place ffmpeg.exe under resources/bin/ffmpeg/'
}

Write-Host "Done. bin size: $([math]::Round((Get-ChildItem $bin -Recurse -File | Measure-Object Length -Sum).Sum/1MB,1)) MB"
