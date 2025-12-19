# Script de Build para WhatsApp Sender
# Crea el ejecutable y prepara el paquete de distribución

Write-Host "╔════════════════════════════════════════╗" -ForegroundColor Green
Write-Host "║   WhatsApp Sender - Build Script     ║" -ForegroundColor Green
Write-Host "╚════════════════════════════════════════╝" -ForegroundColor Green
Write-Host ""

# 1. Verificar que Node.js esté instalado
Write-Host "🔍 Verificando Node.js..." -ForegroundColor Cyan
try {
    $nodeVersion = node --version
    Write-Host "✅ Node.js encontrado: $nodeVersion" -ForegroundColor Green
} catch {
    Write-Host "❌ Error: Node.js no está instalado" -ForegroundColor Red
    Write-Host "   Descarga Node.js desde: https://nodejs.org/" -ForegroundColor Yellow
    exit 1
}

# 2. Instalar dependencias
Write-Host ""
Write-Host "📦 Instalando dependencias..." -ForegroundColor Cyan
npm install
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Error al instalar dependencias" -ForegroundColor Red
    exit 1
}
Write-Host "✅ Dependencias instaladas" -ForegroundColor Green

# 3. Instalar pkg si no está instalado
Write-Host ""
Write-Host "🔧 Verificando pkg..." -ForegroundColor Cyan
npm install --save-dev pkg
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Error al instalar pkg" -ForegroundColor Red
    exit 1
}
Write-Host "✅ pkg instalado" -ForegroundColor Green

# 4. Construir el ejecutable (sin limpiar dist primero)
Write-Host ""
Write-Host "🔨 Construyendo ejecutable..." -ForegroundColor Cyan
Write-Host "   (Esto puede tardar varios minutos...)" -ForegroundColor Yellow

# Crear carpeta dist si no existe
if (-not (Test-Path "dist")) {
    New-Item -ItemType Directory -Path "dist" | Out-Null
}

npm run build
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Error al construir el ejecutable" -ForegroundColor Red
    exit 1
}
Write-Host "✅ Ejecutable creado" -ForegroundColor Green

# 6. Crear carpeta de distribución
Write-Host ""
Write-Host "📦 Preparando paquete de distribución..." -ForegroundColor Cyan
$distFolder = "dist\whatsapp-sender-package"
if (Test-Path $distFolder) {
    Remove-Item -Recurse -Force $distFolder
}
New-Item -ItemType Directory -Path $distFolder | Out-Null

# 7. Copiar archivos necesarios
Write-Host "   Copiando archivos..." -ForegroundColor Cyan

# Verificar y copiar ejecutable
if (Test-Path "dist\whatsapp-sender.exe") {
    Copy-Item "dist\whatsapp-sender.exe" -Destination $distFolder
    Write-Host "   ✓ whatsapp-sender.exe" -ForegroundColor Gray
} else {
    Write-Host "   ⚠ whatsapp-sender.exe no encontrado" -ForegroundColor Yellow
}

# Verificar y copiar plantilla
if (Test-Path "message-template.txt") {
    Copy-Item "message-template.txt" -Destination $distFolder
    Write-Host "   ✓ message-template.txt" -ForegroundColor Gray
} else {
    Write-Host "   ⚠ message-template.txt no encontrado" -ForegroundColor Yellow
}

# Verificar y copiar config
if (Test-Path "config.js") {
    Copy-Item "config.js" -Destination $distFolder
    Write-Host "   ✓ config.js" -ForegroundColor Gray
} else {
    Write-Host "   ⚠ config.js no encontrado" -ForegroundColor Yellow
}

# Verificar y copiar README
if (Test-Path "README-USUARIO.md") {
    Copy-Item "README-USUARIO.md" -Destination $distFolder
    Write-Host "   ✓ README-USUARIO.md" -ForegroundColor Gray
} else {
    Write-Host "   ⚠ README-USUARIO.md no encontrado" -ForegroundColor Yellow
}

Write-Host "✅ Archivos copiados" -ForegroundColor Green

# 8. Crear archivo ZIP
Write-Host ""
Write-Host "🗜️  Creando archivo ZIP..." -ForegroundColor Cyan
$zipPath = "dist\whatsapp-sender-v1.0.zip"
if (Test-Path $zipPath) {
    Remove-Item -Force $zipPath
}
Compress-Archive -Path "$distFolder\*" -DestinationPath $zipPath
Write-Host "✅ ZIP creado: $zipPath" -ForegroundColor Green

# 9. Mostrar resumen
Write-Host ""
Write-Host "╔════════════════════════════════════════╗" -ForegroundColor Green
Write-Host "║          BUILD COMPLETADO             ║" -ForegroundColor Green
Write-Host "╚════════════════════════════════════════╝" -ForegroundColor Green
Write-Host ""
Write-Host "📁 Archivos generados:" -ForegroundColor Cyan
Write-Host "   - dist\whatsapp-sender.exe" -ForegroundColor White
Write-Host "   - dist\whatsapp-sender-v1.0.zip" -ForegroundColor White
Write-Host ""
Write-Host "📦 Contenido del paquete:" -ForegroundColor Cyan
Write-Host "   - whatsapp-sender.exe" -ForegroundColor White
Write-Host "   - message-template.txt" -ForegroundColor White
Write-Host "   - config.js" -ForegroundColor White
Write-Host "   - README-USUARIO.md" -ForegroundColor White
Write-Host ""
Write-Host "🎉 ¡Listo para distribuir!" -ForegroundColor Green
Write-Host ""
Write-Host "📤 Para distribuir:" -ForegroundColor Yellow
Write-Host "   1. Envía el archivo: dist\whatsapp-sender-v1.0.zip" -ForegroundColor White
Write-Host "   2. El usuario solo necesita descomprimir y ejecutar" -ForegroundColor White
Write-Host ""
