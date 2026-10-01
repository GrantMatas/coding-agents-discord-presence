$ErrorActionPreference = 'Stop'
$exe = Join-Path $PSScriptRoot 'artifacts\CodexDiscordPresence.exe'
if (-not (Test-Path -LiteralPath $exe)) { throw 'EXE not found. Run .\tools\Build-Exe.ps1 first.' }
Start-Process -FilePath $exe
