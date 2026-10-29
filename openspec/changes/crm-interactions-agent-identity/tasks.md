# Tasks

## 1. Backend v3

- [x] 1.1 `src/lib/agentIdentity.ts`: `GET {ROLES_API_BASE}/users/{username}` con `X-Api-Key`, caché de 10 min, nulls ante fallo
- [x] 1.2 `GET /agent/campaigns` agrega `crmUserId` y `displayName`
- [x] 1.3 `ROLES_API_BASE`/`ROLES_API_KEY` en `serverless.yml` y `.env.example` (sin valor)
- [x] 1.4 Pruebas vitest (éxito, caché, 404, red, user_id inválido, sin key, handler)

## 2. CLI v3

- [x] 2.1 `crm-identity.js`: identidad en memoria, marca de ANA, sufijo del agente, truncado y fallback
- [x] 2.2 `backend-client.js`/`agent-runtime.js`: `fetchAgentCampaigns` entrega la identidad (`onIdentity`)
- [x] 2.3 `insertInteractions` aplica identidad, marca y reintento con legado ante 4xx
- [x] 2.4 `crm-identity.js` en `$filesToCopy` de `build-portable.ps1`
- [x] 2.5 Pruebas `node --test` con fetch simulado (sin llamar al CRM real)

## 3. Backend v4 (pendiente)

- [ ] 3.1 `lib/roles.ts`: devolver `user_id`/`name` de `GET /users/{username}` con caché como el de acceso
- [ ] 3.2 `lib/interactions.ts`: `user_id` del agente en `/interactions/report`, `/open` y `/manual`, fallback a `INTERACTIONS_USER_ID` + sufijo y marca de ANA
- [ ] 3.3 `GET /me` expone `crmUserId` y `displayName` (aditivo) + pruebas vitest

## 4. Despliegue

- [ ] 4.1 Desplegar backend v3 con `ROLES_API_KEY` en `.env`
- [ ] 4.2 Validar con un agente piloto que el CRM acepta el `user_id` de Roles
- [ ] 4.3 Release del CLI
