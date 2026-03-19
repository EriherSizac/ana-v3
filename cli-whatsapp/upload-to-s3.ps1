
$ErrorActionPreference = "Stop"

# Configuración
$BUCKET_NAME = "ana-backend-storage-prod"
$REGION = "us-east-1"

# Leer versión desde package.json
$packageJson = Get-Content -Raw -Path "package.json" | ConvertFrom-Json
$version = $packageJson.version

Write-Host "== Subiendo ANA v$version a S3 =="

# Verificar que el ejecutable existe
$exePath = "dist\ANA.exe"
if (!(Test-Path -Path $exePath)) {
  throw "No se encontró $exePath. Ejecuta 'npm run build' primero."
}

# Verificar que latest.json existe
$latestJsonPath = "dist\latest.json"
if (!(Test-Path -Path $latestJsonPath)) {
  throw "No se encontró $latestJsonPath. Ejecuta 'npm run build' primero."
}

# Verificar que AWS CLI está instalado
try {
  aws --version | Out-Null
} catch {
  throw "AWS CLI no está instalado. Instálalo desde: https://aws.amazon.com/cli/"
}

Write-Host "[1/3] Subiendo ANA-$version.exe a S3..."
aws s3 cp "$exePath" "s3://$BUCKET_NAME/versions/ANA-$version.exe" --region $REGION --acl public-read

if ($LASTEXITCODE -ne 0) {
  throw "Error al subir ANA-$version.exe a S3"
}

Write-Host "[2/3] Subiendo latest.json a S3..."
aws s3 cp "$latestJsonPath" "s3://$BUCKET_NAME/versions/latest.json" --region $REGION --acl public-read --content-type "application/json"

if ($LASTEXITCODE -ne 0) {
  throw "Error al subir latest.json a S3"
}

Write-Host "[3/3] Creando copia con nombre genérico (ANA-latest.exe)..."
aws s3 cp "s3://$BUCKET_NAME/versions/ANA-$version.exe" "s3://$BUCKET_NAME/versions/ANA-latest.exe" --region $REGION --acl public-read

if ($LASTEXITCODE -ne 0) {
  throw "Error al crear ANA-latest.exe en S3"
}

Write-Host ""
Write-Host "✅ Subida completada exitosamente!"
Write-Host ""
Write-Host "URLs públicas:"
Write-Host "  Versión específica: https://$BUCKET_NAME.s3.$REGION.amazonaws.com/versions/ANA-$version.exe"
Write-Host "  Última versión:     https://$BUCKET_NAME.s3.$REGION.amazonaws.com/versions/ANA-latest.exe"
Write-Host "  Metadata:           https://$BUCKET_NAME.s3.$REGION.amazonaws.com/versions/latest.json"
Write-Host ""
