# Tasks

## 1. Cliente realtime del main

- [ ] 1.1 Crear `electron/realtime/client.ts` (`RealtimeClient`: conexión con subprotocolo `ana.v1, <token>`, `client=desktop&v=<versión>`, `ping` al abrir y cada 5 min, activo tras el primer `pong`, timeout de `pong` 30 s, backoff 1 s→5 min con jitter y 15 min tras 403 o 5 fallos, reconexión planeada a los 110 min o con token nuevo, make-before-break, cierre al cerrar sesión, sin token en logs); verificar con vitest con `WebSocket`, reloj y temporizadores falsos cada escenario de "Conexión del desktop al canal", "Conexión confirmada", "Reconexión con backoff", "Reconexión planeada" y "Latido del desktop"
- [ ] 1.2 Parsear eventos con validación del sobre (`v:1`, tipo conocido) e ignorar tipos desconocidos o JSON inválido sin cerrar; verificar con vitest

## 2. Poller y configuración con intervalo variable

- [ ] 2.1 Hacer `JobPoller` configurable con `intervalMs()` y `pollNow()` (despierta la espera, coalescencia 1 s, `dirty` durante envío); verificar con vitest: `pollNow` ×5 en 500 ms → una consulta; `pollNow` durante un lote → consulta al terminar; con `intervalMs=120000` sin eventos → 5 consultas en 10 min; los tests existentes de `poller.test.ts` pasan sin cambios
- [ ] 2.2 Hacer `RemoteSettings` configurable con `intervalMs()` y `refreshNow()`; verificar con vitest (refreshNow aplica el valor nuevo; con 15 min no consulta antes)

## 3. Cableado en main

- [ ] 3.1 Cablear en `electron/main.ts`: arranque tras `auth:set-token`, `ANA_REALTIME_URL` (default prod) y `ANA_REALTIME=off`, `jobs.changed` → `pollNow`, `settings.changed` scope `desktop` → `refreshNow`, activo → intervalos 2 min/15 min + lectura inmediata, inactivo → 5 s/5 min, cierre en logout/salida; documentar las variables en `.env.example`; verificar con `npm run build` y en dev contra el gateway de dev: repartir un CSV desde ANA Admin dev aparece en "Mi asignación" en < 3 s, y con `ANA_REALTIME=off` no hay conexión (sin entrada en `ActiveConnections{client=desktop}`)
- [ ] 3.2 Prueba de resiliencia en dev: cortar red 3 min y restaurar → reconecta y consulta una vez; desplegar el gateway dev con `realtimeEnabled=false` → el poll vuelve a 5 s en ≤ 5 min; verificar en los logs del main y en CloudWatch (`jobsPoll` invocaciones)
- [ ] 3.3 Documentar en `v4/ARCHITECTURE.md` (sección desktop) la conexión, los intervalos y los flags; verificar que los valores documentados coinciden con las constantes del código

## 4. Release

- [ ] 4.1 Subir `version` del desktop, `npm run publish` y verificar `latest.yml` en `s3://ana-desktop-updates/updates/`; en la PC piloto confirmar `ActiveConnections{client=desktop}` ≥ 1, aparición de jobs en < 3 s y un cambio de `sendMinGapSeconds` aplicado en < 3 s
- [ ] 4.2 Tras 1 semana de piloto sin alarmas de `realtime-post-failing`, liberar a la flota; verificar la caída de invocaciones de `jobsPoll` en CloudWatch frente a la semana previa

## Workflow follow-up

- Rollout: requiere `add-realtime-gateway` desplegado en prod; rollback global con `realtimeEnabled=false`.
- Archivar después de `add-realtime-gateway`, `v4-add-desktop-remote-settings` y `v4-fix-desktop-session-lifecycle`; al archivar, evaluar un cambio de seguimiento que consolide el intervalo de "Consulta periódica de jobs" (`v4/job-processing`) con "Intervalos de respaldo" de `v4/desktop-realtime`.
