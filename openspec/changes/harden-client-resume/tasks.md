# Tasks

## 1. CLI v3

- [x] 1.1 Crear `liveness.js` (`withTimeout`, `boundedUi`, `createResumeDetector`, `createLoopHeartbeat`, `checkPageHealth`, `createLoopSupervisor`) y agregarlo a `$filesToCopy` de `build-portable.ps1`; verificar con `test/liveness.test.js` (reloj falso)
- [x] 1.2 `realtime.js`: `reconnectNow()` y reconexión sin pong en 2 heartbeats; verificar con `test/realtime.test.js`
- [x] 1.3 `index.js`/`poll-wait.js`: acotar widgets/estado, latidos del loop y acciones de reanudación; verificar con `node --test`, `node --check` y bundle esbuild

## 2. Desktop v4

- [x] 2.1 Crear `electron/power/resume.ts` (detector, coordinador, timeouts, decisión de reinicio de WhatsApp); verificar con `power/resume.test.ts`
- [x] 2.2 Conectar `powerMonitor` en `main.ts`, `reconnectNow()` en realtime y `probe`/`restartKeepSession` en WhatsApp; verificar con `npm test`, typecheck y build

## 3. Release

- [ ] 3.1 Subir versión del CLI (1.0.48 → 1.0.49) y publicarla por autoupdate
- [ ] 3.2 Subir versión del desktop (1.4.0 → 1.4.1) y publicarla
