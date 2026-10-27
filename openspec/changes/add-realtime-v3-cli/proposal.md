# Proposal

## Why

El CLI v3 consulta `GET /get/chats/{agent}/{campaign}` cada 30 s aunque casi siempre responda 404, y una asignación publicada desde "Mi asignación" o repartida por un supervisor tarda hasta 30 s en empezar; la configuración remota (`GET /agent/settings`) tarda hasta 5 min en aplicarse, y un cambio de roster o de permisos no llega a la sesión abierta hasta el siguiente aviso del backend. Con el canal de `add-realtime-gateway`, el CLI puede despertar al momento, revalidar su acceso cuando el servidor lo fuerza y espaciar el polling a un respaldo de 2 min, reduciendo invocaciones en toda la flota.

## What Changes

- El proceso principal del CLI abre una conexión WebSocket (`client=cli`) tras el login Cognito con el ID token de la sesión, envía `ping` cada 5 min, reconecta con backoff exponencial y de forma planeada a los 110 min o al renovar el token, y la cierra con Ctrl+C.
- `assignment.published` para el agente y la campaña de la sesión interrumpe la espera entre polls y consulta `GET /get/chats/...` en máximo 2 s; durante un ciclo de envío o la pausa por lote no interrumpe nada.
- `settings.changed` con `scope: "cli"` dispara una lectura inmediata de `GET /agent/settings`.
- `session.refresh` (actualización forzada): el CLI vuelve a leer `GET /agent/campaigns` (revalida que su campaña sigue permitida y actualiza el aviso de autorización), `GET /agent/settings` y, si está esperando, consulta asignaciones; reconecta tras 0–10 s sin contar como fallo.
- **BREAKING** (comportamiento): con la conexión confirmada, la espera entre polls pasa de 30 s a 2 min y la lectura periódica de configuración de 5 a 15 min; sin conexión se conservan 30 s y 5 min. Cada reconexión hace un poll y una lectura de configuración.
- El widget de estado muestra "En vivo · respaldo en Xm Ys" cuando el canal está activo.
- URL `ANA_REALTIME_URL` (entorno) o el valor fijado en `config.js` para el release (la URL execute-api `RealtimeWsUrl` de prod, sin dominio propio); sin URL no hay conexión y el CLI se comporta como hoy. Flag local `ANA_REALTIME=off`; el interruptor del servidor tiene el mismo efecto sin release.
- Release del CLI vía autoupdate (versión mayor a 1.0.47) a toda la flota, sin piloto por agente, con el interruptor del servidor listo. Los CLIs instalados sin este release siguen igual: no hay cambio de contrato.

Fuera de alcance: eventos para las ventanas manual y monitor, mover el consumo de pendientes o el envío al socket, CLIs sin sesión Cognito (siguen con 30 s).

## Capabilities

### New Capabilities

- `v3/cli-realtime`: conexión del CLI al canal realtime, reacción a eventos y a la actualización forzada, intervalos de respaldo, widget, URL y flag local.

### Modified Capabilities

- `v3/automated-sending`: "Intervalo de polling" pasa a depender del estado del canal y admite el despertar por evento.

## Impact

- Depende de `add-realtime-gateway` (prod, con `session.refresh`) y de `migrate-cli-to-cognito-login` (ID token en el CLI) y `add-cli-remote-settings` (`remote-settings.js`).
- CLI: nuevos `realtime.js` (conexión, backoff, latido, reconexión planeada, refresco forzado) y `poll-wait.js` (espera interrumpible y etiqueta del widget), `index.js` (intervalo variable, cableado, widget), `remote-settings.js` (intervalo variable y `refreshNow()`), `backend-client.js` (`refreshAccess()`), `config.js` (URL y flag), `build-portable.ps1` (`$filesToCopy` con los módulos nuevos).
- Dependencia nueva: `ws` (el `.exe` corre en Node 18 vía `pkg`, sin `WebSocket` global); JS puro, se empaqueta con esbuild, con `bufferutil`/`utf-8-validate` como opcionales externos.
- Backend: sin cambios.
