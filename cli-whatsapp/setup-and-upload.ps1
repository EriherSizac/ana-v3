
$ErrorActionPreference = "Stop"

Write-Host "== Setup Python venv y subida a S3 =="

# Verificar que Python está instalado
try {
    $pythonVersion = python --version 2>&1
    Write-Host "✅ Python encontrado: $pythonVersion"
} catch {
    Write-Host "❌ Python no está instalado o no está en el PATH"
    Write-Host "Descárgalo desde: https://www.python.org/downloads/"
    exit 1
}

# Verificar que existe .env
if (!(Test-Path -Path ".env")) {
    if (Test-Path -Path ".env.example") {
        Write-Host "⚠️  No se encontró .env, copiando desde .env.example..."
        Copy-Item ".env.example" ".env"
        Write-Host "📝 Edita el archivo .env con tus credenciales de AWS antes de continuar"
        Write-Host "   Presiona Enter cuando hayas configurado .env..."
        Read-Host
    } else {
        Write-Host "❌ No se encontró .env ni .env.example"
        exit 1
    }
}

# Crear venv si no existe
if (!(Test-Path -Path "venv")) {
    Write-Host "[1/4] Creando virtual environment..."
    python -m venv venv
    if ($LASTEXITCODE -ne 0) {
        Write-Host "❌ Error al crear virtual environment"
        exit 1
    }
    Write-Host "✅ Virtual environment creado"
} else {
    Write-Host "[1/4] Virtual environment ya existe"
}

# Activar venv
Write-Host "[2/4] Activando virtual environment..."
$venvActivate = "venv\Scripts\Activate.ps1"
if (!(Test-Path -Path $venvActivate)) {
    Write-Host "❌ No se encontró $venvActivate"
    exit 1
}

& $venvActivate
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Error al activar virtual environment"
    exit 1
}
Write-Host "✅ Virtual environment activado"

# Instalar/actualizar dependencias
Write-Host "[3/4] Instalando dependencias de Python..."
python -m pip install --upgrade pip --quiet
python -m pip install -r requirements.txt --quiet
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Error al instalar dependencias"
    exit 1
}
Write-Host "✅ Dependencias instaladas"

# Ejecutar script de upload
Write-Host "[4/4] Ejecutando upload a S3..."
python upload-to-s3.py

if ($LASTEXITCODE -eq 0) {
    Write-Host "`n✅ Upload completado exitosamente!"
} else {
    Write-Host "`n❌ Error en el upload (exit code: $LASTEXITCODE)"
    exit 1
}
