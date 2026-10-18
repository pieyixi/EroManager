param([switch]$SkipBuild)
$ErrorActionPreference='Stop'
$repository=(Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$env:CARGO_HOME='D:\Envirnment\rust\cargo'
$env:RUSTUP_HOME='D:\Envirnment\rust\rustup'
$env:CARGO_TARGET_DIR=Join-Path $repository 'src-tauri\target\path-verification'
if (!$SkipBuild) {
  & 'D:\Envirnment\rust\cargo\bin\cargo.exe' build --release --bin ero-manager-admin --locked --offline --manifest-path (Join-Path $repository 'src-tauri\Cargo.toml')
  if ($LASTEXITCODE -ne 0) { throw 'Admin build failed' }
}
# Tauri 默认向所有二进制链接 GUI 图标；管理工具去掉内置图标，使用 Windows 默认 EXE 图标。
& 'D:\Envirnment\python\python312\python.exe' (Join-Path $PSScriptRoot 'remove-admin-icon.py') (Join-Path $env:CARGO_TARGET_DIR 'release\ero-manager-admin.exe')
if ($LASTEXITCODE -ne 0) { throw 'Admin embedded icon removal failed' }
