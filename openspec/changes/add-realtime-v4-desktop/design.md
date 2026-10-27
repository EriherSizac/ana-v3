# Design

## Context

- Contrato del canal, catálogo de eventos, backoff común y actualización forzada: `add-realtime-gateway` (spec `v4/realtime-gateway`, design D8–D10 y D12).
- `JobPoller.loop()` duerme `POLL_INTERVAL_MS = 5000` entre consultas (2 s si no hay token o hay envío en curso). `RemoteSettings` refresca cada `SETTINGS_REFRESH_MS = 5 min`. Ambos usan `authFetch` del `TokenBroker`, que pide el token al renderer (Amplify) y lo renueva antes de vencer (`MIN_TTL_MS`).
- `/me` se lee en dos lugares: el main (`Backend.me()` para `replyGate`, permiso de respuesta manual) y el renderer (`App.tsx`, pestañas por permisos).
- `API_BASE` sale de `ANA_API_BASE` con default de prod en `main.ts`. Valores de build: `scripts/write-build-config.mjs` escribe `dist-electron/build-config.json`, que el main lee al arrancar.
- Electron 38 = Node 22: `WebSocket` global (undici) acepta subprotocolos; no hace falta `ws`.

## Goals / Non-Goals

**Goals:** asignación visible en < 3 s tras el reparto; cambios de configuración en < 3 s; cambios de permisos aplicados en segundos cuando el servidor fuerza la actualización; ~96 % menos consultas `/jobs/poll` con el canal activo; comportamiento idéntico al actual si el canal falla o no está configurado.

**Non-Goals:** UI de estado del canal (solo log); exponer el socket al renderer.

## Decisions

- **D1. El socket vive en el main, no en el renderer.** El main ya tiene el token, el poller y la configuración; el renderer queda igual (sigue recibiendo `onAssignment`) y solo se le avisa por IPC cuando debe releer `/me`. Alternativa: socket en el renderer con Amplify: duplicaría el disparo de consultas hacia el main por IPC y se cortaría al recargar la ventana.
- **D2. `RealtimeClient` independiente y testeable.** Clase con dependencias inyectadas (`WebSocket`, temporizadores, `getFreshToken`, reloj, aleatorio) que emite `onState(active|inactive)`, `onEvent(evt)` y `onRefresh(reason)`; `main.ts` la cablea: `jobs.changed` → `poller.pollNow()`, `settings.changed/desktop` → `remoteSettings.refreshNow()`, `active` → intervalos lentos + `pollNow()` + `refreshNow()`, `inactive` → intervalos rápidos, `refresh` → relectura de acceso (D7).
- **D3. Intervalo variable en el poller, no un poller nuevo.** `JobPoller` recibe `intervalMs: () => number` y `pollNow()` despierta el `sleep` en curso (promesa cancelable); si hay envío en curso marca `dirty` y consulta al terminar el lote, respetando la regla actual de no consultar durante el envío. `RemoteSettings` recibe lo mismo. Así el comportamiento con canal inactivo es literalmente el de hoy.
- **D4. Coalescencia de 1 s.** Un reparto grande produce un evento por operador, pero reasignaciones y acks pueden encadenar varios; una ventana de 1 s evita consultas repetidas sin retraso perceptible.
- **D5. Make-before-break.** Para la reconexión planeada (110 min o token nuevo detectado comparando el token que devuelve `getFreshToken` con el usado al conectar), se abre la conexión nueva y se cierra la vieja tras su `pong`; durante el traslape pueden llegar eventos duplicados, que la coalescencia absorbe.
- **D6. URL y flags.** URL: `ANA_REALTIME_URL` del entorno o `realtimeUrl` de `build-config.json` (lo escribe `write-build-config.mjs` desde `ANA_REALTIME_URL` al compilar, con la URL execute-api de prod; no hay dominio propio). Sin URL válida (`wss://`), el cliente no se crea: polling de hoy. `ANA_REALTIME=off` (local, para una PC problemática) y el interruptor del servidor llevan al estado inactivo = intervalos actuales.
- **D7. Actualización forzada.** Al recibir `session.refresh`, el `RealtimeClient` cierra con 4001, emite `onRefresh(reason)` y agenda la reconexión con una espera aleatoria de 0–10 s que no incrementa el backoff. `main.ts` entonces relee `GET /me` del main (`replyGate`), envía `access:refresh` al renderer (que vuelve a leer `GET /me` y recalcula pestañas) y pide `pollNow()` + `refreshNow()`. Si el servidor cierra sin `session.refresh`, se sigue el backoff normal y la lectura al reconectar.

## Risks / Trade-offs

- [Evento perdido con canal activo] → el respaldo de 2 min lo recupera (aceptado por el usuario); el reparto ya tarda minutos en enviarse por el ritmo anti-bloqueo.
- [Socket "zombie" (abierto sin tráfico real)] → `pong` con timeout de 30 s lo detecta en máximo 5 min + 30 s; mientras tanto el respaldo de 2 min sigue corriendo.
- [Desktops viejos] → siguen con 5 s; no hay cambio de contrato.
- [Release a toda la flota sin piloto] → el interruptor del servidor devuelve a todos al polling en ≤ 5 min sin release; `ANA_REALTIME=off` para una PC.

## Migration Plan

1. Implementar y probar contra el canal de dev con un build de dev (`ANA_REALTIME_URL` de dev).
2. Release prod vía autoupdate a toda la flota con `ANA_REALTIME_URL` de prod embebida; observar `ActiveConnections{client=desktop}` y la caída de invocaciones de `jobsPoll`, con el interruptor listo.
3. Rollback: `realtimeEnabled=false` en el servidor (todos los desktops vuelven a 5 s) o `ANA_REALTIME=off` en una PC.
