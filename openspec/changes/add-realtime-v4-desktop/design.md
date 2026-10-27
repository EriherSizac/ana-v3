# Design

## Context

- Contrato del canal, catálogo de eventos y backoff común: `add-realtime-gateway` (spec `v4/realtime-gateway`, design D8–D10).
- `JobPoller.loop()` duerme `POLL_INTERVAL_MS = 5000` entre consultas (2 s si no hay token o hay envío en curso). `RemoteSettings` refresca cada `SETTINGS_REFRESH_MS = 5 min`. Ambos usan `authFetch` del `TokenBroker`, que pide el token al renderer (Amplify) y lo renueva antes de vencer (`MIN_TTL_MS`).
- `API_BASE` sale de `ANA_API_BASE` con default de prod en `main.ts`; misma convención para la URL realtime.
- Electron 38 = Node 22: `WebSocket` global (undici) acepta subprotocolos; no hace falta `ws`.

## Goals / Non-Goals

**Goals:** asignación visible en < 3 s tras el reparto; cambios de configuración en < 3 s; ~96 % menos consultas `/jobs/poll` con el canal activo; comportamiento idéntico al actual si el canal falla.

**Non-Goals:** UI de estado del canal (solo log); exponer el socket al renderer.

## Decisions

- **D1. El socket vive en el main, no en el renderer.** El main ya tiene el token, el poller y la configuración; el renderer queda igual (sigue recibiendo `onAssignment`). Alternativa: socket en el renderer con Amplify: duplicaría el disparo de consultas hacia el main por IPC y se cortaría al recargar la ventana.
- **D2. `RealtimeClient` independiente y testeable.** Clase con dependencias inyectadas (`WebSocket`, temporizadores, `getFreshToken`, reloj) que emite `onState(active|inactive)` y `onEvent(evt)`; `main.ts` la cablea: `jobs.changed` → `poller.pollNow()`, `settings.changed/desktop` → `remoteSettings.refreshNow()`, `active` → intervalos lentos + `pollNow()` + `refreshNow()`, `inactive` → intervalos rápidos.
- **D3. Intervalo variable en el poller, no un poller nuevo.** `JobPoller` recibe `intervalMs: () => number` y `pollNow()` despierta el `sleep` en curso (promesa cancelable); si hay envío en curso marca `dirty` y consulta al terminar el lote, respetando la regla actual de no consultar durante el envío. `RemoteSettings` recibe lo mismo. Así el comportamiento con canal inactivo es literalmente el de hoy.
- **D4. Coalescencia de 1 s.** Un reparto grande produce un evento por operador, pero reasignaciones y acks pueden encadenar varios; una ventana de 1 s evita consultas repetidas sin retraso perceptible.
- **D5. Make-before-break.** Para la reconexión planeada (110 min o token nuevo detectado comparando el token que devuelve `getFreshToken` con el usado al conectar), se abre la conexión nueva y se cierra la vieja tras su `pong`; durante el traslape pueden llegar eventos duplicados, que la coalescencia absorbe.
- **D6. Flags.** `ANA_REALTIME=off` (local, para una PC problemática) y el interruptor del servidor; ambos llevan al estado inactivo = intervalos actuales. URL: `ANA_REALTIME_URL` con default de prod embebido en el build, como `ANA_API_BASE`.

## Risks / Trade-offs

- [Evento perdido con canal activo] → el respaldo de 2 min lo recupera; peor caso igual al objetivo previo de "aparece en el siguiente ciclo" pero con 2 min en vez de 5 s. Se acepta porque el reparto ya tarda minutos en enviarse por el ritmo anti-bloqueo.
- [Socket "zombie" (abierto sin tráfico real)] → `pong` con timeout de 30 s lo detecta en máximo 5 min + 30 s; mientras tanto el respaldo de 2 min sigue corriendo.
- [Desktops viejos] → siguen con 5 s; no hay cambio de contrato.

## Migration Plan

1. Implementar con el canal de dev; piloto en una PC con build de dev.
2. Release prod vía autoupdate; observar `ActiveConnections{client=desktop}` y la caída de invocaciones de `jobsPoll`.
3. Rollback: `realtimeEnabled=false` en el servidor (todos los desktops vuelven a 5 s) o `ANA_REALTIME=off` en una PC.
