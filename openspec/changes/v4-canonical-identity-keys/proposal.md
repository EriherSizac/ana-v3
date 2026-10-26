# Proposal

## Why

v4 usa el `cognito:username` tal como llega para particionar datos y lo **sanea** (cualquier carácter fuera de `[A-Za-z0-9_.-]` → `_`) para construir llaves de S3. Eso produce tres defectos del mismo tipo que `fix-campaign-case-normalization` corrige en v3:

- **Colisiones**: dos usuarios que solo difieren en caracteres saneados (por ejemplo `a@b` y `a_b`) comparten prefijo de media, carpeta de CSV y el **mismo `session.zip` de WhatsApp**: uno puede descargar y restaurar la sesión de WhatsApp del otro.
- **Dueño no reconocido**: `GET /media/url` compara el segmento saneado de la llave con el username sin sanear; un usuario con caracteres especiales no puede ver su propia media.
- **Mayúsculas**: el reparto toma usernames de la API del Dashboard (`username`/`user_id`) y de `assignments`, y las campañas de los roles, del catálogo de PostgreSQL y del body sin normalizar; `Ana.Lopez` vs `ana.lopez` o `DIDI_VIP` vs `didi_vip` dejan jobs en particiones que nadie consulta o rechazan con "campaña no permitida" a usuarios legítimos, siempre en silencio.

v4 no tiene datos heredados de otro esquema de identidad (siempre usó Cognito), así que no hay equivalente de `add-legacy-chat-history`; sí hay que migrar las llaves existentes de los usuarios afectados.

## What Changes

- **Identificador canónico de operador**: `cognito:username` (o `sub`) sin espacios laterales y en minúsculas, usado en todas las particiones (conversaciones, mensajes, jobs, roster, caché) y comparaciones.
- **Codificación inyectiva** del operador en llaves S3 (`media/`, `wa-sessions/`, `csv-uploads/`): caracteres `[a-z0-9._-]` se conservan y cualquier otro byte (incluido `~`) se escribe como `~` + dos dígitos hexadecimales; dos operadores distintos nunca comparten prefijo. El dueño de una llave se obtiene decodificando ese segmento.
- **Destinatarios canónicos** en el reparto: usernames del Dashboard y de `assignments` canonizados y deduplicados (pesos sumados).
- **Campañas sin distinguir mayúsculas**: toda comparación de campaña (roles, body, metadata, catálogo) se hace sin espacios laterales y sin distinguir mayúsculas, y se guarda/envía al CRM con la grafía del catálogo.
- **Migración única** (dry-run por defecto) que verifica que el pool de Cognito no distingue mayúsculas y que no hay colisiones, y copia ítems de DynamoDB y objetos de S3 de los usuarios afectados a sus llaves canónicas (reescribiendo `mediaKey`), sin borrar el origen hasta verificar.
- Desktop: nombre local de la sesión de WhatsApp y `.ana-last-operator` con el identificador canónico.
- **BREAKING** (datos): las particiones y llaves de usuarios con mayúsculas o caracteres especiales cambian; sin la migración, esos usuarios dejan de ver su historial y su sesión de WhatsApp.

Fuera de alcance: cambiar usernames en Cognito, el superadmin fijo por nombre (`v4-enforce-permissions` lo trata como pregunta abierta).

## Capabilities

### New Capabilities

_Ninguna._

### Modified Capabilities

- `v4/api-auth`: "Identidad del operador desde el token" usa el identificador canónico.
- `v4/media-and-session-storage`: se agrega la codificación del operador en llaves S3; la descarga de media decodifica el dueño.
- `v4/csv-ingestion`: borrado de CSV propio con el prefijo codificado; destinatarios canónicos y deduplicados.
- `v4/access-control`: campañas del usuario normalizadas; se agrega la comparación de campañas sin distinguir mayúsculas.

## Impact

- Backend: nuevo `v4/backend/src/lib/identity.ts` (`canonicalOperatorId`, `encodeKeySegment`/`decodeKeySegment`, `sameCampaign`, `resolveCatalogCampaign`), `src/lib/http.ts` (`claimUser`), `src/handlers/{api,agents,jobsAdmin,jobsPoll,interactions,csvTrigger,directSend}.ts`, `src/lib/{access,agents,dashboard,campaignsDb}.ts`; script `v4/backend/scripts/migrate-canonical-ids.ts`; pruebas vitest.
- Desktop: `electron/main.ts` (`usernameFromJwt`), `electron/whatsapp/client.ts` (`configure`).
- Datos: `ana-backend-{conversations,messages,jobs,agents,accesscache}-<stage>` y buckets `ana-backend-{media,csv}-<stage>` (solo usuarios afectados).
- Coordinación: `add-agent-roster-management` define `operatorId` "tal como lo emite el pool" en `v4/agent-roster`; con este cambio pasa a ser el identificador canónico (ver design.md).
