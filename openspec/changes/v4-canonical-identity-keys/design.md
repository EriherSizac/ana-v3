# Design

## Context

- `claimUser` devuelve `cognito:username ?? sub` sin transformar; las tablas usan ese valor como PK. `api.ts` construye `safeUser = user.replace(/[^\w.\-]/g, '_')` para `media/`, `wa-sessions/` y `csv-uploads/`; `presignMediaGet` toma `key.split('/')[1]` y lo compara con `access.username`.
- `getEligibleAgents` devuelve `username ?? user_id` del Dashboard; `assignments` acepta cualquier string; `csvTrigger` escribe `operatorId: targets[i % n]` tal cual.
- Comparaciones de campaña con `includes` exacto en `api.ts`, `agents.ts`, `jobsAdmin.ts`; `campaignExists` compara exacto contra `SELECT name FROM campaigns`.
- `cognito:username` en un pool con `CaseSensitive: false` conserva la grafía con la que se creó el usuario, pero dos usuarios no pueden diferir solo en mayúsculas; con `CaseSensitive: true` sí podrían.

## Goals / Non-Goals

**Goals:** un solo identificador por persona en todo v4; llaves S3 sin colisiones; campañas que coinciden aunque cambien mayúsculas.

**Non-Goals:** renombrar campañas del catálogo; tocar la API de Roles o el Dashboard.

## Decisions

- **D1. Canónico = `trim().toLowerCase()`** del claim. Precondición verificada por la migración: el pool tiene `UsernameConfiguration.CaseSensitive = false` (o, si es `true`, que no existan dos usuarios iguales en minúsculas). Alternativa: conservar la grafía del pool y canonizar solo los destinatarios con `AdminGetUser`; se descarta por la llamada extra por destinatario y porque deja el problema en cada comparación futura.
- **D2. Codificación de segmento.** `encodeKeySegment(id)`: por cada byte UTF-8, si es `[a-z0-9._-]` se conserva, si no `~` + hex en minúsculas; el segmento `.` o `..` se codifica completo. Es inyectiva porque `~` siempre inicia un escape y nunca aparece literal. `decodeKeySegment` invierte y rechaza escapes inválidos (→ `null` → 400 `key inválida`). El nombre local de RemoteAuth (solo admite `[\w-]`) conserva su regla actual aplicada al canónico: es solo el nombre de una carpeta local y el aislamiento entre operadores de la misma PC lo da `.ana-last-operator` (comparado con el canónico), que borra la sesión local cuando entra otro operador. Alternativa: hash del canónico; se descarta porque cambiaría el nombre local de todos los equipos y forzaría una restauración desde S3 en toda la flota.
- **D3. Destinatarios.** `canonicalOperatorId` sobre cada destinatario; `assignments` se agregan por id canónico sumando pesos; lista elegible deduplicada.
- **D4. Campañas.** `resolveCatalogCampaign(input)`: busca en el catálogo por `trim().toLowerCase()` y devuelve la grafía del catálogo; si el catálogo no está disponible, `trim()` del valor recibido. `sameCampaign(a, b)` para permisos. `access.campaigns` se deduplica sin distinguir mayúsculas y se resuelve al catálogo cuando hay coincidencia. El CRM recibe la grafía del catálogo.
- **D5. Migración (`scripts/migrate-canonical-ids.ts`).** Pasos, con `--dry-run` por defecto y `--apply` explícito:
  1. Precheck: `DescribeUserPool` (`CaseSensitive`), `ListUsers` → usuarios afectados (claim ≠ canónico o `safeUser` ≠ `encodeKeySegment`) y colisiones (dos usuarios con el mismo canónico o el mismo `safeUser`). Colisión → abortar.
  2. DynamoDB: para cada afectado, copiar (sin sobrescribir; en conversaciones conservar el `lastMessageTime` mayor) conversaciones, mensajes (`convKey` nuevo, `mediaKey` reescrito), jobs y marcadores (`REPORT#`, `OPEN#`, `MANUAL#`), roster `agents`; vaciar `accesscache` (TTL corto, se recalcula).
  3. S3: copiar `media/<safe>/…`, `wa-sessions/<safe>/session.zip`, `csv-uploads/<safe>/…` a la llave codificada.
  4. Reporte de conteos por usuario. `--delete-source` en una corrida posterior, tras verificación.
- **D6. Ventana de transición.** Orden: (a) migración `--apply` con el código viejo en producción; (b) deploy del código nuevo; (c) segunda corrida `--apply` (copia lo escrito entre a y b; idempotente); (d) release del desktop; (e) `--delete-source` tras una semana. Mientras tanto, `GET /media/url` acepta también el segmento legado (`safeUser` de la grafía original, comparado sin distinguir mayúsculas) solo si el precheck no encontró colisiones; se retira en (e).

## Risks / Trade-offs

- [Pool con `CaseSensitive: true` y usuarios que difieren en mayúsculas] → La migración aborta; se resuelve con quien administra el pool antes de continuar (Open Questions).
- [Escrituras entre (a) y (b)] → Cubiertas por la corrida (c); los mensajes son inmutables y el resto es idempotente.
- [El roster derivado de `add-agent-roster-management` compara usernames normalizados pero guarda la grafía del pool] → Con este cambio la entrada del roster v4 usa el canónico; si ese cambio se aplica antes, su tarea de escritura del roster debe usar `canonicalOperatorId` (se coordina en su PR; si ya está archivado, este cambio agrega el delta correspondiente a `v4/agent-roster`).

## Migration Plan

Ver D5/D6. Rollback: antes de (e), redeploy del código anterior; las llaves viejas siguen intactas.

## Open Questions

- Valor real de `UsernameConfiguration.CaseSensitive` del pool `us-east-2_UepfOyKpd` y si hay usernames con caracteres fuera de `[a-z0-9._-]`; lo responde el precheck en dry-run y no cambia el diseño salvo que haya colisiones.
