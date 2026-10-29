# Proposal

## Why

Hoy todas las interacciones (gestiones) que el CLI v3 registra en el CRM usan un `user_id` fijo (`6898b89b-…`), así que en el CRM no se sabe qué agente hizo cada gestión ni que se registró desde ANA. La API de Roles de Pernexium (`GET {ROLES_API_BASE}/users/{username}`) devuelve el `user_id` y el nombre del agente; se asume que ese `user_id` es el usuario del CRM.

## What Changes

- Backend v3: `GET /agent/campaigns` agrega `crmUserId` y `displayName` del agente que llama, consultando directamente la API de Roles (variables nuevas `ROLES_API_BASE` con default y `ROLES_API_KEY` desde `.env`), con caché por username de 10 min y `null` ante cualquier fallo. Aditivo: los CLIs instalados ignoran los campos nuevos.
- CLI v3: guarda la identidad CRM en memoria tras `GET /agent/campaigns` (login y refrescos de acceso) y `insertInteractions` la aplica a todas las interacciones (envío automático, Gestión manual, monitor, registro "Consulta No Whatsapp"):
  - `user_id` = `crmUserId` del agente; sin él, el `user_id` legado con el sufijo `Agente: {username} ({name})` en `comments`.
  - Si el CRM rechaza el `user_id` del agente con 4xx, UN reintento con el legado + sufijo del agente.
  - `comments` siempre lleva la marca de ANA (`Registrado vía ANA` o ` | vía ANA`), sin duplicarla, dentro de un límite de 500 caracteres truncando solo el comentario original.
- Backend v4 (`lib/interactions.ts`, `GET /me`): mismo cambio, PENDIENTE (fuera de esta entrega por prioridad).

## Capabilities

### New Capabilities

_Ninguna._

### Modified Capabilities

- `v3/crm-interactions`: identidad del agente en `user_id`, fallback al legado y marca de ANA en `comments`.
- `v3/agent-auth`: `GET /agent/campaigns` expone la identidad CRM del agente.

## Impact

- Código: `v3/ana-backend/src/lib/agentIdentity.ts` (nuevo), `src/handlers/agent.ts`, `serverless.yml`, `.env.example`; `v3/cli-whatsapp/crm-identity.js` (nuevo), `agent-config.js`, `backend-client.js`, `agent-runtime.js`, `build-portable.ps1`.
- Despliegue: backend v3 (con `ROLES_API_KEY` en `.env`) antes del release del CLI. Un CLI nuevo contra un backend viejo usa el legado + sufijo del agente (compatible).
- Riesgo: si el `user_id` de Roles no existe en el CRM, el fallback mantiene el registro (un POST extra por interacción) con el agente identificable en `comments`.
