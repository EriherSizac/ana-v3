# Proposal

## Why

El main del desktop v4 consulta `GET /jobs/poll` cada 5 s aunque casi nunca haya cambios, y `GET /settings` cada 5 min, de modo que un cambio de ritmo desde ANA Admin tarda hasta 5 min en aplicarse. Con el canal de `add-realtime-gateway`, el desktop puede enterarse al momento de jobs nuevos, reasignaciones y cambios de configuración, y dejar el polling como respaldo lento.

## What Changes

- El main abre una conexión WebSocket (`client=desktop`) tras el login con el ID token del `TokenBroker`, envía `ping` cada 5 min, reconecta con backoff exponencial y de forma planeada a los 110 min o al renovar el token (abriendo la nueva antes de cerrar la anterior), y la cierra al cerrar sesión o salir.
- `jobs.changed` dispara una consulta `GET /jobs/poll` inmediata (coalescida 1 s; si hay envío en curso, al terminar); `settings.changed` con `scope: "desktop"` dispara `GET /settings` inmediato.
- Con la conexión confirmada, la consulta periódica de jobs pasa de 5 s a 2 min y la de configuración de 5 a 15 min; sin conexión vuelven a 5 s y 5 min (comportamiento actual). Cada reconexión hace una lectura de jobs y de configuración.
- Flag local `ANA_REALTIME=off` (env) que desactiva el canal y conserva el polling actual; el interruptor del servidor (`realtimeEnabled=false`) tiene el mismo efecto sin release.
- Release del desktop vía autoupdate (versión mayor a 1.3.0).

Fuera de alcance: indicador de "en vivo" en la UI del renderer, mover el envío o el acuse al socket, eventos de chats/conversaciones.

## Capabilities

### New Capabilities

- `v4/desktop-realtime`: conexión del desktop al canal realtime, reacción a eventos, intervalos de respaldo y flag local.

### Modified Capabilities

(ninguna; "Consulta periódica de jobs" de `v4/job-processing` y "Consumo en el desktop" de `v4/desktop-remote-settings` tienen MODIFIED/ADDED pendientes en `v4-fix-desktop-session-lifecycle` y `v4-add-desktop-remote-settings`; los nuevos intervalos se declaran en `v4/desktop-realtime` con precedencia explícita y se consolidan al archivar, ver tasks.md)

## Impact

- Depende de `add-realtime-gateway` desplegado (URL `RealtimeWsUrl`) y de `v4-add-desktop-remote-settings` (`RemoteSettings`).
- Desktop: nuevo `electron/realtime/client.ts` (conexión, backoff, latido, reconexión planeada), `electron/jobs/poller.ts` (intervalo variable y `pollNow()`), `electron/settings/remoteSettings.ts` (intervalo variable y `refreshNow()`), `electron/main.ts` (cableado, `ANA_REALTIME_URL`, `ANA_REALTIME`), `.env.example`.
- Sin dependencias nuevas: Electron 38 trae Node 22 con `WebSocket` global.
- Backend: sin cambios de REST.
