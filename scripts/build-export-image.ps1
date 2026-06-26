# Build Marcternos Docker image and export to .tar for NAS/offline deploy
# Run in PowerShell: .\scripts\build-export-image.ps1

$ErrorActionPreference = "Stop"
$Root = Split-Path $PSScriptRoot -Parent
Set-Location $Root

$OutDir = "D:\Marcternos-Imagen"
$TarPath = Join-Path $OutDir "marcternos-panel.tar"

Write-Host "Comprobando Docker..."
docker version | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Error "Docker no responde. Abre Docker Desktop y espera a que este en verde."
}

New-Item -ItemType Directory -Path $OutDir -Force | Out-Null

Write-Host "Construyendo imagen..."
docker compose build
if ($LASTEXITCODE -ne 0) { throw "docker compose build fallo" }

$image = docker compose images -q panel-minecraft 2>$null
if (-not $image) {
    $image = (docker images --format "{{.Repository}}:{{.Tag}}" | Select-String "marcternos.*panel" | Select-Object -First 1)
}
if (-not $image) {
    $image = "marcternos-panel-minecraft:latest"
}

Write-Host "Exportando imagen: $image -> $TarPath"
if (Test-Path $TarPath) { Remove-Item $TarPath -Force }
docker save -o $TarPath $image

# Copiar archivos minimos para arrancar en el NAS
Copy-Item docker-compose.yml $OutDir -Force
Copy-Item .env.example $OutDir -Force
if (-not (Test-Path (Join-Path $OutDir "data"))) {
    New-Item -ItemType Directory -Path (Join-Path $OutDir "data") -Force | Out-Null
    Copy-Item data\.gitkeep (Join-Path $OutDir "data\.gitkeep") -Force -ErrorAction SilentlyContinue
}

$gb = [math]::Round((Get-Item $TarPath).Length / 1GB, 2)
Write-Host ""
Write-Host "LISTO: $OutDir"
Write-Host "  - marcternos-panel.tar ($gb GB)"
Write-Host "  - docker-compose.yml"
Write-Host "  - .env.example"
Write-Host ""
Write-Host "Copia la carpeta Marcternos-Imagen al NAS."
