# Proposal

## Why

Los usuarios ya existen en el pool de Cognito compartido de Pernexium y sus roles/campañas en la API de Roles, pero en ANA el alta de agentes sigue siendo manual: en v3 un supervisor mantiene a mano `agents/{campaign}/credentials.csv` con palabras del día (rutas `/credentials/*` con `X-Admin-Key`, `setup-campaign.sh`), y en v4 no existe forma de decidir qué agentes de una campaña reciben contactos más allá de la API del Dashboard. Con el CLI v3 migrando a login Cognito (`migrate-cli-to-cognito-login`), hace falta que "agente de una campaña" signifique "usuario con un rol de esa campaña que permite enviar mensajes", calculado solo, con una forma de que un administrador excluya a alguien.

## What Changes

- **Agentes derivados de roles**: agente de la campaña X = usuario habilitado del pool (`CONFIRMED` o `FORCE_CHANGE_PASSWORD`) con al menos un rol de la API de Roles cuyo `campaign_name` es X y que otorga `ana:campaign:message:send` (catálogo local de permisos de v4 por `role_id` o permisos inline). Roles `*` y líderes sin ese permiso no son agentes. Ya no hay alta manual.
- v4 (`v4/backend`): sincronización programada cada 5 minutos que calcula la lista por campaña del catálogo y la escribe en el bucket de v3 (`campaign-agents/{campaign}.json`); si falla, conserva la última lista (vigente hasta 24 h) y alarma.
- v3 (`v3/ana-backend`): roster por campaña `rosters/{campaign}.json` que solo guarda excepciones (deshabilitaciones con autor y fecha); regla efectiva = derivado ∧ no deshabilitado (contrato `v3/agent-roster` que consume `migrate-cli-to-cognito-login`); rutas `GET /admin/campaigns/{campaign}/roster` y `POST /admin/campaigns/{campaign}/roster/agents`.
- v3: nuevo authorizer JWT de HTTP API (pool `us-east-2_UepfOyKpd`, audiencias de ANA Admin) para todas las rutas `/admin/*`, y autorización por permisos ANA resuelta con v4 `GET /me`. `X-Admin-Key` no es aceptada en `/admin/*`.
- v3: script de renombrado de campañas (dry-run por defecto) que copia todos los prefijos de una campaña v3 fuera del catálogo de v4 al nombre del catálogo, con mapeo revisado por una persona y borrado del origen solo con flag explícito.
- **Sin siembra**: los agentes legados de `credentials.csv` no se trasladan; los rosters empiezan sin excepciones. Los nombres legados quedan solo como referencia del historial (`migrate-cli-to-cognito-login`).
- Nueva sección "Agentes" en ANA Admin: usuarios del pool con roles y campañas, estado de agente por campaña y flota (agente, deshabilitado, no es agente), deshabilitar/rehabilitar individual o masivo con confirmación. No crea usuarios, no resetea contraseñas ni asigna roles.
- v4: permiso `ana:admin:agents:manage`; excepciones en la tabla de roster existente (`agents`) con rutas `GET/POST /admin/agent-roster`; el heartbeat deja de sobrescribirlas; con `AGENT_ROSTER_FILTER` activo, el reparto y los `assignments` del presign solo usan agentes habilitados.
- **BREAKING (v4, comportamiento, tras activar el flag)**: el reparto automático excluye a usuarios activos en el Dashboard que no tienen rol de envío en la campaña o están deshabilitados.

Fuera de alcance: retirar `credentials.csv`, `/auth/verify` y `/credentials/*` (lo hace `migrate-cli-to-cognito-login`), asignar roles o permisos desde ANA Admin, bloquear el acceso del desktop v4 a agentes deshabilitados.

## Capabilities

### New Capabilities

- `admin-web/agent-management`: listado de usuarios del pool con roles/campañas, estado de agente derivado y excepciones por campaña y flota desde ANA Admin.
- `v3/agent-roster`: definición de agente por roles, lista derivada, excepciones, regla efectiva y rutas de administración en v3.
- `v4/agent-roster`: permiso de gestión, sincronización de agentes derivados, excepciones en v4 y su efecto en el reparto.

### Modified Capabilities

- `v3/backend-api-security`: se agregan la autenticación Cognito (authorizer JWT) y la autorización por permisos ANA de las rutas `/admin/*`.

## Impact

- Depende de `add-admin-web-foundation`. La consumen `migrate-cli-to-cognito-login` (regla efectiva), `add-contact-upload-console` (agentes habilitados) y `link-review-contacts-to-uploads`.
- admin-web: páginas `/agentes`, rutas BFF `/api/users`, `/api/campaigns/{campaign}/agents`; `@aws-sdk/client-cognito-identity-provider`; IAM del hosting con `cognito-idp:ListUsers` sobre el ARN del pool.
- v3 backend: `serverless.yml` (authorizer `cognitoAdminJwt`, variables `COGNITO_ADMIN_CLIENT_IDS`, `ANA_V4_API_BASE`), `src/handlers/adminRoster.ts`, `src/lib/{roster,identifiers,adminAccess}.ts`, `scripts/rename-campaigns.ts`, pruebas vitest.
- v4 backend: `src/lib/{permissions,access,agents}.ts`, nuevo `src/lib/campaignAgents.ts` y `src/handlers/syncCampaignAgents.ts` (EventBridge, `cognito-idp:ListUsers`, `s3:PutObject` en `campaign-agents/*` y `s3:GetObject` del bucket de v3), `src/handlers/agents.ts`, `api.ts`, `csvTrigger.ts`, `serverless.yml`.
- Datos: `campaign-agents/*.json` y `rosters/*.json` en `ana-backend-storage-prod`; atributos nuevos en `ana-backend-agents-{stage}`.
- Operación: antes del release del CLI con Cognito, los roles de agente de cada campaña activa deben otorgar `ana:campaign:message:send` y cada agente activo debe tener usuario y rol. Orden: migración de `fix-campaign-case-normalization` → renombrado; el borrado de prefijos viejos va después del modo estricto de `migrate-cli-to-cognito-login` y antes de su purga de datos legados.
