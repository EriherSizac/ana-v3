# Proposal

## Why

`report-pending-progress` guarda los contactos interrumpidos en pleno envío ("por revisar") en `review/{campaign}/{agent}/{assignment_id}.csv`, pero solo se pueden consultar con `GET /supervisors/review/{campaign}` (`X-Admin-Key`) y no se pueden unir con la carga que los originó: `GET /get/chats` entrega solo el CSV, así que el CLI nunca conoce el `uploadId` del manifiesto `uploads/{campaign}/{uploadId}.json` (`add-contact-upload-console`), y `assignment_id` se calcula en el CLI con la fecha de recepción y el hash del CSV. El supervisor que revisa una carga en ANA Admin no ve qué contactos de esa carga quedaron sin confirmar ni tiene cómo reasignarlos sin re-subir un archivo a mano.

## What Changes

- **Vínculo carga ↔ filas (v3)**: la carga de administración (`POST /admin/campaigns/{campaign}/contacts`) agrega a cada fila de cada archivo por agente una columna reservada `ana_upload_id` con el `uploadId` de la carga, como última columna. El CLI ya conserva las columnas desconocidas en la fila original y `report-pending-progress` reporta esas filas originales en `review`, así que cada fila "por revisar" llega con su `uploadId`. Sin release del CLI ni cambio de contrato de `/get/chats` o `/contacts/pending`.
- **Validación en la consola**: la columna `ana_upload_id` queda reservada (un CSV que la traiga se rechaza) y una variable del mensaje que solo resolvería contra esa columna por la coincidencia parcial del CLI se marca como error antes de la vista previa.
- **Consulta de contactos por revisar (v3)**: nueva ruta `GET /admin/campaigns/{campaign}/review-items?uploadId=<id>|none` bajo `/admin/*` (Cognito + v4 `GET /me`, permisos de carga de contactos con alcance de campaña) que lee `review/{campaign}/`, filtra por `ana_upload_id` y devuelve cada fila con agente, `assignmentId`, teléfono, fila original y estado.
- **Estados de revisión (v3)**: `pendiente de revisión` (por defecto), `reasignado` (con carga destino y agente) y `descartado`, con quién y cuándo, guardados en `review-state/{campaign}/{agent}/{assignment_id}.json` con escritura condicional; ruta `POST /admin/campaigns/{campaign}/review-items/resolve`.
- **Reasignación**: en el detalle de una carga v3, por agente, ANA Admin lista los contactos por revisar y permite descartarlos o reasignarlos a un agente habilitado; la reasignación crea una carga nueva en modo "Asignar a un agente" reutilizando el flujo de la consola (vista previa, verificación del plan, `uploadId` nuevo), registra el origen en su manifiesto (`source`) y marca los contactos como reasignados.
- `GET /supervisors/review/{campaign}` (`X-Admin-Key`) se conserva sin cambios como respaldo de solo lectura y se retira junto con las demás rutas con `X-Admin-Key`.

Fuera de alcance: flota v4 (no tiene contactos "por revisar"), filas por revisar de cargas hechas fuera de ANA Admin o antes de este cambio (se listan como "sin carga asociada", sin unirse a un manifiesto), corregir el escape de comillas de `contacts.ts`, deduplicar contra otras cargas.

## Capabilities

### New Capabilities

_Ninguna._

### Modified Capabilities

- `admin-web/contact-upload` (creada por `add-contact-upload-console`): se agregan la columna reservada, la vista "Por revisar" en el detalle de una carga v3, la reasignación y el descarte.
- `v3/agent-assignments`: se agregan la columna `ana_upload_id` en la carga de administración, el origen de reasignación en el manifiesto, la consulta de contactos por revisar por carga y sus estados.

## Impact

- Depende de `add-contact-upload-console` (carga de administración, manifiesto, consola), de `report-pending-progress` (`review/` y filas originales en `review`) y de `add-agent-roster-management` (authorizer `/admin/*`, `requireAdminAccess`, regla de habilitación). No depende de `migrate-cli-to-cognito-login` (no cambia el CLI); la purga de su D12 y el renombrado de campañas incluyen el prefijo nuevo `review-state/`.
- Orden de archivo: `add-agent-roster-management` → `add-contact-upload-console` → `report-pending-progress` → este cambio (sus requisitos ADDED extienden requisitos que aquellos crean).
- v3 backend: `src/handlers/adminContacts.ts` (columna y `source`), nuevo `src/handlers/adminReview.ts` y `src/lib/reviewItems.ts`, `serverless.yml`, pruebas vitest; datos nuevos `review-state/` en `ana-backend-storage-prod`.
- admin-web: detalle de carga en `/contactos/historial/[uploadId]`, rutas BFF `/api/campaigns/{campaign}/review-items*`, validación de la columna reservada en `src/lib/contacts/`.
- CLI v3: sin cambios (verificación de que la columna extra no altera el envío ni `resultados.csv`).
