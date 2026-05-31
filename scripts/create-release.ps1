$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$outDir = Join-Path $root "dist"
$zipPath = Join-Path $outDir "campus-relay-server.zip"

New-Item -ItemType Directory -Force -Path $outDir | Out-Null
if (Test-Path $zipPath) {
  Remove-Item -LiteralPath $zipPath -Force
}

$items = @(
  "package.json",
  "package-lock.json",
  ".env.example",
  "README.md",
  "src"
)

$temp = Join-Path $outDir "campus-relay-server"
if (Test-Path $temp) {
  Remove-Item -LiteralPath $temp -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $temp | Out-Null

foreach ($item in $items) {
  Copy-Item -LiteralPath (Join-Path $root $item) -Destination $temp -Recurse -Force
}

Compress-Archive -LiteralPath $temp -DestinationPath $zipPath -Force
Remove-Item -LiteralPath $temp -Recurse -Force

Write-Host "Created $zipPath"
