
$ErrorActionPreference = "Stop"

if (!(Test-Path -Path "dist")) {
  New-Item -ItemType Directory -Path "dist" | Out-Null
}

Write-Host "== ANA build (Windows) =="

Write-Host "[1/5] Installing dependencies..."
npm i

Write-Host "[2/5] Installing Playwright Chromium..."
npx playwright install chromium

Write-Host "[3/5] Bundling app (esbuild -> dist\\app.cjs)..."
npx esbuild index.js --bundle --platform=node --format=cjs --outfile="dist\\app.cjs" --external:playwright

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

Write-Host "\nBuild listo:"
Write-Host "- dist\\ANA.exe"
Write-Host "- dist\\browsers\\..."
Write-Host "\nSiguiente paso: abrir Inno Setup y compilar installer\\ANA.iss"
