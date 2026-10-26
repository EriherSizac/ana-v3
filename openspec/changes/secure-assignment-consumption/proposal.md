# Proposal

## Why

Las tres lecturas `GET /supervisors/...` exponen sin `X-Admin-Key` los CSV de contactos de cobranza de cualquier agente (listos para el CLI y pendientes de asignación): basta conocer agente y campaña, valores cortos y adivinables (p. ej. `erick`/`prueba`). El resto de rutas de supervisor ya exige la llave desde el commit 9a36660; estas quedaron abiertas en F1.4 de `PLAN_SEGURIDAD_Y_DEUDA.md` porque no se podía descartar un consumidor externo. A diferencia de las rutas del CLI, cerrarlas no requiere un release de la flota: ningún cliente del repo (CLI v3, `v3/app`, v4) las llama.

> Alcance revisado: la versión anterior de este cambio también emitía un token HMAC desde `POST /auth/verify` (palabra del día) para proteger `GET /get/chats`. Esa parte se reemplaza por el login con Cognito y la autorización por roster de `migrate-cli-to-cognito-login`, que protege `GET /get/chats` y las demás rutas del CLI. Este cambio queda limitado a las lecturas de supervisor y se puede desplegar de inmediato.

## What Changes

- **BREAKING** (para quien las use sin llave): `GET /supervisors/agents/{agent}/{campaign}/contacts`, `GET /supervisors/assignments/agents/{agent}/{campaign}` y `GET /supervisors/assignments/agents/{agent}/{campaign}/contacts` exigen `X-Admin-Key` con la misma validación que las demás rutas de supervisor (401 sin llave o incorrecta, 503 sin llave configurada), antes de acceder a S3. Se confirma en CloudWatch antes de desplegar que no hay consumidores no identificados.
- Suite mínima de pruebas (vitest) en `v3/ana-backend` para las tres rutas, si otro cambio no la agregó ya.
- Documentación de supervisores con el header en las tres consultas.

Fuera de alcance: autenticación de agente en `GET /get/chats` y demás rutas del CLI (ver `migrate-cli-to-cognito-login`), la semántica consume-once y los logs con filas de contactos en `getChats`.

## Capabilities

### New Capabilities

_Ninguna._

### Modified Capabilities

- `v3/agent-assignments`: las tres consultas `GET /supervisors/...` exigen `X-Admin-Key`.
- `v3/backend-api-security`: las tres consultas salen de la lista de rutas públicas y se agrega el requisito de llave para ellas.

## Impact

- Backend: `src/handlers/supervisors.ts` (`getAgentContacts`, `listAgentAssignments`, `getAgentAssignments`), reutilizando `src/lib/adminAuth.ts`. Sin variables nuevas.
- CLI: sin cambios ni release.
- Supervisores/herramientas: deben enviar `X-Admin-Key` en estas consultas (`setup-campaign.sh` ya lo hará con `fix-setup-campaign-admin-key`).
- Orden de archivo: este cambio debe archivarse antes que `migrate-cli-to-cognito-login`, que vuelve a modificar "Rutas intencionalmente públicas" partiendo de esta versión.
- Documentación: `v3/ana-backend/README.md`, `README-SUPERVISORES.md`, `PLAN_SEGURIDAD_Y_DEUDA.md` (cierre parcial de F1.4).
