# Design

## Context

Ver proposal.md (Why). Estado actual observado en el código:

- `src/handlers/auth.ts:85` llama `getCampaignCredentials(campaign.toLowerCase())` (sin `trim`) y arma `agents/${campaign}/credentials.csv`.
- `src/handlers/credentials.ts` arma la misma llave con la campaña cruda en tres lugares: `getCampaignCredentials` (`:77`, path param), `regenerateDailyPasswords` (`:163`, body) y `uploadCampaignCredentials` (`:339`, body).
- Llaves de contactos/asignaciones con campaña cruda en `src/handlers/supervisors.ts`: `listAgentAssignments` (`:137`), `getAgentAssignments` (`:295`), `publishAgentContactsDeprecated` (`:510`), `uploadAgentContactsLogging` (`:685`, sin ruta en `serverless.yml`), `uploadAgentContacts` (`:982`, `:989`, `:993`) y `getAgentContacts` (`:1101`); `src/handlers/chats.ts:22` (`/get/chats`); `src/handlers/contacts.ts:55` (`chats/{agent_id}-{campaign}.csv`).
- El identificador de agente también se usa crudo: como nombre de archivo `{agent}-contacts-{ts}.csv` al escribir (`supervisors.ts:510,685,982,989,993`), como filtro `startsWith(agent + '-contacts')` al leer (`supervisors.ts:154,311,1117`, `chats.ts:39`), en `chats/{agent_id}-{campaign}.csv` (`contacts.ts:55`) y en respaldos/multimedia.
- La columna de usuario del CSV de credenciales ya se compara en minúsculas en ambos lados (`auth.ts:31` y `:101`); no requiere cambio.
- Respaldos y multimedia con campaña y agente crudos: `backups.ts:30,82`, `chatBackups.ts:41,150,250`, `media.ts:29`.
- El CLI (`v3/cli-whatsapp/whatsapp.js:180,198`) fuerza minúsculas en Usuario y Campaña y hace `trim()` al enviar; todas sus llamadas (`/auth/verify`, `/get/chats`, `/contacts/pending`, `/backups*`, `/media`) usan ya agente y campaña en minúsculas. Lo que sube un supervisor (o v4 `master.ts`) con mayúsculas queda en llaves que el CLI nunca lee.
- `src/handlers/templates.ts` usa la campaña en el bucket `s3-motor-509399624341-prod`, compartido con el motor de Pernexium.
- El backend no tiene suite de pruebas (`package.json` solo tiene `build` y `deploy`).
- La nueva web de administración (`add-contact-upload-console`) elige la campaña de un catálogo del backend (y el agente de una lista), lo que hace improbable que lleguen valores con mayúsculas en adelante; aun así la normalización en el backend es la garantía, porque `curl`, scripts y v4 llaman a las mismas rutas.

## Goals / Non-Goals

**Goals:**
- Una sola regla de normalización para campaña y agente, usada por todas las rutas que construyen o comparan llaves S3 en el bucket de almacenamiento a partir de ellos.
- Rescatar los objetos existentes con campaña o agente con mayúsculas (`agents/`, `assignments/agents/`) mediante una migración única y verificable.
- Pruebas automáticas que fijen la llave S3 usada por cada ruta.

**Non-Goals:**
- Plantillas (`GET/POST /templates`): el bucket es del motor y puede tener convenciones propias de nombres; cambiarlas requiere coordinación con ese sistema.
- Migrar `historic/agents/`, `chats/`, `backups/` o `media/`: el histórico solo se lee por llave explícita, y el resto lo escribe el CLI, que ya usa minúsculas en campaña y agente.
- Cambiar el CSV de credenciales (la columna `user` ya se compara sin mayúsculas); validar caracteres de campaña o agente (p. ej. `/`).

## Decisions

### D1. Normalización = `trim()` + `toLowerCase()` en una familia de helpers compartida
Nuevo `src/lib/campaign.ts` con `normalizeKeySegment(raw: unknown): string` (trim + `toLowerCase()`; `''` si no es string o queda vacío), los alias `normalizeCampaign` y `normalizeAgent`, y `credentialsKey(campaign)`. Cada handler normaliza campaña y agente **al leer los parámetros** (path o body), trata `''` como faltante con su 400 actual y usa solo los valores normalizados para llaves, prefijos, filtros de nombre de archivo y campos `agent`/`campaign`/`key`/`prefix` de la respuesta. No queda ninguna construcción de llaves con valores crudos.
- Alternativa: `toLocaleLowerCase('es-MX')` o normalización Unicode (NFC/quitar acentos). Rechazada: el CLI usa `toLowerCase()` plano en el navegador; usar lo mismo garantiza que ambos lados coincidan. Quitar acentos cambiaría valores existentes con `ñ`/acentos sin evidencia de que haga falta.
- Alternativa: rechazar con 400 valores con mayúsculas. Rechazada: rompe el flujo de supervisores e integraciones sin beneficio.
- Alternativa: normalizar en un middleware común. Rechazada: los handlers no comparten un punto de entrada (unos leen path, otros body o multipart); una llamada explícita por handler es más simple y se fija con pruebas.

### D2. Migración por copia única, sin fallback en tiempo de ejecución
Script `scripts/migrate-campaign-case.ts` (ejecutado con `npx tsx`), que:
1. Lista con `ListObjectsV2` paginado (`ContinuationToken`) los prefijos `agents/` y `assignments/agents/`.
2. Para cada llave, normaliza el segmento de campaña y, en archivos de contactos, la parte de agente del nombre (regex `^(.*)-contacts(.*)\.csv$`; solo se normaliza el primer grupo, el timestamp no se toca). Si el resultado difiere de la llave original, planifica copiar a la llave normalizada (p. ej. `agents/Prueba/Erick-contacts-…` → `agents/prueba/erick-contacts-…`).
3. Si la llave destino ya existe, o dos orígenes colapsan en el mismo destino (`Prueba` y `PRUEBA`, `Erick-…` y `erick-…` con el mismo timestamp), **no copia** y lo reporta como conflicto para resolución manual.
4. Clasifica cada objeto: `credentials` (`credentials.csv`), `ready` (`agents/…/{agent}-contacts-*.csv`) y `pending` (`assignments/agents/…`). Los `ready` solo se copian con `--include-ready` explícito, porque copiarlos los pone en la cola consume-once del CLI y un archivo viejo dispararía envíos atrasados; el reporte muestra su `LastModified` para decidir (opcionalmente `--ready-since <ISO>`). La regla aplica igual si cambia la campaña, el agente o ambos.
5. Por defecto es dry-run (solo imprime el plan); con `--apply` ejecuta `CopyObject` y nunca borra el origen. Bucket y perfil por argumentos (`--bucket ana-backend-storage-prod --profile pernexium`). Nunca imprime contenido de los objetos.
- Alternativa: fallback en lectura que busque variantes con mayúsculas. Rechazada: el CLI siempre envía minúsculas, así que habría que listar y comparar sin mayúsculas en cada login/poll (latencia, costo, ambigüedad) y quedaría como código permanente para un problema de datos puntual.
- Alternativa: renombrar (copiar + borrar). Rechazada: el original sirve de respaldo y queda inerte (ninguna ruta lo lee tras el cambio).

### D3. Suite mínima con vitest + aws-sdk-client-mock
`vitest` corre TS sin compilación y `aws-sdk-client-mock` intercepta `S3Client.send` para afirmar la `Key`/`Prefix` de cada operación. Script `npm test` → `vitest run`; pruebas en `test/` (fuera del `include` de `tsconfig`). Si otro cambio ya agregó la suite, se reutiliza.
- Alternativa: `node:test` + `tsx`. Viable, pero el mock de S3 es más verboso.

## Dependencias con otros cambios

- `secure-assignment-consumption` modifica en `v3/agent-assignments` los requisitos "Consulta de contactos listos del agente", "Listado de asignaciones pendientes", "Consulta de la asignación pendiente más reciente" y "Consumo único de la asignación por el CLI". Este cambio **no** modifica esos bloques: modifica solo "Disposición de llaves S3 de asignaciones" y agrega un requisito nuevo, así que los deltas no chocan y pueden archivarse en cualquier orden.
- En código ambos tocan `chats.ts`, `supervisors.ts` y `auth.ts`. El orden no importa para la conducta (el guard de token compara agente/campaña ya normalizados), pero quien se implemente segundo debe rebasar sobre el primero: la normalización va al leer los parámetros y el guard de autenticación antes de cualquier acceso a S3.
- `add-agent-roster-management` renombra en v3 las campañas que no están en el catálogo de v4 (`scripts/rename-campaigns.ts`). **La migración de este cambio corre primero**: el renombrado opera sobre nombres ya normalizados y aborta si encuentra una llave con mayúsculas de una campaña origen sin su copia normalizada (los originales inertes que deja esta migración solo se reportan). No se fusionan: este script queda acotado a mayúsculas/espacios en `agents/` y `assignments/agents/`, sin borrar.

## Risks / Trade-offs

- [Un supervisor consulta `Erick`/`Prueba` antes de migrar y recibe 404] → Ejecutar la migración en la misma ventana del deploy y documentar en README-SUPERVISORES.md que agente y campaña son insensibles a mayúsculas.
- [Envío de asignaciones atrasadas al copiar `ready` viejos] → Copia de `ready` solo con opt-in explícito y revisión de fechas (D2.4).
- [Conflictos entre variantes con contenidos distintos] → El script no sobrescribe; el operador decide.
- [Integración externa que dependía de leer sus propias llaves con mayúsculas] → No hay evidencia en el repo (v4 solo hace `POST`); el cambio se anuncia en README y la migración copia lo pendiente.
- [Divergencia futura si otro handler arma la llave a mano] → Pruebas por ruta que afirman la llave con `" Erick "`/`" Prueba "`.

## Migration Plan

1. Antes del deploy: inventario de solo lectura (`aws s3 ls s3://ana-backend-storage-prod/agents/ --recursive --profile pernexium` y lo mismo para `assignments/agents/`) y dry-run del script; guardar la salida.
2. Deploy del backend (`npm run deploy -- --stage prod` en `v3/ana-backend`).
3. Inmediatamente después: `--apply` del script (con `--include-ready` solo si la revisión de fechas lo justifica); resolver conflictos manualmente.
4. Verificar: `GET /credentials/{campaña}` y `GET /supervisors/assignments/agents/{agente}/{campaña}` con `X-Admin-Key` para cada agente/campaña migrados, y un login real del CLI.
5. Rollback: redeploy de la versión anterior; los objetos copiados quedan en llaves en minúsculas que la versión anterior ya usaba para el CLI, y los originales siguen intactos.

## Decisiones de implementación

- **Parámetros de ruta con escapes de URL.** El spec exige 400 para `GET /credentials/%20` y la tarea 5.1 para `"%20"` en agente o campaña, pero no está garantizado que API Gateway (HTTP API) entregue `pathParameters` ya decodificados. Se agregó `normalizePathSegment` en `src/lib/campaign.ts`: aplica `decodeURIComponent` (si la secuencia es inválida conserva el valor) y luego la misma regla de D1. Se usa solo para parámetros de ruta; los campos del body usan `normalizeCampaign`/`normalizeAgent`. Efecto colateral aceptado: un `%` literal ya decodificado seguido de dos hexadecimales se decodificaría dos veces (no hay campañas ni agentes con `%`).
- **`contacts.ts` sin tocar la desestructuración.** Para que el merge con el cambio que agrega `review` en `POST /contacts/pending` sea trivial, la línea `const { campaign, agent_id, contacts } = body;` se conserva y se agregan `campaignKey`/`agentKey` normalizados, usados en la validación y en la llave.
- **`uploadAgentContactsLogging`** (sin ruta en `serverless.yml`) también normaliza; su llave es `logging/{campaign}/{agent}-contacts.csv` (sin timestamp), que es la que fija la prueba.
- **Respaldos de chat:** `saveChatBackup` guarda `campaign`/`agent_id` normalizados también dentro del JSON del respaldo, y `listChatBackups` los devuelve normalizados (consistente con "las respuestas reportan el valor normalizado"). `contactPhone` no se normaliza.
- **Migración, objetos no clasificados.** Bajo los prefijos migrados, un objeto con mayúsculas que no es `credentials.csv` ni `{agent}-contacts*.csv` se reporta como `IGNORED` y no se copia (D2 solo define las categorías `credentials`, `ready` y `pending`).
- **Migración, revalidación en `--apply`.** Además del conflicto detectado en el plan, antes de cada `CopyObject` se hace `HeadObject` del destino; si apareció entre el listado y la copia se marca como conflicto y no se copia.
- **Migración, perfil AWS.** `--profile` se aplica vía `AWS_PROFILE` (proveedor de credenciales por defecto del SDK), sin agregar `@aws-sdk/credential-providers`. El script se ejecuta con `npx tsx` (se agregó `tsx` como devDependency); no entra al build (`tsconfig` incluye solo `src/**/*`).
- **Bucket dev.** `ana-backend-storage-dev` no existe actualmente; la verificación de 7.2 contra dev queda pendiente (el comando está documentado en README-SUPERVISORES.md).
- **Pruebas:** helper `test/helpers/memS3.ts` (S3 en memoria sobre `aws-sdk-client-mock`, con List paginado, Get, Put, Head, Copy y Delete). La prueba de integración 4.2 vive en `test/credentials.test.ts`.
