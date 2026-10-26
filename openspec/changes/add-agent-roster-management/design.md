# Design

## Context

- Base: `add-admin-web-foundation` (BFF con verificación de id token, acceso vía v4 `GET /me`, shell y componentes).
- v3 hoy: pertenencia a campaña = filas de `agents/{campaign}/credentials.csv` (`v3/campaign-credentials`, `v3/agent-auth`); rutas admin con `X-Admin-Key` (`src/lib/adminAuth.ts`). S3 puro, sin base de datos; Lambda con permisos sobre todo el bucket `ana-backend-storage-{stage}`.
- `migrate-cli-to-cognito-login` (en curso, otro autor) consume `v3/agent-roster`: valida el token del CLI (authorizer `cognitoAgentJwt`, audiencias `COGNITO_AGENT_CLIENT_IDS`), exige agente = `cognito:username` en minúsculas, lee el roster con caché ≤ 60 s (objeto inexistente = sin agentes; error de lectura = `roster_error`), y expone `GET /agent/campaigns` (campañas donde el agente está habilitado).
- v4 hoy: tabla `ana-backend-agents-{stage}` (PK `campaign`, SK `operatorId`, `lastSeen`) escrita con `PutCommand` en el heartbeat (sobrescribe el ítem completo); reparto `distribute` con agentes elegibles de la API del Dashboard (`lib/dashboard.ts`); `assignments` con pesos firmados en metadata del presign.

## Goals / Non-Goals

**Goals:**
- Contrato de roster v3 estable y simple de leer por otros componentes (CLI change, carga de contactos).
- Una sola pantalla para ambas flotas, con el usuario del pool como eje.

**Non-Goals:**
- Que deshabilitar en v4 corte el acceso del desktop (lo gobierna la API de Roles; aquí solo afecta el reparto).
- Sincronización automática roster ← API de Roles (la habilitación es una decisión explícita del supervisor).
- Retirar `credentials.csv`/`/auth/verify`/`/credentials/*` (lo hace `migrate-cli-to-cognito-login`).

## Decisions

### D1. Roster v3 = un JSON por campaña en `rosters/{campaign}.json`
Forma y reglas en `specs/v3/agent-roster/spec.md`. Mapa `agents` por username (búsqueda O(1), sin duplicados); deshabilitados se conservan para auditoría.
- Fuera de `agents/` para no interferir con `/get/chats` y los listados por prefijo de agente, y para que el prefijo `rosters/` liste exactamente las campañas (lo usa `GET /agent/campaigns`: `ListObjectsV2` de `rosters/` + lectura de cada objeto, cacheado).
- Alternativa: `agents/{campaign}/roster.json` junto a `credentials.csv` — descartada por mezclar con archivos que el CLI consume por prefijo.
- Alternativa: un único `rosters.json` global — descartada: contención de escritura entre campañas y objeto creciente.
- Alternativa: DynamoDB en v3 — descartada: v3 es S3 puro; agregar tabla cambia la operación del stack por un dato pequeño.

### D2. Escrituras condicionales de S3
Lectura con ETag → `PutObject` con `If-Match: <etag>` (o `If-None-Match: *` al crear); ante 412/409 se relee y reintenta hasta 3 veces. Requiere SDK `@aws-sdk/client-s3` reciente (soporta `IfMatch`/`IfNoneMatch` en `PutObject`); se actualiza la dependencia en v3.
- Alternativa: último escritor gana — descartada: dos supervisores editando a la vez perderían cambios.

### D3. Authorizer `cognitoAdminJwt` separado del de agentes
Mismo emisor, audiencias distintas: `COGNITO_ADMIN_CLIENT_IDS` para `/admin/*` y `COGNITO_AGENT_CLIENT_IDS` (client `ana-v3-cli`, de la otra change) para rutas de agente. Así un token del CLI no entra a rutas de administración aunque el agente tenga permisos, y viceversa. Si la otra change ya declaró `httpApi.authorizers`, se agrega una entrada más en el mismo bloque.
- **Decisión**: `COGNITO_ADMIN_CLIENT_IDS` = `1r6niimhkl2fmias6kk85n4ou4`, el App Client compartido que usan ANA Admin y v4 (`add-admin-web-foundation` D2). Consecuencia aceptada: un token del desktop v4 también pasa el authorizer de `/admin/*`; no amplía privilegios porque la autorización se decide por usuario con v4 `GET /me` (D4), igual que en el BFF.
- Alternativa: Lambda authorizer que valide token y permisos — descartada: el authorizer JWT nativo es gratuito y sin código; los permisos se resuelven en el handler (D4).

### D4. Autorización v3 vía v4 `GET /me` (decisión aceptada)
Se acepta que `/admin/*` de v3 dependa de v4 `GET /me` para autorizar (fail-closed 503 si v4 no responde). Helper `requireAdminAccess(event, { permission, campaign })` en `src/lib/adminAccess.ts`: toma el bearer ya validado por API Gateway, llama a `${ANA_V4_API_BASE}/me` (timeout 5 s), cachea por username 60 s en memoria del contenedor y decide con los arrays (no con `can()`). Misma fuente que el BFF (foundation D5).
- Alternativa: v3 llama a la API de Roles directo — descartada: duplica reglas (líder, denies, `roleperms` en DynamoDB de us-east-2).
- Alternativa: el BFF firma la decisión y v3 confía — descartada: convierte al BFF en superusuario con secreto compartido; una fuga del secreto daría acceso total.

### D5. Permiso `ana:admin:agents:manage`
Se agrega a `ANA_PERMISSIONS` (v4) como `AGENTS_MANAGE`; `resolveUserAccess` lo añade a líderes junto a upload/distribute; admins lo reciben por tener todo el catálogo. Alcance: campañas del usuario (o `*`), igual que `jobsAdmin.canManageCampaign`.
- Alternativa: reutilizar `ana:team:jobs:manage` — descartada: mezcla reasignar trabajo con decidir quién es agente.

### D6. Habilitación v4 en la tabla `agents` existente
Atributos `enabled`, `enabledUpdatedAt`, `enabledUpdatedBy` en la misma entrada `(campaign, operatorId)`. El heartbeat pasa a `UpdateCommand SET lastSeen` (crea si no existe, no toca los demás). "Campaña gestionada" = existe al menos una entrada con `enabled` definido (Query por campaña, filtrado en memoria; volúmenes de decenas). En gestionadas, `getEligibleAgents(campaign)` ∩ habilitados; `assignments` valida destinatarios.
- Alternativa: tabla nueva de habilitación — descartada: duplicaría la PK que ya existe y obligaría a unir dos tablas en cada reparto.
- Alternativa: no tocar v4 y que ANA Admin guarde la habilitación v4 — descartada: ANA Admin no tiene almacenamiento propio y el desktop/presign no la verían.
- Por qué "gestionada" y no aplicar a todas: aplicar el filtro siempre dejaría sin reparto a todas las campañas actuales hasta que alguien dé de alta agentes.

### D7. Identificadores: v3 en minúsculas, v4 tal cual
v3 normaliza (contrato acordado con la CLI change). v4 usa `cognito:username` tal como lo emite el pool porque ya es su `operatorId` en jobs, conversaciones y roster. ANA Admin toma el username canónico de `ListUsers` para v4 y su versión normalizada para v3; si un username del pool tiene mayúsculas, la UI lo muestra igual y cada flota recibe su forma.

### D8. Listado de usuarios en el BFF
`ListUsers` completo (páginas de 60) con credenciales del rol de cómputo del hosting (`cognito-idp:ListUsers` solo sobre el ARN del pool) y API de Roles `GET /users` (roles de todos los usuarios), ambos cacheados 5 min en memoria del servidor; búsqueda, filtros y paginación de 50 en el BFF. Detalle de un usuario con `GET /users/{username}`. El estado por flota se obtiene por campaña: v3 `GET /admin/campaigns/{c}/roster` y v4 `GET /admin/agent-roster?campaign=c`, en paralelo.
- Alternativa: filtro de `ListUsers` por prefijo en cada búsqueda — descartada: solo admite prefijo sobre un atributo y no permite unir con roles.
- Alternativa: listar solo usuarios de la API de Roles — descartada: el pool es la fuente de usuarios y hay usuarios sin roles todavía.

### D9. BFF de agentes
- `GET /api/users?search=&page=&campaign=&filters=` → usuarios + roles + estado por flota de la campaña.
- `POST /api/campaigns/{campaign}/agents` `{fleet: "v3"|"v4", agents:[{username, enabled}]}` → valida existencia y `enabled` en Cognito (409), alcance de campaña, y llama a v3 o v4 con el token del usuario. Acciones de ambas flotas = dos llamadas desde el cliente para reportar el resultado por flota.

### D10. Siembra desde `credentials.csv`
`scripts/seed-rosters-from-credentials.ts` (v3): lista `agents/*/credentials.csv`, normaliza campaña/usuario, cruza con `ListUsers` del pool y, en `--apply`, escribe/mezcla `rosters/{campaign}.json` con `updatedBy: "migration"`. Dry-run por defecto con reporte: campañas, usuarios emparejados, sin usuario en el pool, campañas que no existen en el catálogo de v4. Corre después del renombrado (D11): recibe el mapeo (`--renames`), omite las campañas origen y se niega a escribir un roster de una campaña fuera del catálogo. Como los usernames del pool no coinciden con los `agent_id` legados (`migrate-cli-to-cognito-login` D3), se espera que la mayoría salga "sin usuario en el pool": esos agentes se habilitan a mano en ANA Admin con su username real.

### D11. Renombrado de campañas v3 al nombre del catálogo de v4
Las campañas v3 cuyo nombre no está en el catálogo PostgreSQL de v4 se **renombran en v3** al nombre del catálogo (no se agregan al catálogo). Script `scripts/rename-campaigns.ts`:
1. Entrada: archivo de mapeo `campaign-renames.json` `{"<vieja>":"<nueva>"}` con nombres normalizados, preparado a partir del reporte de la siembra en dry-run y **revisado por una persona** contra el catálogo. El script rechaza mapeos encadenados (una nueva que es vieja de otra), destinos no normalizados y orígenes inexistentes.
2. Prefijos por campaña: `agents/{c}/`, `assignments/agents/{c}/`, `rosters/{c}.json`, `backups/{c}/`, `media/{c}/`, `historic/agents/{c}/`, `uploads/{c}/`, `review/{c}/` (de `report-pending-progress`, si existe) y `chats/{agent}-{c}.csv` (sufijo del nombre; si un archivo coincide con más de un origen se reporta como ambiguo y no se copia).
3. `CopyObject` a la llave con el nombre nuevo **sin sobrescribir**: destino existente con mismo tamaño y ETag = ya copiado (las corridas son repetibles); distinto = conflicto reportado. Las asignaciones listas (`agents/{c}/{agent}-contacts-*`) solo se copian con `--include-ready`, igual que en `fix-campaign-case-normalization`, para no duplicar envíos mientras CLIs viejos aún consumen del nombre viejo.
4. Verifica por prefijo que el conteo de destino ≥ origen; dry-run por defecto, `--apply` para copiar y `--delete-source` (solo tras una verificación sin diferencias) para borrar el prefijo viejo. Nunca imprime contenidos.
- **Orden**: (a) `fix-campaign-case-normalization` desplegado y su migración aplicada; el renombrado opera sobre nombres ya normalizados y aborta si encuentra una llave con mayúsculas de un origen sin su copia normalizada (los originales inertes que deja esa migración solo se reportan); (b) primera pasada `--apply` del renombrado; (c) siembra de rosters; (d) release del CLI con Cognito; (e) con el modo estricto activo (ya nadie escribe en el nombre viejo) segunda pasada `--apply` y `--delete-source`, antes de la purga de datos legados de `migrate-cli-to-cognito-login`.
- Alternativa: fusionar el renombrado en la migración de mayúsculas. Descartada: aquella es un cambio de bug ya acotado (`agents/` y `assignments/agents/`, sin borrar) y el renombrado necesita revisión humana, más prefijos y borrado; se ejecutan en secuencia.
- Alternativa: agregar las campañas v3 al catálogo. Descartada por decisión del usuario.

## Risks / Trade-offs

- [v3 depende de v4 para autorizar `/admin/*`] → fail-closed 503; afecta solo administración, no a agentes.
- [Usernames del CSV viejo no coinciden con el pool (`erick` vs `erick.silva`), caso esperado] → el reporte de la siembra los lista para habilitación manual en ANA Admin antes del release del CLI.
- [Nombres de campaña v3 distintos del catálogo PostgreSQL] → se renombran en v3 (D11); el selector de ANA Admin solo ofrece campañas del catálogo (`GET /api/campaigns`).
- [Mapeo de renombrado erróneo mezcla datos de dos campañas] → revisión humana del mapeo, copia sin sobrescribir con conflictos reportados y borrado del origen solo con `--delete-source` tras verificar conteos.
- [Cambio de comportamiento del reparto v4 en campañas gestionadas] → solo se activa al primer cambio hecho desde ANA Admin; la UI avisa al gestionar por primera vez una campaña v4.
- [Caché de 5 min del directorio] → un usuario recién creado tarda hasta 5 min en aparecer; botón "Actualizar" que invalida la caché.
- [Límite de `ListObjectsV2` de 1000 objetos en `rosters/`] → hay decenas de campañas; se pagina de todos modos en los lectores.

## Migration Plan

1. v4: desplegar permiso, heartbeat con `UpdateCommand`, rutas `/admin/agent-roster` y filtro de reparto (sin campañas gestionadas el comportamiento no cambia).
2. v3: desplegar authorizer `cognitoAdminJwt`, rutas `/admin/campaigns/{campaign}/roster*` y variables (`COGNITO_ADMIN_CLIENT_IDS=1r6niimhkl2fmias6kk85n4ou4`, `ANA_V4_API_BASE`). Aditivo: el CLI instalado no se entera.
3. Con `fix-campaign-case-normalization` ya aplicado: siembra en dry-run contra prod para detectar campañas fuera del catálogo, preparar y revisar `campaign-renames.json`, renombrado en dry-run y `--apply` (D11), y luego siembra con `--renames` en dry-run y `--apply`. El `--delete-source` del renombrado se ejecuta después del modo estricto de `migrate-cli-to-cognito-login`.
4. Desplegar ANA Admin con la sección Agentes; los supervisores completan altas faltantes.
5. `migrate-cli-to-cognito-login` publica el CLI que usa el roster.
6. Retiro de `X-Admin-Key`: las rutas `/supervisors/*`, `/agents/{agent}/{campaign}/contacts` y `POST /templates` siguen con llave hasta que (a) ANA Admin cubra carga de contactos (`add-contact-upload-console`) y plantillas, (b) `setup-campaign.sh` deje de usarse, y (c) los logs muestren 30 días sin llamadas con `X-Admin-Key`; entonces una change dedicada las retira o migra a `/admin/*`. Las de `/credentials/*` las retira `migrate-cli-to-cognito-login`.
- Rollback: v3 y v4 son aditivos; quitar funciones nuevas con redeploy. En v4, borrar el atributo `enabled` de una campaña la devuelve a "no gestionada".

## Open Questions

_Ninguna._ (Client de `/admin/*` en D3, dependencia de v4 `GET /me` en D4 y renombrado de campañas en D11.)
