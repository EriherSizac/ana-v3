# Tasks

## 1. Realtime release.available (backends)

- [x] 1.1 v4/backend: `release.available` en el catálogo (`ref.scope` cli|desktop → `k#<cliente>`), `translateS3` para `versions/latest.json`, traducción del bucket del desktop y ruta en `notify`; pruebas vitest en `test/realtime.test.ts` (`npm test` verde)
- [x] 1.2 v4/backend `serverless.yml`: regla `AnaDesktopReleaseRule` (bus por defecto us-east-2, `updates/latest.yml`) + permiso de invocación + `DESKTOP_UPDATES_BUCKET`; prueba de recursos en `test/realtime.test.ts`
- [x] 1.3 v3/ana-backend `serverless.yml`: `versions/latest.json` en el patrón de `RealtimeBridgeRule`; suite de v3/ana-backend verde

## 2. CLI: manifiesto, descarga y publicación

- [x] 2.1 `update-manifest.js` (BOM, HTML, `sha256`/`size` opcionales, `https:`, comparación) y uso en `self-update.js`; pruebas `test/update-manifest.test.js`
- [x] 2.2 `update-download.js` (progreso, tamaño, SHA-256 en flujo, borra parcial); pruebas con servidor local en `test/update-download.test.js`
- [x] 2.3 `upload-to-s3.py` reescribe `latest.json` con `sha256`/`size`; `build-completo.ps1` los muestra; nuevos módulos en `$filesToCopy` de `build-portable.ps1`

## 3. CLI: pausa, ayudante y orquestador

- [x] 3.1 `update-pause.js` (request/park/resume/sleep interrumpible) e integración en `index.js` (puntos seguros, esperas interrumpibles, pausa por lote); pruebas `test/update-pause.test.js` con ciclo falso
- [x] 3.2 `update-helper.js` (disposición de la instalación, script PowerShell con literales escapados, resultado previo); pruebas `test/update-helper.test.js` (comillas, inyección, indicadores)
- [x] 3.3 `update-banner.js` (aviso en la ventana manual, `textContent`) y `in-session-update.js` (chequeo 30 min, reanudación, realtime con jitter, pausa → descarga → 60 s → instalar; error → reanudar); pruebas `test/in-session-update.test.js` con reloj falso
- [x] 3.4 `realtime.js`: `release.available` (scope cli) → evento `release`; cableado en `index.js` (reanudación, realtime, resultado previo al arrancar); `node --test`, `node --check` y bundle esbuild verdes

## 4. Desktop: actualización en sesión

- [x] 4.1 `UpdaterCore`: modo sesión (pausa al detectar, `restarting` 60 s, `quitAndInstall(true, true)`, error → `resumeJobs`), `checkNow()`; `JobPoller.resumeNewJobs()`; pruebas vitest en `updaterCore.test.ts` y `poller.test.ts`
- [x] 4.2 Cableado: reanudación (`power/resume.ts`), `release.available` (scope desktop, jitter) en `realtime/client.ts` y `wiring.ts`; pruebas en `wiring.test.ts`
- [x] 4.3 Renderer: `UpdateBanner` no bloqueante en lugar de `UpdatingOverlay`; tipos en `ana.d.ts`; `npm test`, `npm run typecheck` y `npm run build` verdes

## 5. Documentación

- [x] 5.1 README del CLI y README de v4: cómo publicar (sha256 en `latest.json`, evento realtime, habilitar EventBridge en `ana-desktop-updates`, primer release por el camino de arranque)
