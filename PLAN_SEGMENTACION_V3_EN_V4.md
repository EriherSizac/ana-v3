# Plan: portar la segmentación de v3-cli a v4

> Alcance acordado: (A) reparto de contactos por agente, (B) envío en tandas, (C) registro de interacciones al CRM. Generado 2026-06-10.

---

## Estado actual (qué ya existe en v4)

| Pieza | v3-cli | v4 hoy |
|---|---|---|
| Reparto | Supervisor sube CSV por agente a `assignments/agents/{campaign}/{agent}-contacts-{ts}.csv`; agente lo consume (consume-once) y reporta pendientes | `csvTrigger` con `distribute=1`: round-robin ciego entre agentes activos (`getEligibleAgents`) al momento de subir el CSV. Sin visibilidad ni control del supervisor sobre quién recibió qué |
| Ritmo de envío | Ráfaga: N mensajes (`PAUSE_AFTER_MESSAGES`) → pausa 20 min con overlay bloqueante; delay aleatorio 30–120s entre contactos | Goteo: máx 7 msgs/20 min, gap fijo ≥2 min ([poller.ts](v4/desktop/electron/jobs/poller.ts)). Sin pausa-bloque, sin delays aleatorios, sin overlay |
| Interacciones CRM | Tras cada envío: `insertInteractions` al API de interactions, lookup de `credit_id` vía `/client-info`, `PATCH /phone` si no tiene WhatsApp ([index.js:463-645](v3/cli-whatsapp/index.js#L463-L645), [agent-config.js](v3/cli-whatsapp/agent-config.js)) | Nada. Solo `PUT /messages` a DynamoDB |

---

## Workstream A — Reparto por agente (segmentación supervisada)

**Objetivo**: que el líder/supervisor suba un CSV maestro y controle/vea cómo se segmenta entre sus agentes, con posibilidad de reasignar pendientes. Hoy el round-robin es invisible e irreversible.

### Backend (`v4/backend`)

1. **GSI en tabla `jobs`**: `campaignId-index` (PK=`campaignId`, SK=`operatorId`). Hoy la PK es `operatorId` → imposible consultar "todos los jobs de la campaña X" sin scan. Cambio en `serverless.yml`.
2. **`csvTrigger.ts`**: además de round-robin, soportar `meta.assignments` (JSON `{operatorId: porcentaje|count}` firmado en el presign) para reparto explícito. Mantener round-robin como default cuando `distribute=1` sin assignments.
3. **Nuevos endpoints** en `handlers/api.ts`:
   - `GET /campaigns/{id}/jobs/summary` → conteo pending/sent/failed por `operatorId` (usa el GSI). Permiso `ana:team:jobs:read`.
   - `POST /jobs/reassign` → mueve jobs pending de un `operatorId` a otro(s) (delete+put, la PK cambia). Permiso `ana:team:jobs:manage`. Cubre el caso "agente se desconectó a media campaña" — el equivalente al consume-once + `updatePendingContacts` de v3.
4. **Preview de segmentación**: `POST /uploads/presign` ya recibe la config; agregar respuesta con roster activo (`listActiveAgents`) para que la UI muestre "se repartirá entre estos N agentes" **antes** de subir.

### Desktop (`v4/desktop`)

5. **Vista de equipo / admin**: tabla por campaña con columnas agente / pendientes / enviados / fallidos (consume `GET /campaigns/{id}/jobs/summary`), botón "reasignar pendientes" con selector de agente destino.
6. **Upload de CSV (líder)**: checkbox "repartir entre agentes" ya implícito (`distribute`); agregar editor de pesos por agente (manda `assignments` en metadata del presign).

---

## Workstream B — Envío en tandas (modo ráfaga de v3)

**Objetivo**: replicar el ritmo de v3-cli — tanda de N mensajes con delays aleatorios, luego pausa larga bloqueante — como modo configurable, sin perder el modo goteo actual.

### Desktop (`v4/desktop/electron/jobs/poller.ts`)

1. **Parametrizar `JobPoller`** con un objeto `PacingConfig`:
   ```ts
   interface PacingConfig {
     mode: 'drip' | 'batch';
     batchSize: number;        // v3: PAUSE_AFTER_MESSAGES
     pauseMs: number;          // v3: 20 min
     delayMinMs: number;       // v3: 30s
     delayMaxMs: number;       // v3: 120s (distribución con pico 60-80s)
     maxPerWindow: number;     // drip actual: 7
     windowMs: number;         // drip actual: 20 min
     minGapMs: number;         // drip actual: 2 min
   }
   ```
   En modo `batch`: reemplazar `rateLimitWait` por delay aleatorio entre jobs + contador `sentSinceLastPause`; al llegar a `batchSize`, nueva fase de progreso `paused` con countdown.
2. **Config viene del backend, no hardcodeada**: nuevo `GET /config/pacing` (por campaña u operador, almacenado en DynamoDB o env). Así el supervisor ajusta el ritmo de toda la flota sin redeploy del desktop — v3 tenía esto en constantes del exe y cada cambio era rebuild.
3. **Overlay bloqueante durante pausa** (paridad con `setPauseBlocker` de v3): el renderer escucha la fase `paused` vía IPC (`onProgress` ya existe) y muestra overlay a pantalla completa con countdown; bloquear también el chat manual de envíos salientes masivos durante la pausa (los replies manuales siguen permitidos, igual que la ventana manual de v3).

### Backend

4. Tabla o item de config `pacing` (puede vivir en `roleperms` con SK `CONFIG#pacing#{campaign}` para no crear tabla nueva) + endpoint de lectura y `PUT` admin (`ana:admin:pacing:manage`).

---

## Workstream C — Registro de interacciones CRM

**Objetivo**: cada envío (o intento) queda registrado en el CRM de Pernexium como en v3: interacción outbound con subdictamen, y marcado de teléfonos sin WhatsApp.

**Decisión de diseño**: en v3 el CLI llama directo al API de interactions con **API key hardcodeada en el código** ([agent-config.js:56](v3/cli-whatsapp/agent-config.js#L56) — además quedó commiteada; rotarla). En v4 esto debe ir **en el backend Lambda**, nunca en el desktop: la key vive en env/Secrets Manager y el desktop solo manda el resultado del envío con su JWT.

### Backend (`v4/backend`)

1. **Nuevo `lib/interactions.ts`**: cliente del API de interactions (`https://7uj0qjoby9...`):
   - `searchClientInfoByPhone(campaign, phoneE164)` → `credit_id` (con el retry sin prefijo `+52` que v3 ya descubrió necesario)
   - `insertInteraction(payload)` (mismo shape que v3: subdictamen, contact_date/time, range_time, action_channel, contactable, etc.)
   - `markPhoneNoWhatsapp(creditId, campaign, phone10)` → `PATCH /phone`
   - API key desde `process.env.INTERACTIONS_API_KEY` (Secrets Manager / SSM en `serverless.yml`)
2. **Nuevo endpoint `POST /interactions/report`**: el desktop lo llama tras cada `runJob` con `{jobId, campaignId, phone, status: 'sent'|'no_whatsapp'|'error', creditId?}`. El Lambda:
   - resuelve `credit_id` (del row del CSV si venía, si no lookup por teléfono — misma cascada que v3)
   - inserta la interacción (`subdictamen` = "Se envía WhatsApp" / "No tiene Whatsapp")
   - si `no_whatsapp`: ejecuta el PATCH de teléfono
   - idempotencia por `jobId` (condición en DynamoDB o atributo `reported` en el job) para que un retry del desktop no duplique interacciones en el CRM
3. **`user_id` del CRM**: v3 usa `INTERACTIONS_USER_ID` fijo; en v4 mapear `operatorId` (claim Cognito) → user del CRM. Si no existe mapeo aún, tabla pequeña o atributo en roster `agents`.

### Desktop

4. **Detección `no_whatsapp`**: con whatsapp-web.js usar `client.isRegisteredUser(phone)` antes de enviar (v3 lo infería del DOM con Playwright — en v4 es una llamada directa, más confiable). El resultado alimenta `POST /interactions/report`.
5. **`runJob`**: tras enviar (o fallar), fire-and-forget al endpoint de report con reintento simple; no bloquear el ritmo de envío por fallos del CRM (v3 tampoco lo hacía — solo logueaba).

---

## Orden de implementación sugerido

| Fase | Qué | Por qué primero |
|---|---|---|
| 1 | C1–C2 (interactions en backend) + C4–C5 (report desde desktop) | Valor operativo inmediato; no toca el modelo de jobs; el CRM deja de quedarse ciego con cada campaña v4 |
| 2 | B1–B3 (pacing configurable + overlay) | Cambio contenido en poller + renderer; desbloquea operar v4 con el ritmo probado de v3 |
| 3 | A1–A4 (GSI + summary + reassign) | Requiere migración de tabla (GSI) y permisos nuevos |
| 4 | A5–A6 (UI de equipo) + B4 (config remota de pacing) | UI sobre los endpoints de fase 3 |

## Riesgos / pendientes

- **Rotar la API key de interactions**: está en texto plano en el historial de git de v3 (`agent-config.js`). Rotarla antes de fase 1 y cargarla solo como secret.
- **GSI sobre tabla `jobs` con TTL**: los items expirados pueden aparecer brevemente en el GSI; filtrar por `ttl > now` en el summary.
- **Reasignación vs lease**: `POST /jobs/reassign` debe respetar `leaseUntil` (no mover un job que un agente tiene en lease activo).
- **`PERMISSIONS_ENFORCED` sigue apagado** en v4 (pendiente documentado): los permisos nuevos (`ana:team:jobs:*`, `ana:admin:pacing:manage`) quedan definidos pero no harán enforcement hasta activarlo.
- **Paridad de plantillas**: v3 soporta expresiones matemáticas (`{{credit*0.9}}`) en `message-utils.js`; verificar si `template.ts` de v4 las necesita al migrar campañas (fuera de alcance de este plan, pero saldrá al portar campañas reales).
