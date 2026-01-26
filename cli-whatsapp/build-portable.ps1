# Script para crear instalador portable con Node.js embebido
# Genera un instalador .exe que incluye Node.js, Playwright y todas las dependencias

$ErrorActionPreference = "Stop"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  ANA - Build Portable Installer" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Configuracion
$NODE_VERSION = "18.20.2"
$NODE_ARCH = "x64"
$DIST_DIR = "dist-portable"
$NODE_DIR = "$DIST_DIR\nodejs"
$APP_DIR = "$DIST_DIR\app"
$BROWSERS_DIR = "$DIST_DIR\browsers"

# Limpiar directorio de distribucion
if (Test-Path -Path $DIST_DIR) {
    Write-Host "[1/8] Limpiando directorio anterior..." -ForegroundColor Yellow
    Remove-Item -Recurse -Force $DIST_DIR
}
New-Item -ItemType Directory -Path $DIST_DIR | Out-Null
New-Item -ItemType Directory -Path $NODE_DIR | Out-Null
New-Item -ItemType Directory -Path $APP_DIR | Out-Null

# Descargar Node.js portable
Write-Host "[2/8] Descargando Node.js $NODE_VERSION portable..." -ForegroundColor Yellow
$NODE_URL = "https://nodejs.org/dist/v$NODE_VERSION/node-v$NODE_VERSION-win-$NODE_ARCH.zip"
$NODE_ZIP = "$DIST_DIR\node.zip"

try {
    Invoke-WebRequest -Uri $NODE_URL -OutFile $NODE_ZIP -UseBasicParsing
    Write-Host "    [OK] Node.js descargado" -ForegroundColor Green
} catch {
    Write-Host "    [ERROR] Error descargando Node.js: $_" -ForegroundColor Red
    exit 1
}

# Extraer Node.js
Write-Host "[3/8] Extrayendo Node.js..." -ForegroundColor Yellow
Expand-Archive -Path $NODE_ZIP -DestinationPath $DIST_DIR -Force
$extractedNodeDir = Get-ChildItem -Path $DIST_DIR -Directory | Where-Object { $_.Name -like "node-v*" } | Select-Object -First 1
if ($extractedNodeDir) {
    Move-Item -Path "$($extractedNodeDir.FullName)\*" -Destination $NODE_DIR -Force
    Remove-Item -Path $extractedNodeDir.FullName -Recurse -Force
    Write-Host "    [OK] Node.js extraido a $NODE_DIR" -ForegroundColor Green
} else {
    Write-Host "    [ERROR] No se pudo encontrar el directorio extraido de Node.js" -ForegroundColor Red
    exit 1
}
Remove-Item -Path $NODE_ZIP -Force

# Copiar archivos de la aplicacion
Write-Host "[4/8] Copiando archivos de la aplicacion..." -ForegroundColor Yellow
$filesToCopy = @(
    "setup-env.js",
    "index.js",
    "whatsapp.js",
    "whatsapp-manual.js",
    "whatsapp-monitor.js",
    "chat-backup.js",
    "config.js",
    "csv-utils.js",
    "message-utils.js",
    "agent-config.js",
    "package.json",
    "package-lock.json"
)

foreach ($file in $filesToCopy) {
    if (Test-Path -Path $file) {
        Copy-Item -Path $file -Destination $APP_DIR -Force
        Write-Host "    [OK] Copiado: $file" -ForegroundColor Green
    } else {
        Write-Host "    [WARN] No encontrado: $file" -ForegroundColor Yellow
    }
}

# Instalar dependencias de produccion
Write-Host "[5/8] Instalando dependencias de produccion..." -ForegroundColor Yellow
Push-Location $APP_DIR
$npmCmd = Join-Path (Resolve-Path "..\nodejs") "npm.cmd"
& $npmCmd install --omit=dev --no-audit --no-fund
if ($LASTEXITCODE -ne 0) {
    Write-Host "    [ERROR] Error instalando dependencias" -ForegroundColor Red
    Pop-Location
    exit 1
}
Write-Host "    [OK] Dependencias instaladas" -ForegroundColor Green
Pop-Location

# Instalar Playwright y navegadores
Write-Host "[6/8] Instalando Playwright Chromium..." -ForegroundColor Yellow
Push-Location $APP_DIR
$npxCmd = Join-Path (Resolve-Path "..\nodejs") "npx.cmd"
& $npxCmd playwright install chromium
if ($LASTEXITCODE -ne 0) {
    Write-Host "    [ERROR] Error instalando Playwright" -ForegroundColor Red
    Pop-Location
    exit 1
}
Write-Host "    [OK] Playwright instalado" -ForegroundColor Green
Pop-Location

# Copiar navegadores de Playwright
Write-Host "[7/8] Copiando navegadores de Playwright..." -ForegroundColor Yellow
$msPlaywright = Join-Path $env:LOCALAPPDATA "ms-playwright"
if (Test-Path -Path $msPlaywright) {
    New-Item -ItemType Directory -Path $BROWSERS_DIR -Force | Out-Null
    Copy-Item -Recurse -Force (Join-Path $msPlaywright "*") $BROWSERS_DIR
    Write-Host "    [OK] Navegadores copiados a $BROWSERS_DIR" -ForegroundColor Green
} else {
    Write-Host "    [ERROR] No se encontro ms-playwright en $msPlaywright" -ForegroundColor Red
    exit 1
}

# Crear script de inicio
Write-Host "[8/8] Creando scripts de inicio..." -ForegroundColor Yellow
$launcherScript = @"
@echo off
setlocal EnableDelayedExpansion

REM Configurar ruta de navegadores de Playwright
set "PLAYWRIGHT_BROWSERS_PATH=%~dp0browsers"

REM Agregar Node.js al PATH
set "PATH=%~dp0nodejs;%PATH%"

REM Cambiar al directorio de la aplicación
cd /d "%~dp0app"

REM Ejecutar la aplicación
"%~dp0nodejs\node.exe" index.js %*

endlocal
"@
Set-Content -Path "$DIST_DIR\ANA.bat" -Value $launcherScript -Encoding ASCII
Write-Host "    [OK] Script de inicio creado" -ForegroundColor Green

# Crear script de inicio con imagen desde portapapeles
$launcherScriptImage = @"
@echo off
setlocal EnableDelayedExpansion

REM Configurar ruta de navegadores de Playwright
set "PLAYWRIGHT_BROWSERS_PATH=%~dp0browsers"

REM Agregar Node.js al PATH
set "PATH=%~dp0nodejs;%PATH%"

REM Cambiar al directorio de la aplicación
cd /d "%~dp0app"

REM Ejecutar la aplicación con soporte de imagen desde portapapeles
"%~dp0nodejs\node.exe" index.js --clipboard-media %*

endlocal
"@
Set-Content -Path "$DIST_DIR\ANA-con-imagen.bat" -Value $launcherScriptImage -Encoding ASCII
Write-Host "    [OK] Script de inicio con imagen creado" -ForegroundColor Green

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  [OK] Build completado exitosamente" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "Contenido generado en: $DIST_DIR" -ForegroundColor Cyan
Write-Host "  - nodejs/          (Node.js portable)" -ForegroundColor White
Write-Host "  - app/             (Aplicacion y dependencias)" -ForegroundColor White
Write-Host "  - browsers/        (Navegadores Playwright)" -ForegroundColor White
Write-Host "  - ANA.bat          (Script de inicio)" -ForegroundColor White
Write-Host "  - ANA-con-imagen.bat (Script con imagen)" -ForegroundColor White
Write-Host ""
Write-Host "Siguiente paso:" -ForegroundColor Yellow
Write-Host "  1. Abre Inno Setup Compiler" -ForegroundColor White
Write-Host "  2. Abre el archivo: installer\ANA-portable.iss" -ForegroundColor White
Write-Host "  3. Compila para generar el instalador" -ForegroundColor White
Write-Host ""
