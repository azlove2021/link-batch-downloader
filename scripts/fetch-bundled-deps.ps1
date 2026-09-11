# 打包前准备「随软件分发」的依赖到 src-tauri/resources/bin
# 精简分发版：只内置 ffmpeg.exe（不带 ffprobe、不带 Tesseract）。
# Tesseract / LibreOffice / FFmpeg 完整版由应用内「增强组件」下载指引用户自行安装。

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$bin = Join-Path $root 'src-tauri\resources\bin'
New-Item -ItemType Directory -Force -Path "$bin\ffmpeg" | Out-Null

# --- FFmpeg（仅 ffmpeg.exe）---
$ffSrc = @(
  'C:\ffmpeg\bin\ffmpeg.exe',
  "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\ffmpeg-8.1.2-full_build\bin\ffmpeg.exe",
  "$env:LOCALAPPDATA\Microsoft\WinGet\Links\ffmpeg.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $ffSrc) {
  $c = Get-Command ffmpeg -ErrorAction SilentlyContinue
  if ($c) { $ffSrc = $c.Source }
}
if ($ffSrc) {
  Copy-Item $ffSrc "$bin\ffmpeg\ffmpeg.exe" -Force
  Write-Host "FFmpeg OK: $ffSrc"
} else {
  Write-Warning 'FFmpeg not found — download from https://www.gyan.dev/ffmpeg/builds/ and place ffmpeg.exe under resources/bin/ffmpeg/'
}

# 不打包 Tesseract / ffprobe
Remove-Item "$bin\ffmpeg\ffprobe.exe" -Force -ErrorAction SilentlyContinue
Remove-Item "$bin\tesseract" -Recurse -Force -ErrorAction SilentlyContinue

Write-Host "Done. bin size: $([math]::Round((Get-ChildItem $bin -Recurse -File | Measure-Object Length -Sum).Sum/1MB,1)) MB"
