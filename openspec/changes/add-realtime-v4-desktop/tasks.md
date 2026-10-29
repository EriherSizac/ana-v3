# Tasks

## 1. Cliente realtime del main

- [x] 1.1 Crear `electron/realtime/client.ts` (`RealtimeClient`: conexión con subprotocolo `ana.v1, <token>`, `client=desktop&v=<versión>`, `ping` al abrir y cada 5 min, activo tras el primer `pong`, timeout de `pong` 30 s, backoff 1 s→5 min con jitter y 15 min tras 403 o 5 fallos, reconexión planeada a los 110 min o con token nuevo, make-before-break, cierre al cerrar sesión, sin token en logs); verificar con vitest con `WebSocket`, reloj y temporizadores falsos cada escenario de "Conexión del desktop al canal", "Conexión confirmada", "Reconexión con backoff", "Reconexión planeada" y "Latido del desktop"
- [x] 1.2 Parsear eventos con validación del sobre (`v:1`, tipo conocido) e ignorar tipos desconocidos o JSON inválido sin cerrar; verificar con vitest
- [x] 1.3 Manejar `session.refresh` (cierre 4001, `onRefresh(reason)`, reconexión tras 0–10 s sin crecer el backoff); verificar con vitest los escenarios de "Actualización de acceso forzada en el desktop"

## 2. Poller y configuración con intervalo variable

- [x] 2.1 Hacer `JobPoller` configurable con `intervalMs()` y `pollNow()` (despierta la espera, coalescencia 1 s, `dirty` durante envío); verificar con vitest: `pollNow` ×5 en 500 ms → una consulta; `pollNow` durante un lote → consulta al terminar; con `intervalMs=120000` sin eventos → 5 consultas en 10 min; los tests existentes de `poller.test.ts` pasan sin cambios
- [x] 2.2 Hacer `RemoteSettings` configurable con `intervalMs()` y `refreshNow()`; verificar con vitest (refreshNow aplica el valor nuevo; con 15 min no consulta antes)

## 3. Cableado en main

- [x] 3.1 Cablear en `electron/main.ts`: arranque tras `auth:set-token`, URL desde `ANA_REALTIME_URL` o `realtimeUrl` de `build-config.json` (escrita por `scripts/write-build-config.mjs` desde `ANA_REALTIME_URL`; sin URL, sin conexión) y `ANA_REALTIME=off`, `jobs.changed` → `pollNow`, `settings.changed` scope `desktop` → `refreshNow`, activo → intervalos 2 min/15 min + lectura inmediata, inactivo → 5 s/5 min, cierre en logout/salida; documentar las variables en `.env.example`; verificar con `npm run build`, con una prueba de la resolución de URL/flag y en dev contra el gateway de dev: repartir un CSV desde ANA Admin dev aparece en "Mi asignación" en < 3 s, y con `ANA_REALTIME=off` no hay conexión (sin entrada en `ActiveConnections{client=desktop}`) — (verificado 2026-10-29: cableado en `electron/main.ts` + `electron/realtime/wiring.ts`, `ANA_REALTIME_URL`/`ANA_REALTIME` en `.env.example`, `wiring.test.ts` (resolución de URL/flag) y `pollerRealtime.test.ts`; `build-config.json` del build 1.4.0 trae la URL de prod; vitest y typecheck de v4/desktop en verde; incluido en el desktop 1.4.0 publicado; prueba manual en openspec/PENDIENTES.md)
- [x] 3.2 Cablear `onRefresh`: relectura de `GET /me` del main (`replyGate`), IPC `access:refresh` al renderer (preload + `App.tsx` vuelve a leer `/me`), `pollNow()` y `refreshNow()`; verificar con vitest la función de cableado (y `npm run typecheck`) y en dev forzando `{"scope":"user"}` desde ANA Admin dev — (verificado 2026-10-29: `onRefresh` relee `/me` (`replyGate`), envía IPC `access:refresh` (preload + `App.tsx`), `pollNow()` y `refreshNow()`; `wiring.test.ts`; vitest y typecheck de v4/desktop en verde; incluido en el desktop 1.4.0 publicado; prueba manual en openspec/PENDIENTES.md)
- [ ] 3.3 Prueba de resiliencia en dev: cortar red 3 min y restaurar → reconecta y consulta una vez; desplegar el gateway dev con `realtimeEnabled=false` → el poll vuelve a 5 s en ≤ 5 min; verificar en los logs del main y en CloudWatch (`jobsPoll` invocaciones)
- [x] 3.4 Documentar en `v4/ARCHITECTURE.md` (sección desktop) la conexión, los intervalos, la actualización forzada y los flags; verificar que los valores documentados coinciden con las constantes del código

## 4. Release

- [ ] 4.1 Subir `version` del desktop, compilar con `ANA_REALTIME_URL=<RealtimeWsUrl prod>` y `npm run publish`; verificar `latest.yml` en `s3://ana-desktop-updates/updates/` y en una PC actualizada `ActiveConnections{client=desktop}` ≥ 1, aparición de jobs en < 3 s y un cambio de `sendMinGapSeconds` aplicado en < 3 s
- [ ] 4.2 Liberar a toda la flota (sin piloto) con el interruptor del servidor listo; verificar durante la primera semana la caída de invocaciones de `jobsPoll` en CloudWatch frente a la semana previa y la ausencia de alarmas `realtime-post-failing`

## Workflow follow-up

- Rollout: requiere `add-realtime-gateway` desplegado en prod; rollback global con `realtimeEnabled=false`.
- Archivar después de `add-realtime-gateway`, `v4-add-desktop-remote-settings` y `v4-fix-desktop-session-lifecycle`; al archivar, evaluar un cambio de seguimiento que consolide el intervalo de "Consulta periódica de jobs" (`v4/job-processing`) con "Intervalos de respaldo" de `v4/desktop-realtime`.
