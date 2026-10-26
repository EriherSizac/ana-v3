# Proposal

## Why

Los usuarios ya existen en el pool de Cognito compartido de Pernexium y sus roles/campañas en la API de Roles, pero en ANA el alta de agentes sigue siendo manual: en v3 un supervisor mantiene a mano `agents/{campaign}/credentials.csv` con palabras del día (rutas `/credentials/*` con `X-Admin-Key`, `setup-campaign.sh`), y en v4 no existe forma de decidir qué agentes de una campaña reciben contactos más allá de la API del Dashboard. Con el CLI v3 migrando a login Cognito (`migrate-cli-to-cognito-login`), hace falta un roster de agentes habilitados por campaña, administrado desde ANA Admin y sincronizado con el pool, que reemplace al `credentials.csv`.

## What Changes

- Nueva sección "Agentes" en ANA Admin: lista los usuarios del pool (solo lectura: username, nombre, correo, estado en Cognito), sus roles y campañas de la API de Roles, y por campaña su estado de agente ANA en cada flota (v3 y v4); permite habilitar/deshabilitar uno o varios usuarios por campaña y flota, con confirmación. No crea usuarios ni resetea contraseñas.
- v3 (`v3/ana-backend`): roster por campaña en S3 `rosters/{campaign}.json` (contrato `v3/agent-roster` que consume `migrate-cli-to-cognito-login`), con rutas `GET /admin/campaigns/{campaign}/roster` y `POST /admin/campaigns/{campaign}/roster/agents`.
- v3: nuevo authorizer JWT de HTTP API (pool `us-east-2_UepfOyKpd`, audiencias de ANA Admin) para todas las rutas `/admin/*`, y autorización por permisos ANA resuelta con v4 `GET /me` usando el mismo token. `X-Admin-Key` no es aceptada en `/admin/*`; las rutas existentes con `X-Admin-Key` siguen igual hasta su retiro (plan en design.md).
- v3: script de migración (dry-run por defecto) que siembra los rosters desde los `credentials.csv` existentes, emparejando usuarios con el pool y reportando los que no existen.
- v3: script de renombrado de campañas (dry-run por defecto) que, antes de la siembra y con un mapeo revisado por una persona, copia todos los prefijos de una campaña v3 cuyo nombre no está en el catálogo de v4 al nombre del catálogo, verifica conteos y borra el prefijo viejo solo con un flag explícito. Las campañas no se agregan al catálogo.
- v4 (`v4/backend`): nuevo permiso `ana:admin:agents:manage` en el catálogo (líderes lo reciben para sus campañas, admins siempre); habilitación administrativa en la tabla de roster existente (`agents`) con rutas `GET /admin/agent-roster` y `POST /admin/agent-roster`; el heartbeat deja de sobrescribir la habilitación; en campañas con roster gestionado, el reparto (`distribute`) y los `assignments` del presign solo usan agentes habilitados.
- **BREAKING (v4, comportamiento)**: en una campaña donde se haya habilitado o deshabilitado a alguien desde ANA Admin, el reparto automático excluye a los agentes no habilitados aunque el Dashboard los marque activos. Campañas sin gestión no cambian.

Fuera de alcance: retirar `credentials.csv`, `/auth/verify` y `/credentials/*` (lo hace `migrate-cli-to-cognito-login`), cómo el CLI inicia sesión y cómo las rutas de agente validan el token contra el roster (también de esa change), bloquear el acceso del desktop v4 a agentes deshabilitados (lo gobierna la API de Roles).

## Capabilities

### New Capabilities

- `admin-web/agent-management`: listado de usuarios del pool con roles/campañas y habilitación de agentes por campaña y flota desde ANA Admin.
- `v3/agent-roster`: almacenamiento, contrato de lectura y rutas de administración del roster de agentes habilitados por campaña en v3.
- `v4/agent-roster`: permiso de gestión de agentes, habilitación administrativa por campaña en v4 y su efecto en el reparto de contactos.

### Modified Capabilities

- `v3/backend-api-security`: se agregan la autenticación Cognito (authorizer JWT) y la autorización por permisos ANA de las rutas `/admin/*`.

## Impact

- Depende de `add-admin-web-foundation` (shell, BFF, acceso vía v4 `/me`). La consume `migrate-cli-to-cognito-login` (contrato `v3/agent-roster`) y `add-contact-upload-console` (agentes habilitados).
- admin-web: páginas `/agentes`, rutas BFF `/api/users`, `/api/campaigns/{campaign}/agents`; dependencia `@aws-sdk/client-cognito-identity-provider`; IAM del hosting con `cognito-idp:ListUsers` sobre el ARN del pool.
- v3 backend: `serverless.yml` (authorizer `cognitoAdminJwt`, variables `COGNITO_ADMIN_CLIENT_IDS`, `ANA_V4_API_BASE`, funciones nuevas), nuevos `src/handlers/adminRoster.ts`, `src/lib/{roster,identifiers,adminAccess}.ts`, scripts `scripts/seed-rosters-from-credentials.ts` y `scripts/rename-campaigns.ts`, pruebas vitest (devDependencies).
- v4 backend: `src/lib/permissions.ts`, `src/lib/access.ts`, `src/lib/agents.ts`, `src/handlers/agents.ts` (rutas admin), `src/handlers/api.ts` (presign), `src/handlers/csvTrigger.ts`, `serverless.yml` (rutas nuevas).
- Datos: objetos nuevos `rosters/*.json` en `ana-backend-storage-prod`; atributos nuevos en `ana-backend-agents-{stage}`.
- Operación: renombrar campañas fuera del catálogo y dar de alta en el roster a los agentes antes del release del CLI con Cognito. Orden: migración de `fix-campaign-case-normalization` → renombrado → siembra; el borrado de prefijos viejos va después del modo estricto de `migrate-cli-to-cognito-login` y antes de su purga de datos legados.
