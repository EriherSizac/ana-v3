# Design

## Context

- Contrato del canal y backoff común: `add-realtime-gateway` (spec `v4/realtime-gateway`, design D8–D10). Los avisos de asignación vienen del puente S3 → EventBridge (`v3/realtime-bridge`): `agents/{c}/{agent}-contacts-*.csv` creado → `assignment.published` al usuario `{agent}`.
- `index.js`: bucle infinito con `POLL_INTERVAL_MS = 30 s` y `sleepWithCountdown(ms, label, pages)` que actualiza el widget de las tres ventanas cada segundo; pausa por lote (`PAUSE_DURATION_MS = 30 min`) usa la misma función. Identidad de sesión: `agentSession.identity()` (`agent_id`, `campaign`); token: `getIdToken()` de `agent-runtime.js` (renueva con `REFRESH_MARGIN_MS = 5 min`).
- `remote-settings.js`: `createRemoteSettings` con `setIntervalImpl` inyectable y `POLL_INTERVAL_MS = 5 min`.
- El `.exe` se construye con esbuild → `pkg` `node18-win-x64`: no hay `WebSocket` global en Node 18.

## Goals / Non-Goals

**Goals:** inicio de una asignación publicada en < 3 s; 75 % menos polls con el canal activo (30 s → 2 min); cero cambios en el contrato del backend; flota vieja intacta.

**Non-Goals:** interrumpir ciclos o pausas; avisar a las ventanas manual/monitor; cambiar el consumo de `/contacts/pending`.

## Decisions

- **D1. `ws` como cliente.** Librería JS pura, estable, soporta subprotocolos y `ping`; esbuild la empaqueta en `dist/app.cjs` (se marcan `bufferutil` y `utf-8-validate` como externos opcionales). Alternativa: subir `pkg` a Node 22 para tener `WebSocket` global: cambia el runtime de todo el CLI y el pipeline de build; fuera de alcance.
- **D2. `realtime.js` con dependencias inyectadas** (`WebSocketImpl`, temporizadores, `getIdToken`, reloj, logger), mismo patrón que `remote-settings.js`, exponiendo `isActive()`, `on('assignment')`, `on('settings')`, `on('active')`. Vive en el proceso principal; las ventanas no se conectan.
- **D3. Espera interrumpible.** `sleepWithCountdown` recibe un `AbortSignal` (o promesa de despertar) y la etiqueta según el estado del canal; solo la espera entre polls se crea con señal; la pausa por lote no. Un aviso recibido fuera de la espera pone `wakePending = true` y la siguiente espera termina de inmediato. La duración se decide al iniciar la espera (`isActive() ? 2 min : 30 s`) y, si el canal cae durante una espera de 2 min, la espera se acorta a lo que reste de 30 s.
- **D4. Filtro por campaña.** El aviso trae la campaña del segmento de llave S3; se compara en minúsculas con la campaña de la sesión (la misma que va en `/get/chats/{agent}/{campaign}`). El usuario ya lo filtra el servidor (tema `u#<username>`).
- **D5. Respaldo de 2 min.** Si un aviso se pierde (agente con nombre legado en la llave, corte), el respaldo lo recoge en ≤ 2 min; el envío luego tarda mucho más por el ritmo y la pausa por lote, así que el retraso extra es marginal.
- **D6. Flags.** `ANA_REALTIME=off` y `ANA_REALTIME_URL` leídos como el resto de variables de `config.js`/`constants.js` (default de prod embebido en el build); el interruptor del servidor lleva a canal inactivo = comportamiento actual.

## Risks / Trade-offs

- [Nombre de agente legado ≠ `cognito:username`] → sin aviso; respaldo de 2 min (antes 30 s). Mitigación: métrica de eventos sin conexión destino y, si aparece, normalizar nombres en el reparto legado.
- [Bundle más grande / fallo de `ws` en el `.exe`] → prueba del `.exe` en una PC limpia antes del release; si el `require('ws')` falla, el CLI registra el error y sigue sin canal.
- [Muchos CLIs reconectando a la vez tras un release] → jitter del backoff.

## Migration Plan

1. Implementar y probar contra el gateway de dev con `ANA_API_URL`/`ANA_REALTIME_URL` de dev.
2. Release (versión siguiente a 1.0.47) a un agente piloto; observar `ActiveConnections{client=cli}` y que sus asignaciones arrancan en < 3 s.
3. Liberar a la flota por autoupdate. Rollback: `realtimeEnabled=false` (todos vuelven a 30 s) o `ANA_REALTIME=off` en un equipo; release anterior si `ws` diera problemas.
