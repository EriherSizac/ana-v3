
$ErrorActionPreference = "Stop"

function Update-PackageJsonPatchVersion {
  param(
    [Parameter(Mandatory = $true)][string]$PackageJsonPath
  )

  if (!(Test-Path -Path $PackageJsonPath)) {
    throw "No se encontró $PackageJsonPath"
  }

  $raw = Get-Content -Raw -Path $PackageJsonPath
  $m = [regex]::Match($raw, '"version"\s*:\s*"(?<v>\d+\.\d+\.\d+)"')
  if (!$m.Success) {
    throw "No se pudo leer version desde package.json"
  }

  $v = $m.Groups['v'].Value
  $parts = $v.Split('.')
  $major = [int]$parts[0]
  $minor = [int]$parts[1]
  $patch = [int]$parts[2]
  $newVersion = "$major.$minor.$($patch + 1)"

  $updated = [regex]::Replace(
    $raw,
    '"version"\s*:\s*"\d+\.\d+\.\d+"',
    '"version": "' + $newVersion + '"',
    1
  )
  Set-Content -Path $PackageJsonPath -Value $updated -Encoding UTF8
  return $newVersion
}

if (!(Test-Path -Path "dist")) {
  New-Item -ItemType Directory -Path "dist" | Out-Null
}

Write-Host "== ANA build (Windows) =="

$anaVersion = Update-PackageJsonPatchVersion -PackageJsonPath "package.json"
Write-Host "Version incrementada: $anaVersion"

Write-Host "[1/5] Installing dependencies..."
npm i

Write-Host "[2/5] Installing Playwright Chromium..."
npx playwright install chromium

Write-Host "[3/5] Bundling app (esbuild -> dist\\app.cjs)..."

# $anaVersion ya fue calculada e incrementada arriba

# Inyectar versión al bundle para auto-update (process.env.ANA_VERSION)
npx esbuild index.js --bundle --platform=node --format=cjs --outfile="dist\\app.cjs" --external:playwright --define:process.env.ANA_VERSION=\"$anaVersion\"

Write-Host "[4/5] Building executable (pkg)..."
npx pkg "dist\\app.cjs" --targets node18-win-x64 --output "dist\\ANA.exe" --no-bytecode --public
if ($LASTEXITCODE -ne 0) {
  throw "pkg falló (exit code $LASTEXITCODE)"
}

if (!(Test-Path -Path "dist\\ANA.exe")) {
  throw "pkg no generó dist\\ANA.exe"
}

Write-Host "[5/5] Staging Playwright browsers into dist\\browsers..."

$msPlaywright = Join-Path $env:LOCALAPPDATA "ms-playwright"
if (!(Test-Path -Path $msPlaywright)) {
  throw "No se encontró ms-playwright en $msPlaywright. Verifica que 'npx playwright install chromium' haya corrido correctamente."
}

$browsersTarget = Join-Path (Resolve-Path "dist").Path "browsers"
if (Test-Path -Path $browsersTarget) {
  Remove-Item -Recurse -Force $browsersTarget
}
New-Item -ItemType Directory -Path $browsersTarget | Out-Null

Copy-Item -Recurse -Force (Join-Path $msPlaywright "*") $browsersTarget

$latest = [ordered]@{
  version = $anaVersion
  url = "https://ana-backend-storage-prod.s3.us-east-1.amazonaws.com/versions/ANA-$anaVersion.exe"
}
$latestJsonPath = Join-Path (Resolve-Path "dist").Path "latest.json"
($latest | ConvertTo-Json -Depth 3) | Set-Content -Path $latestJsonPath -Encoding UTF8

Write-Host "\nBuild listo:"
Write-Host "- dist\\ANA.exe"
Write-Host "- dist\\browsers\\..."
Write-Host "- dist\\latest.json"

Write-Host "\n[6/6] Subiendo a S3..."
try {
  & ".\setup-and-upload.ps1"
  if ($LASTEXITCODE -eq 0) {
    Write-Host "\n✅ Build y subida a S3 completados!"
  } else {
    Write-Host "\n⚠️  Error al subir a S3 (exit code: $LASTEXITCODE)"
    Write-Host "Puedes subir manualmente ejecutando: .\setup-and-upload.ps1"
  }
} catch {
  Write-Host "\n⚠️  Error al subir a S3: $_"
  Write-Host "Puedes subir manualmente ejecutando: .\setup-and-upload.ps1"
}

Write-Host "\nSiguiente paso: abrir Inno Setup y compilar installer\\ANA.iss"
