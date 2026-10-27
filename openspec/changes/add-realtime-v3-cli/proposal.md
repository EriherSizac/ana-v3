# Proposal

## Why

El CLI v3 consulta `GET /get/chats/{agent}/{campaign}` cada 30 s aunque casi siempre responda 404, y una asignación publicada desde "Mi asignación" o repartida por un supervisor tarda hasta 30 s en empezar; la configuración remota (`GET /agent/settings`) tarda hasta 5 min en aplicarse. Con el canal de `add-realtime-gateway`, el CLI puede despertar al momento y espaciar el polling a un respaldo de 2 min, reduciendo invocaciones en toda la flota.

## What Changes

- El proceso principal del CLI abre una conexión WebSocket (`client=cli`) tras el login Cognito con el ID token de la sesión, envía `ping` cada 5 min, reconecta con backoff exponencial y de forma planeada a los 110 min o al renovar el token, y la cierra con Ctrl+C.
- `assignment.published` para el agente y la campaña de la sesión interrumpe la espera entre polls y consulta `GET /get/chats/...` en máximo 2 s; durante un ciclo de envío o la pausa por lote no interrumpe nada.
- `settings.changed` con `scope: "cli"` dispara una lectura inmediata de `GET /agent/settings`.
- **BREAKING** (comportamiento): con la conexión confirmada, la espera entre polls pasa de 30 s a 2 min y la lectura periódica de configuración de 5 a 15 min; sin conexión se conservan 30 s y 5 min. Cada reconexión hace un poll y una lectura de configuración.
- El widget de estado muestra "En vivo · respaldo en Xm Ys" cuando el canal está activo.
- Flag local `ANA_REALTIME=off` y URL `ANA_REALTIME_URL` (default prod); el interruptor del servidor tiene el mismo efecto sin release.
- Release del CLI vía autoupdate (versión mayor a 1.0.47). Los CLIs instalados sin este release siguen igual: no hay cambio de contrato.

Fuera de alcance: eventos para las ventanas manual y monitor, mover el consumo de pendientes o el envío al socket, CLIs sin sesión Cognito (siguen con 30 s).

## Capabilities

### New Capabilities

- `v3/cli-realtime`: conexión del CLI al canal realtime, reacción a eventos, intervalos de respaldo, widget y flag local.

### Modified Capabilities

- `v3/automated-sending`: "Intervalo de polling" pasa a depender del estado del canal y admite el despertar por evento.

## Impact

- Depende de `add-realtime-gateway` (prod) y de `migrate-cli-to-cognito-login` (ID token en el CLI) y `add-cli-remote-settings` (`remote-settings.js`).
- CLI: nuevo `realtime.js` (conexión, backoff, latido, reconexión planeada), `index.js` (espera interrumpible en `sleepWithCountdown`, intervalo variable, cableado, widget), `remote-settings.js` (intervalo variable y `refreshNow()`), `constants.js`/`config.js` (URL y flag).
- Dependencia nueva: `ws` (el `.exe` corre en Node 18 vía `pkg`, sin `WebSocket` global); se empaqueta con esbuild, con `bufferutil`/`utf-8-validate` como opcionales excluidos.
- Backend: sin cambios.
