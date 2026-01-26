# Script de verificacion pre-build
# Verifica que todos los requisitos esten listos antes de generar el instalador

$ErrorActionPreference = "Stop"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Verificacion Pre-Build de ANA" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$allOk = $true

# Verificar PowerShell
Write-Host "[1/6] Verificando PowerShell..." -ForegroundColor Yellow
$psVersion = $PSVersionTable.PSVersion
if ($psVersion.Major -ge 5) {
    Write-Host "    [OK] PowerShell $($psVersion.Major).$($psVersion.Minor) detectado" -ForegroundColor Green
} else {
    Write-Host "    [ERROR] PowerShell 5.0+ requerido (actual: $($psVersion.Major).$($psVersion.Minor))" -ForegroundColor Red
    $allOk = $false
}

# Verificar arquitectura del sistema
Write-Host "[2/6] Verificando arquitectura del sistema..." -ForegroundColor Yellow
if ([Environment]::Is64BitOperatingSystem) {
    Write-Host "    [OK] Windows 64-bit detectado" -ForegroundColor Green
} else {
    Write-Host "    [ERROR] Windows 64-bit requerido" -ForegroundColor Red
    $allOk = $false
}

# Verificar conexion a Internet
Write-Host "[3/6] Verificando conexion a Internet..." -ForegroundColor Yellow
try {
    $null = Invoke-WebRequest -Uri "https://nodejs.org" -UseBasicParsing -TimeoutSec 5 -Method Head
    Write-Host "    [OK] Conexion a Internet disponible" -ForegroundColor Green
} catch {
    Write-Host "    [ERROR] No se puede conectar a Internet (requerido para descargar Node.js)" -ForegroundColor Red
    $allOk = $false
}

# Verificar archivos de la aplicacion
Write-Host "[4/6] Verificando archivos de la aplicacion..." -ForegroundColor Yellow
$requiredFiles = @(
    "index.js",
    "whatsapp.js",
    "config.js",
    "package.json"
)

$missingFiles = @()
foreach ($file in $requiredFiles) {
    if (Test-Path -Path $file) {
        Write-Host "    [OK] $file" -ForegroundColor Green
    } else {
        Write-Host "    [ERROR] $file no encontrado" -ForegroundColor Red
        $missingFiles += $file
        $allOk = $false
    }
}

# Verificar Inno Setup
Write-Host "[5/6] Verificando Inno Setup..." -ForegroundColor Yellow
$innoSetupPaths = @(
    "C:\Program Files (x86)\Inno Setup 6\ISCC.exe",
    "C:\Program Files\Inno Setup 6\ISCC.exe",
    "C:\Program Files (x86)\Inno Setup 5\ISCC.exe"
)

$innoSetupFound = $false
foreach ($path in $innoSetupPaths) {
    if (Test-Path -Path $path) {
        Write-Host "    [OK] Inno Setup encontrado en: $path" -ForegroundColor Green
        $innoSetupFound = $true
        break
    }
}

if (-not $innoSetupFound) {
    Write-Host "    [WARN] Inno Setup no encontrado (opcional, pero necesario para crear el instalador)" -ForegroundColor Yellow
    Write-Host "           Descarga desde: https://jrsoftware.org/isdl.php" -ForegroundColor Yellow
}

# Verificar espacio en disco
Write-Host "[6/6] Verificando espacio en disco..." -ForegroundColor Yellow
$drive = (Get-Location).Drive
$freeSpace = (Get-PSDrive $drive.Name).Free / 1GB
if ($freeSpace -ge 2) {
    Write-Host "    [OK] Espacio disponible: $([math]::Round($freeSpace, 2)) GB" -ForegroundColor Green
} else {
    Write-Host "    [WARN] Espacio limitado: $([math]::Round($freeSpace, 2)) GB (se recomiendan al menos 2 GB)" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan

if ($allOk) {
    Write-Host "  [OK] VERIFICACION EXITOSA" -ForegroundColor Green
    Write-Host "========================================" -ForegroundColor Green
    Write-Host ""
    Write-Host "Todo esta listo para generar el instalador." -ForegroundColor White
    Write-Host ""
    Write-Host "Siguiente paso:" -ForegroundColor Yellow
    Write-Host "  .\build-portable.ps1" -ForegroundColor White
    Write-Host ""
} else {
    Write-Host "  [ERROR] VERIFICACION FALLIDA" -ForegroundColor Red
    Write-Host "========================================" -ForegroundColor Red
    Write-Host ""
    Write-Host "Por favor, corrige los problemas indicados arriba antes de continuar." -ForegroundColor White
    Write-Host ""
    exit 1
}
