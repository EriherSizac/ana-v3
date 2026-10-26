# Design

## Context

- `add-contact-upload-console` D3/D5: `POST /admin/campaigns/{campaign}/contacts` escribe por agente `agents/{campaign}/{agent}-contacts-{ts}.csv` + copia en `historic/` con el mismo `{ts}` y el manifiesto `uploads/{campaign}/{uploadId}.json` (`uploadId` = `{ts}-{8 hex}`, `perAgent[].key`).
- `report-pending-progress` D2/D6: el CLI guarda el CSV crudo en su journal y reporta en `POST /contacts/pending` el campo `review:{assignment_id, contacts}` con las **filas originales** (`rawValues`: todas las columnas del encabezado, tal cual). El backend escribe `review/{campaign}/{agent_id}/{assignment_id}.csv` (sobrescribe en cada reporte; las filas por revisar de una asignación solo crecen). `assignment_id` = `received_at` compacto + 8 hex de `sha256(csv)`, calculado en el CLI.
- `GET /get/chats` (`chats.ts`) devuelve solo el body; el CLI no conoce la llave consumida.
- Parser del CLI (`agent-config.js:298-418`): toda columna del encabezado entra en `rawValues` y en el contacto (columnas sin alias con su nombre original); descarta filas con menos columnas que el encabezado. `resultados.csv` (`csv-utils.js:95`) y la interacción CRM (`index.js:496-542`) usan columnas fijas, así que una columna extra no se envía a ningún lado. Única interacción: la interpolación `{var}` del mensaje cae en coincidencia parcial (`Object.keys(rawValues).find(k => k.includes(varName))`) cuando no hay columna exacta; `fix-cli-double-brace-templates` conserva ese comportamiento para llaves simples.

## Goals / Non-Goals

**Goals:**
- Unir cada fila por revisar con su carga sin release del CLI y sin cambiar contratos que usa la flota instalada.
- Resolver (reasignar o descartar) desde ANA Admin con trazabilidad de quién y cuándo.

**Non-Goals:**
- v4, cargas fuera de ANA Admin unidas a un manifiesto, edición de `review/`.

## Decisions

### D1. Vínculo: columna `ana_upload_id` en cada fila (elegida)
La carga de administración agrega `ana_upload_id=<uploadId>` como última columna de cada fila. Viaja dentro del CSV que ya consume el CLI, sobrevive al journal (CSV crudo) y llega a `review/` porque `report-pending-progress` reporta filas originales; también aparece en `chats/` (pendientes), lo que permite unir pendientes de un equipo perdido.
- Por qué última columna: la coincidencia parcial del CLI toma la primera llave del encabezado que contiene la variable, así que cualquier columna real gana; el único riesgo es una variable que no resuelve con nada más y es subcadena de `ana_upload_id` (`{id}`, `{upload}`, `{ana}`): la consola la marca como error (requisito "Columna reservada") en lugar de enviar el `uploadId` al deudor.
- Alternativa (a): `uploadId` en el nombre del archivo (`{agent}-contacts-{uploadId}.csv`). Compatible con el filtro de `chats.ts` (prefijo/sufijo), pero el CLI nunca ve la llave: no alcanza sin (c).
- Alternativa (c): `GET /get/chats` devuelve la llave en un header (`X-Ana-Assignment-Key`) y el CLI nuevo la usa como `assignment_id`. Requiere release del CLI coordinado con `report-pending-progress` y `migrate-cli-to-cognito-login`, cambia `assignment_id` y no cubre a la flota que aún no se actualiza. Descartada.
- Alternativa (d): unir por teléfono contra `historic/`. Ambigua cuando un deudor está en varias cargas. Descartada.
- Las filas sin la columna (cargas por `curl`/`setup-campaign.sh` o anteriores) se consultan con `uploadId=none`.

### D2. Lectura de `review/` sin índice
`GET .../review-items` lista `review/{campaign}/` (paginado), lee cada CSV, parsea con el mismo parser de la ruta de carga y filtra en memoria. Volumen bajo (solo cierres en pleno envío; `report-pending-progress` Risks). Se agrega `review-state/` por cada `(agent, assignmentId)` leído. Si crece, un índice por `uploadId` se agrega después sin cambiar el contrato.
- El CSV de `review/` lo escribe `contacts.ts` sin escapar comillas internas: una fila que no parsea se devuelve con `row:null` y `parseError:true`, sin bloquear el resto; la consola la muestra sin acción de reasignar.

### D3. Estados en `review-state/`, separado de `review/`
`review-state/{campaign}/{agent}/{assignmentId}.json` = `{"schemaVersion":1,"items":{"<phoneDigits>":{"state","by","at","reassignUploadId?","targetAgent?"}}}`, escrito con `If-Match`/`If-None-Match` (mismo patrón que el roster de `add-agent-roster-management` D2). Separado porque `review/` lo sobrescribe el CLI en cada reporte y porque `GET /supervisors/review/{campaign}` devuelve todo objeto bajo `review/{campaign}/`: un archivo de estado ahí cambiaría su respuesta y obligaría a un MODIFIED sobre un requisito que aún no se archiva.
- Identidad del item: teléfono solo dígitos dentro de `(agent, assignmentId)`; la consola rechaza teléfonos duplicados (`add-contact-upload-console`), y una fila duplicada heredada comparte estado.

### D4. Reasignación = carga nueva + marcado verificable
El BFF arma el CSV con el encabezado de la fila original sin `ana_upload_id`, lo pasa por el flujo de la consola (`plan`, verificación con roster vigente, `uploadId` nuevo) en modo `single` con `source` y, al recibir el manifiesto `completed`, llama a `resolve` con `reassignUploadId`. v3 verifica contra el manifiesto que la carga existe, terminó y declaró esos items, así que el estado no puede marcarse "reasignado" sin una entrega real. Si el marcado falla, reintentar con el mismo `reassignUploadId` es idempotente (mismos items → mismo estado; ya `reassigned` con el mismo `reassignUploadId` se trata como éxito).
- La carga nueva vuelve a llevar `ana_upload_id` (el nuevo), así que si se interrumpe otra vez aparece en el detalle de la carga de reasignación.
- Alternativa: una sola ruta v3 que escriba y marque. Descartada: duplicaría la carga de administración y su validación de roster.

### D5. `GET /supervisors/review/{campaign}`: se conserva sin cambios
Sigue como lectura cruda con `X-Admin-Key` para soporte y se retira con las demás rutas con llave (`add-agent-roster-management`, Migration Plan paso 6). No se modifica su requisito (lo crea `report-pending-progress`, sin archivar), lo que evita bloques MODIFIED cruzados. ANA Admin es la vía principal; `README-SUPERVISORES.md` lo indica.

### D6. Permisos
Mismos que la carga (`ana:contacts:list:upload` + `ana:contacts:list:distribute` con campaña, o admin), vía `requireAdminAccess`: quien puede repartir contactos puede resolver los interrumpidos. Sin permiso nuevo en v4.

### Coordinación con otros cambios
- Orden de archivo: `add-agent-roster-management` → `add-contact-upload-console` → `report-pending-progress` → este. Los requisitos de este cambio son todos ADDED; extienden "Escritura en el layout que consume el CLI" y el body de "Carga de contactos de administración" sin reescribirlos.
- `add-agent-roster-management` D11 (renombrado) y `migrate-cli-to-cognito-login` D12 (purga de `agent_id` legados) incluyen `review-state/` junto a `review/`.
- `add-contact-upload-console` D5: el manifiesto gana el campo opcional `source`; los lectores existentes lo ignoran.

## Risks / Trade-offs

- [Variable del mensaje que toma el `uploadId` por coincidencia parcial] → validación en la consola (D1) y prueba de equivalencia con el parser del CLI.
- [Filas de `review/` mal formadas por el serializador de `contacts.ts`] → `parseError` por fila, sin reasignación automática; corrección del serializador sigue como seguimiento de `report-pending-progress`.
- [Reasignar un contacto que sí recibió el mensaje] → `ConfirmDialog` pide confirmarlo en WhatsApp; el descarte cubre el caso.
- [Listado completo de `review/{campaign}/` por consulta] → volumen bajo; índice como seguimiento si supera ~1 000 objetos.
- [`ana_upload_id` visible en `chats/` y `review/`] → no es dato personal; solo identifica la carga.

## Migration Plan

1. Desplegar v3: columna `ana_upload_id` y `source` en la carga de administración, rutas `review-items*` (aditivo; el CLI instalado no cambia).
2. Desplegar ANA Admin con el detalle de carga y la vista sin carga asociada.
3. Documentar en `README-SUPERVISORES.md` que la revisión se hace en ANA Admin y que `GET /supervisors/review` queda como respaldo.
- Rollback: ocultar la sección; quitar la columna de la carga no afecta a filas ya entregadas (los estados quedan en `review-state/`).

## Decisiones de implementación

- `report-pending-progress` ya estaba integrado en `installer-2` (`contacts.ts` escribe `review/{campaign}/{agent}/{assignment_id}.csv`; `supervisors.ts` expone `GET /supervisors/review/{campaign}`), así que todo el código de este cambio se implementó sobre ese contrato; solo quedan abiertas las verificaciones en dev (2.3, 3.5, 4.1) y la confirmación con `migrate-cli-to-cognito-login` (4.2).
- `ana_upload_id` se agrega **después** del procesamiento de `message` (encabezado `...,message,ana_upload_id`), a todas las filas no vacías; `perAgent[].rows` no cambia.
- `source` se valida (`type:"review"`, `fromUploadId` con formato de `uploadId` o `none`, 1–5 000 items `{agent, assignmentId, phone}`) y se guarda normalizado (agente en minúsculas).
- Lectura de `review/`: parser con comillas igual al del CLI; una fila con número de columnas distinto al encabezado → `row:null`, `parseError:true`; su teléfono se toma del primer bloque de ≥ 10 dígitos y su `uploadId` de la última columna si tiene el formato `{ts}-{hex}`.
- Teléfono de una fila: primer alias del CLI presente (`phone_number`, `contact_phone`, `contact_pho`, `phone`); la identidad del estado usa solo dígitos.
- `resolve` valida antes de escribir: items existentes en `review/` (si no, 400 `Contactos inexistentes`), manifiesto de reasignación (`completed`, `source.type:"review"`, contiene todos los items; si no, 409) y estados (ya resuelto → 409 `Contactos ya resueltos` con la lista; mismo `reassignUploadId` = éxito sin tocar `by`/`at`). Las escrituras van por `(agente, asignación)` con `If-Match`/`If-None-Match` y 3 intentos. `targetAgent` = agente del `perAgent` del manifiesto (modo `single`).
- El 403 de las rutas de revisión responde siempre `Sin permiso` (también por campaña fuera de alcance), como pide el spec.
- ANA Admin: el detalle se abre en `/contactos/historial/{uploadId}?campaign=<c>`; `none` como `uploadId` muestra "Por revisar sin carga asociada". El manifiesto del detalle se toma del historial v3 (sin ruta nueva). Si las filas originales no traen `message`, la reasignación pide un mensaje plantilla.
- La validación de variables (`{x}` que solo resolvería contra `ana_upload_id`) revisa el mensaje plantilla y la columna `message` de las filas válidas; las llaves dobles `{{x}}` no se consideran porque el CLI no usa coincidencia parcial en ellas.
