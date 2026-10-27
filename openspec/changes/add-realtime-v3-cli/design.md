# Design

## Context

- Contrato del canal, backoff común y actualización forzada: `add-realtime-gateway` (spec `v4/realtime-gateway`, design D8–D10 y D12). Los avisos de asignación vienen del puente S3 → EventBridge (`v3/realtime-bridge`): `agents/{c}/{agent}-contacts-*.csv` creado → `assignment.published` al usuario `{agent}`; `rosters/{c}.json` y `config/cli-settings.json` además fuerzan la actualización.
- `index.js`: bucle infinito con `POLL_INTERVAL_MS = 30 s` y `sleepWithCountdown(ms, label, pages)` que actualiza el widget de las tres ventanas cada segundo; pausa por lote (`PAUSE_DURATION_MS = 30 min`) usa la misma función. Identidad de sesión: `agentSession.identity()` (`agent_id`, `campaign`); token: `getIdToken()` de `agent-runtime.js` (renueva con `REFRESH_MARGIN_MS = 5 min`). Acceso: `backend.recheckAuthorization()` relee `GET /agent/campaigns` solo con un aviso 401/403 activo.
- `remote-settings.js`: `createRemoteSettings` con `setIntervalImpl` inyectable y `POLL_INTERVAL_MS = 5 min`.
- El `.exe` se construye con esbuild → `pkg` `node18-win-x64`: no hay `WebSocket` global en Node 18. El instalador portable (`build-portable.ps1`) copia los módulos listados en `$filesToCopy` e instala dependencias de producción.

## Goals / Non-Goals

**Goals:** inicio de una asignación publicada en < 3 s; 75 % menos polls con el canal activo (30 s → 2 min); cambios de roster o configuración aplicados en segundos cuando el servidor fuerza la actualización; cero cambios en el contrato del backend; flota vieja intacta.

**Non-Goals:** interrumpir ciclos o pausas; avisar a las ventanas manual/monitor; cambiar el consumo de `/contacts/pending`.

## Decisions

- **D1. `ws` como cliente.** Librería JS pura, estable, soporta subprotocolos y `ping`; esbuild la empaqueta en `dist/app.cjs` (se marcan `bufferutil` y `utf-8-validate` como externos opcionales) y el instalador portable la instala como dependencia de producción. Alternativa: subir `pkg` a Node 22 para tener `WebSocket` global: cambia el runtime de todo el CLI y el pipeline de build; fuera de alcance.
- **D2. `realtime.js` con dependencias inyectadas** (`WebSocketImpl`, temporizadores, `getIdToken`, reloj, aleatorio, logger), mismo patrón que `remote-settings.js`, exponiendo `isActive()`, `on('assignment')`, `on('settings')`, `on('active')`, `on('refresh')`. Vive en el proceso principal; las ventanas no se conectan.
- **D3. Espera interrumpible.** La espera entre polls se extrae a `poll-wait.js` (`createPollWaker`): señal de despertar, `wakePending` y etiqueta según el estado del canal; solo la espera entre polls se crea con señal; la pausa por lote no. Un aviso recibido fuera de la espera pone `wakePending = true` y la siguiente espera termina de inmediato. La duración se decide al iniciar la espera (`isActive() ? 2 min : 30 s`) y, si el canal cae durante una espera de 2 min, la espera se acorta a lo que reste de 30 s.
- **D4. Filtro por campaña.** El aviso trae la campaña del segmento de llave S3; se compara en minúsculas con la campaña de la sesión (la misma que va en `/get/chats/{agent}/{campaign}`). El usuario ya lo filtra el servidor (tema `u#<username>`).
- **D5. Respaldo de 2 min.** Si un aviso se pierde (agente con nombre legado en la llave, corte), el respaldo lo recoge en ≤ 2 min (aceptado por el usuario); el envío luego tarda mucho más por el ritmo y la pausa por lote, así que el retraso extra es marginal.
- **D6. URL y flags.** `ANA_REALTIME_URL` del entorno o `CONFIG.realtimeUrl` de `config.js` (vacío en el repositorio; se fija en el release con la URL execute-api de prod, no hay dominio propio). Sin URL válida (`wss://`), `ANA_REALTIME=off` o sin sesión, no se crea conexión: comportamiento actual. El interruptor del servidor lleva a canal inactivo = comportamiento actual.
- **D7. Actualización forzada.** Al recibir `session.refresh`, `realtime.js` cierra con 4001, emite `refresh(reason)` y reconecta tras 0–10 s sin crecer el backoff. `index.js` llama `backend.refreshAccess()` (nuevo: `GET /agent/campaigns` siempre, no solo con aviso activo, y actualiza `authStatus` a ok/forbidden según la campaña de la sesión), `remoteSettings.refreshNow()` y despierta la espera del poll. El equivalente de "`/me`" en v3 es `GET /agent/campaigns`: es lo que decide si la sesión puede operar su campaña.

## Risks / Trade-offs

- [Nombre de agente legado ≠ `cognito:username`] → sin aviso; respaldo de 2 min (antes 30 s). Mitigación: métrica de eventos sin conexión destino y, si aparece, normalizar nombres en el reparto legado.
- [Bundle más grande / fallo de `ws` en el `.exe`] → prueba del `.exe` en una PC limpia antes del release; si el `require('ws')` falla, el CLI registra el error y sigue sin canal.
- [Muchos CLIs reconectando a la vez tras un release o una actualización forzada a todos] → jitter del backoff y espera aleatoria de 0–10 s.
- [Release a toda la flota sin piloto] → el interruptor del servidor devuelve a todos al polling de 30 s sin release; `ANA_REALTIME=off` para un equipo; release anterior si `ws` diera problemas.

## Migration Plan

1. Implementar y probar contra el gateway de dev con `ANA_API_URL`/`ANA_REALTIME_URL` de dev.
2. Fijar `CONFIG.realtimeUrl` con la URL de prod, release (versión siguiente a 1.0.47) a toda la flota por autoupdate con el interruptor del servidor listo; observar `ActiveConnections{client=cli}` y que las asignaciones arrancan en < 3 s.
3. Rollback: `realtimeEnabled=false` (todos vuelven a 30 s) o `ANA_REALTIME=off` en un equipo; release anterior si `ws` diera problemas.
