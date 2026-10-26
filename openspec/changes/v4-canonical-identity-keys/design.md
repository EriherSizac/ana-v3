# Design

## Context

- `claimUser` devuelve `cognito:username ?? sub` sin transformar; las tablas usan ese valor como PK. `api.ts` construye `safeUser = user.replace(/[^\w.\-]/g, '_')` para `media/`, `wa-sessions/` y `csv-uploads/`; `presignMediaGet` toma `key.split('/')[1]` y lo compara con `access.username`.
- `getEligibleAgents` devuelve `username ?? user_id` del Dashboard; `assignments` acepta cualquier string; `csvTrigger` escribe `operatorId: targets[i % n]` tal cual.
- Comparaciones de campaña con `includes` exacto en `api.ts`, `agents.ts`, `jobsAdmin.ts`; `campaignExists` compara exacto contra `SELECT name FROM campaigns`.
- Según el dueño del sistema, los usernames del pool `us-east-2_UepfOyKpd` están todos en minúsculas y el pool no distingue mayúsculas; las mayúsculas aparecen en fuentes externas (Dashboard, `assignments`, roles, catálogo), no en el claim.

## Goals / Non-Goals

**Goals:** un solo identificador por persona en todo v4; llaves S3 sin colisiones; campañas que coinciden aunque cambien mayúsculas.

**Non-Goals:** renombrar campañas del catálogo; tocar la API de Roles o el Dashboard.

## Decisions

- **D1. Canónico = `trim().toLowerCase()`** del claim. Como los usernames del pool ya están en minúsculas, para el claim es una operación idempotente y solo cambia valores que llegan de otras fuentes; la migración lo confirma de forma informativa. Alternativa: conservar la grafía del pool y canonizar solo los destinatarios con `AdminGetUser`; se descarta por la llamada extra por destinatario y porque deja el problema en cada comparación futura.
- **D2. Codificación de segmento.** `encodeKeySegment(id)`: por cada byte UTF-8, si es `[a-z0-9._-]` se conserva, si no `~` + hex en minúsculas; el segmento `.` o `..` se codifica completo. Es inyectiva porque `~` siempre inicia un escape y nunca aparece literal. `decodeKeySegment` invierte y rechaza escapes inválidos (→ `null` → 400 `key inválida`). El nombre local de RemoteAuth (solo admite `[\w-]`) conserva su regla actual aplicada al canónico: es solo el nombre de una carpeta local y el aislamiento entre operadores de la misma PC lo da `.ana-last-operator` (comparado con el canónico), que borra la sesión local cuando entra otro operador. Alternativa: hash del canónico; se descarta porque cambiaría el nombre local de todos los equipos y forzaría una restauración desde S3 en toda la flota.
- **D3. Destinatarios.** `canonicalOperatorId` sobre cada destinatario; `assignments` se agregan por id canónico sumando pesos; lista elegible deduplicada.
- **D4. Campañas.** `resolveCatalogCampaign(input)`: busca en el catálogo por `trim().toLowerCase()` y devuelve la grafía del catálogo; si el catálogo no está disponible, `trim()` del valor recibido. `sameCampaign(a, b)` para permisos. `access.campaigns` se deduplica sin distinguir mayúsculas y se resuelve al catálogo cuando hay coincidencia. El CRM recibe la grafía del catálogo.
- **D5. Migración (`scripts/migrate-canonical-ids.ts`).** Pasos, con `--dry-run` por defecto y `--apply` explícito:
  1. Precheck: `DescribeUserPool` (`CaseSensitive`), `ListUsers` → usuarios afectados (claim ≠ canónico o `safeUser` ≠ `encodeKeySegment`) y colisiones (dos usuarios con el mismo canónico o el mismo `safeUser`). Es una verificación informativa: se esperan 0 colisiones y 0 o pocos afectados; el reporte se adjunta al PR y, si apareciera alguna colisión, se revisa ese caso a mano antes de `--apply`.
  2. DynamoDB: para cada afectado, copiar (sin sobrescribir; en conversaciones conservar el `lastMessageTime` mayor) conversaciones, mensajes (`convKey` nuevo, `mediaKey` reescrito), jobs y marcadores (`REPORT#`, `OPEN#`, `MANUAL#`), roster `agents`; vaciar `accesscache` (TTL corto, se recalcula).
  3. S3: copiar `media/<safe>/…`, `wa-sessions/<safe>/session.zip`, `csv-uploads/<safe>/…` a la llave codificada.
  4. Reporte de conteos por usuario. `--delete-source` en una corrida posterior, tras verificación.
- **D6. Ventana de transición.** Orden: (a) migración `--apply` con el código viejo en producción; (b) deploy del código nuevo; (c) segunda corrida `--apply` (copia lo escrito entre a y b; idempotente); (d) release del desktop; (e) `--delete-source` tras una semana. Mientras tanto, `GET /media/url` acepta también el segmento legado (`safeUser` de la grafía original, comparado sin distinguir mayúsculas) solo si el precheck no encontró colisiones; se retira en (e).

## Risks / Trade-offs

- [Un username inesperado con mayúsculas o caracteres especiales] → Lo lista el reporte informativo del precheck; se migra como cualquier afectado.
- [Escrituras entre (a) y (b)] → Cubiertas por la corrida (c); los mensajes son inmutables y el resto es idempotente.
- Nota sobre `add-agent-roster-management`: su spec `v4/agent-roster` define el `operatorId` del roster como "el username de Cognito tal como lo emite el pool". Como los usernames del pool están en minúsculas, ese valor coincide con el identificador canónico de este cambio; no hay conflicto y no se edita ese cambio.

## Migration Plan

Ver D5/D6. Rollback: antes de (e), redeploy del código anterior; las llaves viejas siguen intactas.


## Decisiones de implementación

- **`decodeKeySegment` canónico:** además de rechazar escapes mal formados y UTF-8 inválido, rechaza formas alternativas (p. ej. `~61` en vez de `a`, o mayúsculas literales): solo existe una codificación por operador.
- **Import diferido del catálogo:** `identity.ts` no importa `pg` al cargarse; `resolveCatalogCampaign`/`catalogCampaigns` hacen `import('./campaignsDb')` y, si falla o el catálogo está vacío, usan el valor recibido sin espacios. `campaignExists` compara sin distinguir mayúsculas.
- **Dónde se resuelve la grafía del catálogo:** presign CSV (metadata `campaign`), `csvTrigger` (por si un presign viejo firmó otra), heartbeat (`registerAgent`), `GET /agents?campaign=` (admin), consultas por campaña de `jobsAdmin` (resumen, reasignación, revisión), `POST /send` y las tres rutas de interacciones (lo que llega al CRM), y el historial de cargas. `GET /uploads/history` responde con la grafía del catálogo.
- **`MEDIA_LEGACY_OWNER`:** parámetro de despliegue `mediaLegacyOwner` (default `'false'`); con `true`, `GET /media/url` acepta el segmento saneado anterior *del propio usuario* (comparado sin distinguir mayúsculas). No se aplica a `wa-sessions/` ni `csv-uploads/`: la sesión de WhatsApp se copia en la migración y los CSV ya se borran al procesarse.
- **Migración:** `scripts/migrate-canonical-ids.ts` con la lógica pura exportada y probada (`precheck`, `planUser`, `rewriteMediaKey`, `targetKey`, `parseArgs`); `tsconfig.json` incluye `scripts/**` para el typecheck. Con colisiones, `--apply`/`--delete-source` se niegan (exit 2). Para un usuario cuyo username ya es canónico pero con caracteres especiales (solo cambia S3), `--apply` reescribe `mediaKey` en sus mensajes en el mismo ítem (no hay partición nueva). Se corre con `npx -y tsx@4` (no se agregó `tsx` como dependencia).
- **Desktop:** `canonicalOperatorId` local en `electron/auth/session.ts`; `decideSetToken` compara `activeOperator` y `.ana-last-operator` canonizados, así que un archivo escrito por una versión previa con otra grafía no borra la sesión local.
- **ANA Admin:** la validación de `srcKey` del BFF de revisión v4 acepta `~` en el segmento de operador.
- **1.3 y 3.1:** script listo; quedan sin marcar porque su verificación es ejecutarlo contra dev/prod (precheck) y probarlo en dev con usuarios de prueba, lo cual no se hizo en este trabajo.
