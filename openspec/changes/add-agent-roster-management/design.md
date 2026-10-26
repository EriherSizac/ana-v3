# Design

## Context

- Base: `add-admin-web-foundation` (BFF con verificación de id token, acceso vía v4 `GET /me`, shell y componentes).
- v3 hoy: pertenencia a campaña = filas de `agents/{campaign}/credentials.csv` (`v3/campaign-credentials`, `v3/agent-auth`); rutas admin con `X-Admin-Key` (`src/lib/adminAuth.ts`). S3 puro, sin base de datos; Lambda con permisos sobre todo el bucket `ana-backend-storage-{stage}`.
- `migrate-cli-to-cognito-login` (en curso, otro autor) consume `v3/agent-roster`: valida el token del CLI (authorizer `cognitoAgentJwt`, audiencias `COGNITO_AGENT_CLIENT_IDS`), exige agente = `cognito:username` en minúsculas, aplica la regla de habilitación con caché ≤ 60 s (error de lectura = `roster_error`) y expone `GET /agent/campaigns`.
- v4 hoy: `resolveUserAccess` (`v4/backend/src/lib/access.ts`) une permisos del almacén local rol→permisos (`rolePerms.ts`, tabla `ROLEPERMS_TABLE`, PK `ROLEPERMS`, SK `ROLE#<role_id>`) y permisos inline `ana:*` de `GET /users/{username}` (`roles.ts`, campos `role_id`/`role_name`/`campaign_name`, `permissions[].permission_name`; gotcha de `docs/sso-cognito-cookie-storage.md` §"Resolver permisos del usuario"). `listAllRoles` documenta que `GET /users` (listado) trae roles con forma `id`/`name`/`campaign`. `isLeaderRole` = `/lider/` sin acentos. `ana:campaign:message:send` ya existe en el catálogo (`CAMPAIGN_SEND`) y no está en `DEFAULT_PERMISSIONS`.
- v4 roster: tabla `ana-backend-agents-{stage}` (PK `campaign`, SK `operatorId`, `lastSeen`) escrita con `PutCommand` en el heartbeat; reparto `distribute` con elegibles de la API del Dashboard (`dashboard.ts`: `active`, sin correos internos `@pernexium.com.mx|@dirsa`, rol requerido opcional); `assignments` con pesos firmados en el presign.

## Goals / Non-Goals

**Goals:**
- "Los agentes son los usuarios con esos roles": la lista de agentes por campaña se deriva sola del pool y de la API de Roles; ya no hay alta manual.
- Contrato de roster v3 estable y simple de leer (autenticación del CLI, carga de contactos), y la misma lista para v4.
- Una sola pantalla para ambas flotas, con el usuario del pool como eje; el administrador solo decide excepciones.

**Non-Goals:**
- Asignar roles o permisos desde ANA Admin (se hace en la API de Roles y en la consola de permisos de v4).
- Que deshabilitar en v4 corte el acceso del desktop (lo gobierna la API de Roles; aquí solo afecta el reparto).
- Migrar agentes legados de `credentials.csv` al roster (ver D10).
- Retirar `credentials.csv`/`/auth/verify`/`/credentials/*` (lo hace `migrate-cli-to-cognito-login`).

## Decisions

### D1. Roster = lista derivada (automática) ∧ excepciones (manuales)
- `campaign-agents/{campaign}.json`: lista derivada, la escribe solo la sincronización (D12).
- `rosters/{campaign}.json` (`schemaVersion: 2`): solo excepciones por agente (`enabled`, autor, fecha). Un agente derivado sin excepción está habilitado; `enabled:false` lo deshabilita; `enabled:true` solo rehabilita. Un usuario que pierde el rol sale de la lista aunque tenga excepción (la excepción se conserva y se muestra como "sin efecto").
- Regla efectiva: derivado (lista vigente ≤ 24 h) ∧ no `enabled:false`. Forma exacta en `specs/v3/agent-roster/spec.md`.
- Dos objetos y no uno: escritores distintos (sincronización de v4 vs. rutas `/admin/*` de v3) sin contención ni riesgo de que una corrida pise una excepción; fuera de `agents/` para no interferir con `/get/chats`.
- `schemaVersion: 2` porque el significado cambia (antes "lista de habilitados"); ningún lector de la versión 1 llegó a producción.
- Alternativa: roster manual (versión anterior de este cambio). Descartada por decisión del usuario.
- Alternativa: calcular la pertenencia en cada solicitud del CLI (Roles API + almacén por usuario). Descartada: 2 polls/min por agente contra una API externa y DynamoDB en otra región; la lista precalculada se lee de S3 con caché de 60 s.

### D2. Escrituras condicionales de S3
Lectura con ETag → `PutObject` con `If-Match: <etag>` (o `If-None-Match: *` al crear); ante 412/409 se relee y reintenta hasta 3 veces. Requiere SDK `@aws-sdk/client-s3` reciente (soporta `IfMatch`/`IfNoneMatch` en `PutObject`); se actualiza la dependencia en v3. La sincronización escribe `campaign-agents/` con `PutObject` simple (único escritor).

### D3. Authorizer `cognitoAdminJwt` separado del de agentes
Mismo emisor, audiencias distintas: `COGNITO_ADMIN_CLIENT_IDS` para `/admin/*` y `COGNITO_AGENT_CLIENT_IDS` (client `ana-v3-cli`, de la otra change) para rutas de agente. Si la otra change ya declaró `httpApi.authorizers`, se agrega una entrada más en el mismo bloque.
- **Decisión**: `COGNITO_ADMIN_CLIENT_IDS` = `1r6niimhkl2fmias6kk85n4ou4`, el App Client compartido que usan ANA Admin y v4 (`add-admin-web-foundation` D2). Un token del desktop v4 también pasa el authorizer de `/admin/*`; no amplía privilegios porque la autorización se decide por usuario con v4 `GET /me` (D4).
- Alternativa: Lambda authorizer que valide token y permisos — descartada: el authorizer JWT nativo es gratuito y sin código.

### D4. Autorización v3 vía v4 `GET /me` (decisión aceptada)
`/admin/*` de v3 depende de v4 `GET /me` (fail-closed 503 si v4 no responde). Helper `requireAdminAccess(event, { permission, campaign })` en `src/lib/adminAccess.ts`: toma el bearer ya validado, llama a `${ANA_V4_API_BASE}/me` (timeout 5 s), cachea por username 60 s y decide con los arrays (no con `can()`).
- Alternativa: v3 llama a la API de Roles directo — descartada para autorización de administración: duplica reglas (líder, denies). La derivación de agentes (D11) sí usa la API de Roles, pero corre en v4, junto al código que ya la resuelve.

### D5. Permiso `ana:admin:agents:manage`
Se agrega a `ANA_PERMISSIONS` (v4) como `AGENTS_MANAGE`; `resolveUserAccess` lo añade a líderes junto a upload/distribute; admins lo reciben por tener todo el catálogo. Alcance: campañas del usuario (o `*`).

### D6. Excepciones v4 en la tabla `agents` existente y filtro con flag
Atributos `enabled`, `enabledUpdatedAt`, `enabledUpdatedBy` en la entrada `(campaign, operatorId)`. El heartbeat pasa a `UpdateCommand SET lastSeen`. Habilitado v4 = username normalizado en `campaign-agents/{campaign}.json` ∧ entrada sin `enabled:false`. v4 lee la lista del bucket de v3 (lectura `s3:GetObject` sobre `campaign-agents/*`, caché 60 s). El reparto automático usa elegibles del Dashboard ∩ habilitados y `assignments` valida destinatarios, ambos detrás de `AGENT_ROSTER_FILTER` (apagado al desplegar; se enciende cuando las listas derivadas coinciden con los agentes reales, Migration Plan paso 6).
- Se elimina el concepto de "campaña gestionada" de la versión anterior: con la lista derivada no hace falta que alguien dé de alta agentes para activar el filtro; el flag cubre la transición.
- Alternativa: tabla nueva de excepciones — descartada: duplicaría la PK existente.

### D7. Identificadores: v3 en minúsculas, v4 tal cual
v3 normaliza (contrato con la CLI change). v4 usa `cognito:username` tal como lo emite el pool (`operatorId` en jobs y conversaciones). La lista derivada guarda ambos (`username` normalizado y `cognitoUsername`) y v4 compara por la forma normalizada.

### D8. Listado de usuarios en el BFF
`ListUsers` completo (páginas de 60) con el rol de cómputo del hosting (`cognito-idp:ListUsers` solo sobre el ARN del pool) y API de Roles `GET /users`, cacheados 5 min; búsqueda, filtros y paginación de 50 en el BFF. El estado por flota se obtiene por campaña: v3 `GET /admin/campaigns/{c}/roster` y v4 `GET /admin/agent-roster?campaign=c`, en paralelo; ambos traen la lista derivada con su `generatedAt`.

### D9. BFF de agentes
- `GET /api/users?search=&page=&campaign=&filters=` → usuarios + roles + estado por flota.
- `POST /api/campaigns/{campaign}/agents` `{fleet: "v3"|"v4", agents:[{username, enabled}]}` → alcance de campaña y llamada a v3 o v4 con el token del usuario; el backend responde 409 si se intenta habilitar a quien no es agente. Acciones de ambas flotas = dos llamadas para reportar por flota.

### D10. Sin siembra desde `credentials.csv`
Decisión del usuario: los `agent_id` legados de `credentials.csv` no se trasladan. Los agentes salen solo de los roles (D11); un `agent_id` legado que coincida con un username del pool no se habilita por eso, solo si ese usuario tiene un rol de envío en la campaña. Los nombres legados se conservan solo como referencia del historial (`legacy/agents/{campaign}.json`, `migrate-cli-to-cognito-login` D12).

### D11. Derivación de agentes
Agente de X = usuario del pool con `Enabled` y estado `CONFIRMED` o `FORCE_CHANGE_PASSWORD` ∧ algún rol con `campaign_name` normalizado = X que otorga `ana:campaign:message:send`.
- **Estados**: `FORCE_CHANGE_PASSWORD` entra para poder asignar contactos antes del primer login; `UNCONFIRMED`, `RESET_REQUIRED`, `ARCHIVED`, `COMPROMISED` y `UNKNOWN` no.
- **Roles `*`**: no hacen agente (son admins/desarrolladores con alcance global; derivar agentes de todas las campañas los inundaría). Quien prueba el CLI (p. ej. en `prueba`) necesita un rol de esa campaña con envío.
- **Permiso por rol** (decisión del usuario: "por defecto todos los agentes tienen ese permiso"): los roles de agente se llaman "Agente <Campaña>". Nuevo `isAgentRole(name)` en `v4/backend/src/lib/permissions.ts`, con la misma normalización que `isLeaderRole` (NFD, sin diacríticos, minúsculas, `/agente/`). En `resolveUserAccess`, un usuario con rol de agente recibe `CAMPAIGN_SEND` por defecto, igual que el líder recibe sus capacidades por nombre; el deny `-ana:campaign:message:send` del rol lo quita. `DEFAULT_PERMISSIONS` no cambia, así que otros roles no ganan envío. Para la derivación cuenta solo un rol de agente con `campaign_name` = X sin deny; un rol sin "agente" en el nombre nunca deriva agentes aunque tenga el permiso explícito (líderes, calidad, admins). Con `PERMISSIONS_ENFORCED=false` no cambia el comportamiento actual del desktop.
- **Lectura**: `GET /users` (forma `id`/`name`/`campaign`, normalizada) para enumerar; `GET /users/{username}` (forma `role_id`/`role_name`/`campaign_name` con permisos inline) para cada usuario con algún rol de campaña distinta de `*`, concurrencia 5. Nunca `/roles/{id}/permissions`.
- **Correos internos**: no se excluyen. La pertenencia la decide el rol explícito con envío en la campaña, y el CLI se prueba con usuarios internos. El reparto automático v4 sigue excluyéndolos porque intersecta con los elegibles del Dashboard (D6); en las demás rutas un administrador puede deshabilitarlos.
- **Campañas**: catálogo PostgreSQL de v4 (`campaignsDb.ts`); se escribe una lista por campaña del catálogo, también vacía, para distinguir "sin agentes" de "nunca sincronizado".

### D12. Sincronización y fallos
Función programada en v4 (`syncCampaignAgents`, EventBridge cada 5 min, mismo stack que usa la API de Roles, el almacén de permisos y `ListUsers`).
- Corrida atómica: si falla cualquier lectura, no escribe nada y conserva las listas anteriores (los agentes conocidos siguen; nadie nuevo entra: fail-closed para altas). Tres fallos seguidos → alarma de CloudWatch.
- Vigencia: los lectores aceptan listas de ≤ 24 h; más antiguas = error de roster (fail-closed total). 24 h cubre un fin de semana corto de incidente sin cortar la operación diaria y limita cuánto tiempo conserva acceso alguien a quien se le quitó el rol.
- Propagación: cambio de rol ≤ 5 min + caché de lectores 60 s; excepción ≤ 60 s.
- IAM: `s3:PutObject` solo sobre `campaign-agents/*` del bucket de v3 (misma cuenta de AWS; si no, rol cruzado, tarea 1.3).
- Alternativa: sincronización en v3. Descartada: v3 necesitaría la llave de la API de Roles, lectura cross-region de la tabla de permisos y `ListUsers`, y duplicaría la lógica de permisos por rol.

### D13. Renombrado de campañas v3 al nombre del catálogo de v4
Las campañas v3 cuyo nombre no está en el catálogo PostgreSQL de v4 se **renombran en v3** al nombre del catálogo. Script `scripts/rename-campaigns.ts`:
1. Entrada: `campaign-renames.json` `{"<vieja>":"<nueva>"}` con nombres normalizados, preparado con el inventario del dry-run del propio script (campañas v3 fuera del catálogo) y **revisado por una persona**. Rechaza mapeos encadenados, destinos no normalizados y orígenes inexistentes.
2. Prefijos por campaña: `agents/{c}/` (incluido `credentials.csv`), `assignments/agents/{c}/`, `rosters/{c}.json`, `backups/{c}/`, `media/{c}/`, `historic/agents/{c}/`, `uploads/{c}/`, `review/{c}/` y `review-state/{c}/` (si existen) y `chats/{agent}-{c}.csv` (sufijo; coincidencia con más de un origen = ambiguo, no se copia). `campaign-agents/` no se renombra: la sincronización lo genera con nombres del catálogo.
3. `CopyObject` sin sobrescribir: destino igual (tamaño y ETag) = ya copiado; distinto = conflicto. `agents/{c}/{agent}-contacts-*` solo con `--include-ready`.
4. Verificación de conteos destino ≥ origen; dry-run por defecto, `--apply`, `--delete-source` solo tras verificación sin diferencias. Nunca imprime contenidos.
- **Orden**: (a) migración de `fix-campaign-case-normalization` aplicada; (b) primera pasada `--apply`; (c) release del CLI con Cognito; (d) con el modo estricto activo, segunda pasada `--apply` y `--delete-source`, antes de la purga de `migrate-cli-to-cognito-login` (D12 de ese cambio), que así encuentra `credentials.csv` e `historic/` ya con nombres del catálogo.

## Risks / Trade-offs

- [Rol de agente mal nombrado (sin "agente")] → sus usuarios no aparecen como agentes; la tarea 3.5 revisa las listas derivadas antes del release del CLI y se corrige renombrando el rol en la API de Roles.
- [Un nombre que contenga "agente" sin ser de agente (p. ej. "Coordinador de agentes")] → contaría como agente; se corrige con deny `-ana:campaign:message:send` en ese rol o deshabilitando al usuario en ANA Admin.
- [Agentes legados sin usuario o sin rol en el pool] → no se trasladan (D10); deben tener usuario y rol antes del release o quedan fuera.
- [API de Roles o Cognito caídos] → se conserva la última lista hasta 24 h; alarma a los 15 min (D12).
- [Usuario que pierde el rol conserva acceso hasta la siguiente corrida] → ≤ 5 min + 60 s; para cortes inmediatos, deshabilitar en ANA Admin (≤ 60 s) o en Cognito.
- [v3 depende de v4 para autorizar `/admin/*` y para la lista derivada] → fail-closed; afecta administración y, solo tras 24 h sin sincronizar, a los agentes.
- [Cambio del reparto v4] → detrás de `AGENT_ROSTER_FILTER`; se activa tras comparar listas derivadas con los elegibles del Dashboard.
- [Mapeo de renombrado erróneo mezcla datos de dos campañas] → revisión humana, copia sin sobrescribir y borrado solo con `--delete-source` tras verificar conteos.
- [Caché de 5 min del directorio en el BFF] → botón "Actualizar" que invalida la caché.

## Migration Plan

1. v4: desplegar permiso, heartbeat con `UpdateCommand`, rutas `/admin/agent-roster`, `syncCampaignAgents` (escribe listas desde el primer despliegue) y filtro con `AGENT_ROSTER_FILTER=false`.
2. v3: desplegar authorizer `cognitoAdminJwt`, rutas `/admin/campaigns/{campaign}/roster*` y variables (`COGNITO_ADMIN_CLIENT_IDS=1r6niimhkl2fmias6kk85n4ou4`, `ANA_V4_API_BASE`). Aditivo: el CLI instalado no se entera. Los rosters empiezan sin excepciones.
3. Con `fix-campaign-case-normalization` aplicado: renombrado en dry-run, revisión de `campaign-renames.json` y `--apply` (D13).
4. Checklist previo al release del CLI: por cada campaña activa, cada agente activo tiene usuario y un rol "Agente <Campaña>" (el envío ya es por defecto), y `campaign-agents/{c}.json` lista a los esperados.
5. Desplegar ANA Admin con la sección Agentes.
6. `migrate-cli-to-cognito-login` publica el CLI que usa la regla efectiva. Activar `AGENT_ROSTER_FILTER=true` en v4 tras comparar listas.
7. Retiro de `X-Admin-Key`: las rutas `/supervisors/*` (incluida `GET /supervisors/review/{campaign}` de `report-pending-progress`), `/agents/{agent}/{campaign}/contacts` y `POST /templates` siguen con llave hasta que (a) ANA Admin cubra carga de contactos y revisión (`add-contact-upload-console`, `link-review-contacts-to-uploads`) y plantillas, (b) `setup-campaign.sh` deje de usarse y (c) los logs muestren 30 días sin llamadas con llave; entonces una change dedicada las retira. Las de `/credentials/*` las retira `migrate-cli-to-cognito-login`.
- Rollback: v3 y v4 son aditivos; quitar funciones con redeploy; `AGENT_ROSTER_FILTER=false` devuelve el reparto v4 al comportamiento actual.

## Open Questions

_Ninguna._ (Client de `/admin/*` en D3, dependencia de v4 en D4, derivación en D11, fallos y vigencia en D12, renombrado en D13.)

## Decisiones de implementación

**v4 (`v4/backend`)**
- La sincronización usa un rol IAM propio (`SyncCampaignAgentsRole`, recurso nativo con `functions.syncCampaignAgents.role`, sin plugins). Es el único con `s3:PutObject` sobre `campaign-agents/*`; el rol compartido de las demás funciones solo tiene `s3:GetObject` ahí. Como `serverless package` exige login en Serverless v4, la política se verifica con una prueba que parsea `serverless.yml` (tarea 1.3 queda abierta hasta correr `serverless package` con credenciales).
- Bucket de v3: `V3_BUCKET` = `ana-backend-storage-${stage}` (override `--param="v3Bucket=..."`), con un cliente S3 dedicado en `V3_BUCKET_REGION` (default `us-east-1`).
- Un catálogo vacío cuenta como fallo de la corrida (no se escribe nada), igual que un error de PostgreSQL; el catálogo se lee con una consulta estricta y no con `listCampaignsDb` (que traga errores y sirve caché).
- Un error de escritura a mitad de la corrida se registra (`phase:"write"`) y se relanza; las listas ya escritas se quedan (cada una es independiente y válida).
- Antes de pedir `GET /users/{username}`, los candidatos se filtran por elegibilidad en el pool (Enabled + estado): ahorra llamadas sin cambiar el resultado.
- El envío por defecto del rol de agente se evalúa por rol: un deny en otro rol del mismo usuario no lo anula; un deny en ese mismo rol sí.
- Alarma: Errors ≥ 1 en 3 de 3 periodos de 5 min (`TreatMissingData: missing`), sin acción de notificación (falta definir el destino SNS).
- En `/admin/agent-roster` la autorización (403) se evalúa antes de validar body y catálogo; `operatorId` repetidos tras normalizar → 400; la excepción se guarda con el `operatorId` del pool cuando el usuario está en la lista derivada.
- `GET /admin/agent-roster` con lista ilegible o vencida responde 503 `roster no disponible` (el spec no fijaba código).
- Con `AGENT_ROSTER_FILTER` encendido, `csvTrigger` no revalida `assignments`; la validación ocurre en el presign, donde el spec la exige.

**v3 (`v3/ana-backend`)**
- Código en archivos nuevos (`src/lib/{identifiers,adminHttp,adminAccess,s3Json,roster}.ts`, `src/handlers/adminRoster.ts`) para no chocar con los cambios concurrentes; la normalización reutiliza `src/lib/campaign.ts` (`normalizeKeySegment`/`normalizePathSegment`) de `fix-campaign-case-normalization`.
- Orden de validación en `/admin/*`: campaña (400) → autorización vía v4 `/me` (401/403/503) → body (400) → S3. Así un usuario sin permiso no recibe detalles de validación.
- `requireAdminAccess(event, { permissions, campaign, check })`: `permissions` se exigen todos (admin los tiene); `check` permite reglas como rol Developer o admin/líder para las changes siguientes.
- El authorizer `cognitoAdminJwt` admite un solo client id por variable (`- ${env:COGNITO_ADMIN_CLIENT_IDS, '1r6niimhkl2fmias6kk85n4ou4'}`); para varios clients hay que agregar más entradas a la lista. Verificado con `serverless package` (Framework 3.40 local): solo las dos rutas `/admin/*` quedan con `AuthorizationType: JWT`, audiencia `1r6niimhkl2fmias6kk85n4ou4`, y las demás rutas no cambian.
- `@aws-sdk/client-s3` pasa a `^3.700.0` (el lock ya resolvía 3.952, con `IfMatch`/`IfNoneMatch`). Conflicto de escritura = `PreconditionFailed` (412) o `ConditionalRequestConflict` (409).
- `roster.ts` exporta además `getEnabledAgentsCached` (caché 60 s sin cachear errores) para la autenticación del CLI de `migrate-cli-to-cognito-login`.
- `scripts/rename-campaigns.ts`: `--catalog catalog.json` (lista de nombres del catálogo de v4) para el inventario de campañas fuera del catálogo; sin él se listan todas las campañas v3 con datos. Se rechazan además dos orígenes con el mismo destino. `--delete-source` solo borra orígenes cuya copia verificada es idéntica (tamaño + ETag), y nunca los contactos listos omitidos. Sale con código 2 si aborta o hay diferencias.
- Documentación agregada al final de `README.md` y `README-SUPERVISORES.md` (para minimizar conflictos); la verificación con `curl` contra dev queda pendiente (tarea 3.7).

**ANA Admin**
- Los clientes de roster de ambas flotas viven en un solo archivo `src/server/backends/rosters.ts` (en lugar de `v3Roster.ts`/`v4Roster.ts`), con una forma normalizada común.
- Listado: roles por `GET /users` (D8, caché 5 min) y detalle por usuario con `GET /api/users/{username}` → `GET /users/{username}` (permisos inline), en un `Dialog` de solo lectura.
- Filtros en pills con valores `<flota>:<estado>` (`v3:agent`, `v4:disabled`, …); un usuario coincide si cumple cualquiera.
- Acciones masivas: por flota se envían solo los seleccionados a los que la acción aplica (deshabilitar = estado "Agente", rehabilitar = "Deshabilitado"); el resto cuenta como "omitidos" en el resumen. Máximo 100 por llamada (límite de v4).
- `/api/users` lista todo el pool a cualquier usuario con `ana:admin:agents:manage` (también líderes); el estado por flota solo se calcula para campañas en su alcance.
