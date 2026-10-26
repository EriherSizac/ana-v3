# Design

## Context

- `src/lib/auth.ts` llama `pushTokenToMain()` solo tras `signIn`/`confirmSignIn` y al arrancar; `main.ts` guarda `authToken` en una variable y `Backend`, `JobPoller` y `WaClient.configure` la leen con `() => authToken`.
- Amplify v6 renueva tokens con el refresh token cuando se llama `fetchAuthSession()` (y con `forceRefresh: true`); el main no tiene Amplify.
- `main.ts` envía heartbeat si `wa.isReady()`, que es `!!this.client`: verdadero también durante QR.
- `UpdateGate.tsx` llama `window.ana.checkUpdates()` al montar; `ipcMain.handle('update:check')` ejecuta `setupUpdater` en cada llamada (nuevos `autoUpdater.on(...)` y otro `setInterval`).
- `autoUpdater.on('update-downloaded')` instala a los 500 ms sin mirar al poller.

## Goals / Non-Goals

**Goals:** token vigente en el main mientras el operador tenga sesión renovable; errores de sesión visibles; presencia que refleje capacidad real de enviar; actualización imposible de saltar y que no corte un envío.

**Non-Goals:** cambiar el almacenamiento de Amplify; renovar sin renderer (el main no tendrá Amplify ni el refresh token).

## Decisions

- **D1. El renderer es el dueño de la renovación.** Un temporizador en el renderer lee `exp` del ID token y programa `fetchAuthSession({ forceRefresh: true })` 5 minutos antes; tras renovar, `setAuthToken(token)` al main. Alternativa: pasar el refresh token al main y renovar ahí con la API de Cognito; se descarta para no duplicar el manejo de secretos ni sacar el refresh token del renderer.
- **D2. Broker de token en el main.** Módulo puro `tokenBroker` con `getFreshToken()`: si al token le quedan ≥ 2 min lo devuelve; si no, emite `auth:token-request` al renderer y espera `auth:provide-token` hasta 10 s (una sola solicitud en vuelo compartida). `Backend`, `JobPoller` y el `s3Store` de WhatsApp usan `getFreshToken()` y, ante 401, llaman `broker.invalidate()` + un reintento. `auth:set-token` con token no nulo de otro operador sigue el flujo actual de cambio de usuario; con el mismo operador solo reemplaza el token (no reinicia poller ni WhatsApp).
- **D3. Sesión expirada ≠ logout.** Si el renderer no logra renovar (`fetchAuthSession` sin tokens o error `NotAuthorizedException`), envía `setAuthToken(null, { reason: 'expired' })`: el main detiene poller y heartbeat y emite `auth:expired`, pero **no** llama `wa.logoutLocal()`; el renderer muestra el login con el aviso. Si entra otro operador, el flujo existente de `.ana-last-operator` borra la sesión local.
- **D4. Heartbeat condicionado a `connected`.** Se usa el último estado emitido por `WaClient` (`getState().status === 'connected'`) en `agent:register`, en el intervalo de 5 min y en la transición a `connected`.
- **D5. Updater de una sola instancia.** `setupUpdater` guarda un flag de módulo; llamadas posteriores solo re-emiten el último estado conocido al renderer (para que una recarga vea la fase actual). El intervalo de 30 min se crea una vez.
- **D6. Sin bypass.** En build instalado, fase `error` muestra "No se pudo verificar la actualización", el mensaje, "Reintentar" y cuenta regresiva de 60 s para reintentar solo. Los errores 404/`latest.yml` siguen como `none` (no hay canal publicado). En dev no cambia nada.
- **D7. Instalación diferida.** `JobPoller` expone `pauseNewJobs()` y `waitIdle(timeoutMs)`. En `update-downloaded`: `pauseNewJobs()`, emitir `installing` con `waitingForJob: true` si hay job en curso, `await waitIdle(180_000)`, luego `wa.stop()` y `quitAndInstall`. El job en curso termina con su ack; lo que no empezó queda `pending` en el backend.

## Risks / Trade-offs

- [Feed S3 caído deja a toda la flota fuera] → Solo errores distintos de 404; S3 tiene alta disponibilidad; se documenta en el runbook cómo publicar de nuevo `latest.yml`. Ver Open Questions.
- [El renderer está suspendido (equipo en reposo) y no renueva a tiempo] → El broker del main pide token al reanudar en el primer uso y el 401 dispara reintento; el peor caso es una llamada fallida reintentada.
- [Un job tarda más de 3 min (WhatsApp colgado)] → Se instala igual; ese job queda en el estado que defina `v4-review-interrupted-sends` (por revisar), no se reenvía.

## Migration Plan

Release del desktop por el feed: los equipos instalados toman la versión en el siguiente chequeo (≤ 30 min). No hay cambios de backend. Rollback: publicar la versión anterior con un número de versión mayor.

## Open Questions

- Si negocio necesita una salida de emergencia ante una caída prolongada del feed (por ejemplo, permitir saltar la actualización tras N reintentos); hoy se elimina por completo. No cambia el resto del diseño.
