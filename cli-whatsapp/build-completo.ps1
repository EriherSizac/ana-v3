# Script completo: Verificacion + Build + Compilacion de Instalador
# Ejecuta todo el proceso de generacion del instalador en un solo comando

$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  ANA - Build Completo del Instalador" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Paso 1: Verificacion
Write-Host "PASO 1: Verificacion de requisitos" -ForegroundColor Magenta
Write-Host "-----------------------------------" -ForegroundColor Magenta
& ".\verificar-build.ps1"
# Los scripts de PowerShell ya tienen exit 1 si fallan, no necesitamos verificar LASTEXITCODE

Write-Host ""
Read-Host "Presiona Enter para continuar con el build"

# Paso 2: Build Portable
Write-Host ""
Write-Host "PASO 2: Generacion de archivos portables" -ForegroundColor Magenta
Write-Host "----------------------------------------" -ForegroundColor Magenta
& ".\build-portable.ps1"
# Los scripts de PowerShell ya tienen exit 1 si fallan, no necesitamos verificar LASTEXITCODE

Write-Host ""
Read-Host "Presiona Enter para continuar con la compilacion del instalador"

# Paso 3: Compilar con Inno Setup
Write-Host ""
Write-Host "PASO 3: Compilacion del instalador con Inno Setup" -ForegroundColor Magenta
Write-Host "-------------------------------------------------" -ForegroundColor Magenta

$innoSetupPaths = @(
    "C:\Program Files (x86)\Inno Setup 6\ISCC.exe",
    "C:\Program Files\Inno Setup 6\ISCC.exe",
    "C:\Program Files (x86)\Inno Setup 5\ISCC.exe"
)

$innoSetupExe = $null
foreach ($path in $innoSetupPaths) {
    if (Test-Path -Path $path) {
        $innoSetupExe = $path
        break
    }
}

if ($null -eq $innoSetupExe) {
    Write-Host "[ERROR] Inno Setup no encontrado." -ForegroundColor Red
    Write-Host ""
    Write-Host "Por favor:" -ForegroundColor Yellow
    Write-Host "  1. Descarga Inno Setup desde: https://jrsoftware.org/isdl.php" -ForegroundColor White
    Write-Host "  2. Instalalo" -ForegroundColor White
    Write-Host "  3. Abre manualmente: installer\ANA-portable.iss" -ForegroundColor White
    Write-Host "  4. Compila con Ctrl+F9" -ForegroundColor White
    Write-Host ""
    exit 1
}

Write-Host "Compilando con Inno Setup..." -ForegroundColor Yellow
$issFile = Join-Path (Get-Location) "installer\ANA-portable.iss"

try {
    & $innoSetupExe $issFile
    if ($LASTEXITCODE -ne 0) {
        throw "Inno Setup fallo con codigo de salida $LASTEXITCODE"
    }
} catch {
    Write-Host "[ERROR] Error al compilar con Inno Setup: $_" -ForegroundColor Red
    exit 1
}

# Verificar que el instalador se genero
$installerPath = "dist-portable\ANA-Setup-Portable.exe"
if (Test-Path -Path $installerPath) {
    $raw = Get-Content -Raw -Path "package.json"
    $m = [regex]::Match($raw, '"version"\s*:\s*"(?<v>\d+\.\d+\.\d+)"')
    $anaVersion = if ($m.Success) { $m.Groups['v'].Value } else { $null }

    if ($anaVersion) {
        $renamedInstallerPath = "dist-portable\ANA-$anaVersion.exe"
        try {
            if (Test-Path -Path $renamedInstallerPath) {
                Remove-Item -Force $renamedInstallerPath
            }
            Move-Item -Path $installerPath -Destination $renamedInstallerPath -Force
            $installerPath = $renamedInstallerPath
        } catch {
            Write-Host "[WARN] No se pudo renombrar el instalador a versionado: $_" -ForegroundColor Yellow
        }
    } else {
        Write-Host "[WARN] No se pudo leer version desde package.json para renombrar el instalador" -ForegroundColor Yellow
    }

    $installerSize = (Get-Item $installerPath).Length / 1MB
    
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Green
    Write-Host "  [OK] BUILD COMPLETADO EXITOSAMENTE" -ForegroundColor Green
    Write-Host "========================================" -ForegroundColor Green
    Write-Host ""
    Write-Host "Instalador generado:" -ForegroundColor Cyan
    Write-Host "  Archivo: $installerPath" -ForegroundColor White
    Write-Host "  Tamano: $([math]::Round($installerSize, 2)) MB" -ForegroundColor White
    Write-Host ""
    Write-Host "Contenido incluido:" -ForegroundColor Cyan
    Write-Host "  [OK] Node.js v18.20.2 portable" -ForegroundColor Green
    Write-Host "  [OK] Playwright con Chromium" -ForegroundColor Green
    Write-Host "  [OK] Todas las dependencias npm" -ForegroundColor Green
    Write-Host "  [OK] Scripts de inicio (.bat)" -ForegroundColor Green
    Write-Host ""
    
    # Paso 4: Subir a S3
    Write-Host "PASO 4: Subiendo instalador a S3" -ForegroundColor Magenta
    Write-Host "---------------------------------" -ForegroundColor Magenta
    Write-Host ""
    
    try {
        & ".\setup-and-upload.ps1"
        if ($LASTEXITCODE -eq 0) {
            Write-Host ""
            Write-Host "========================================" -ForegroundColor Green
            Write-Host "  [OK] PROCESO COMPLETO EXITOSO" -ForegroundColor Green
            Write-Host "========================================" -ForegroundColor Green
            Write-Host ""
            Write-Host "Instalador generado y subido:" -ForegroundColor Cyan
            Write-Host "  Archivo local: $installerPath" -ForegroundColor White
            Write-Host "  Tamano: $([math]::Round($installerSize, 2)) MB" -ForegroundColor White
            Write-Host ""
            Write-Host "URLs publicas en S3:" -ForegroundColor Cyan
            Write-Host "  Version especifica: https://ana-backend-storage-prod.s3.us-east-1.amazonaws.com/versions/ANA-$anaVersion.exe" -ForegroundColor White
            Write-Host "  Ultima version:     https://ana-backend-storage-prod.s3.us-east-1.amazonaws.com/versions/ANA-latest.exe" -ForegroundColor White
            Write-Host ""
        } else {
            Write-Host ""
            Write-Host "[WARN] El instalador se genero pero no se pudo subir a S3" -ForegroundColor Yellow
            Write-Host "Puedes subir manualmente ejecutando: .\setup-and-upload.ps1" -ForegroundColor Yellow
            Write-Host ""
            Write-Host "Instalador local disponible en: $installerPath" -ForegroundColor Cyan
            Write-Host ""
        }
    } catch {
        Write-Host ""
        Write-Host "[WARN] Error al subir a S3: $_" -ForegroundColor Yellow
        Write-Host "Puedes subir manualmente ejecutando: .\setup-and-upload.ps1" -ForegroundColor Yellow
        Write-Host ""
        Write-Host "Instalador local disponible en: $installerPath" -ForegroundColor Cyan
        Write-Host ""
    }
    
    Write-Host "Siguiente paso:" -ForegroundColor Yellow
    Write-Host "  1. Prueba el instalador en una maquina limpia" -ForegroundColor White
    Write-Host "  2. Los usuarios pueden descargarlo desde S3" -ForegroundColor White
    Write-Host ""
} else {
    Write-Host ""
    Write-Host "[ERROR] El instalador no se genero correctamente" -ForegroundColor Red
    Write-Host "Verifica los logs de Inno Setup para mas detalles" -ForegroundColor Yellow
    exit 1
}
