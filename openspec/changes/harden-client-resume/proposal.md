# Proposal

## Why

Incidente de producción 2026-10-29: la agente miranda.rios (CLI v3 1.0.48) conectó realtime a las 20:10:45 y nunca volvió a llamar `/get/chats`, así que sus asignaciones publicadas no se enviaron. La causa raíz (la espera de poll esperaba al widget de estado vía `page.evaluate` en cada tick y se congelaba) ya se corrigió en 1b93c15. Además los agentes suspenden sus PCs (pausas), por lo que el CLI v3 y el desktop v4 MUST sobrevivir a suspensión/reanudación y congelamientos largos sin intervención.

## What Changes

- **CLI v3** (`v3/cli-whatsapp/liveness.js`): detector de reanudación por salto de reloj (tick 5 s, brecha > 30 s), latido del loop principal (sin iteración > 3× el intervalo ⇒ reinicio seguro, nunca a mitad de envío; el diario de asignaciones retoma), helpers `withTimeout`/`boundedUi` para toda interacción Playwright no de envío y chequeo de salud de ventanas (`page.evaluate` con timeout ⇒ recarga o mensaje recuperable).
- Al reanudar: despertar la espera de poll, reconectar realtime con backoff reiniciado, refrescar en silencio el token Cognito si está por vencer, refrescar settings remotos y revisar ventanas de WhatsApp.
- **Realtime v3**: `reconnectNow()`; sin pong durante 2 heartbeats ⇒ reconexión.
- **Desktop v4** (`v4/desktop/electron/power/resume.ts`): `powerMonitor` `suspend`/`resume`/`unlock-screen` más detector de salto de reloj como respaldo; al reanudar: token vía `tokenBroker`, reconexión realtime, poll inmediato de jobs, `getState` de whatsapp-web.js con timeout (reinicio conservando sesión si estaba conectado y ya no) y heartbeat.

## Capabilities

### New Capabilities

- `v3/cli-liveness`: supervivencia del CLI a suspensión y congelamientos.
- `v4/desktop-power-resume`: recuperación del desktop v4 tras suspensión.

### Modified Capabilities

Ninguna.

## Impact

- CLI v3: `liveness.js` (nuevo, agregado a `build-portable.ps1`), `index.js`, `poll-wait.js`, `realtime.js`, pruebas `node --test`. Requiere release del CLI (bump desde 1.0.48) vía autoupdate.
- Desktop v4: `electron/power/resume.ts` (nuevo), `main.ts`, `realtime/client.ts`, `whatsapp/client.ts`, pruebas vitest. Requiere release del desktop (bump desde 1.4.0).
- Sin cambios de contrato del backend.
