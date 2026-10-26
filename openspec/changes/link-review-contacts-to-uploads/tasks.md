# Tasks

## 1. v3: identificador de carga y origen

- [x] 1.1 En `src/handlers/adminContacts.ts`, rechazar encabezados con `ana_upload_id` (sin distinguir mayúsculas) y agregar la columna como última en cada fila de `agents/` y `historic/` (design D1); verificar con pruebas vitest (S3 mockeado) los escenarios de "Identificador de carga en las filas entregadas" y que el contenido de `agents/` y `historic/` es idéntico
- [x] 1.2 Aceptar y validar `source` (1–5 000 items, `mode` `single`) y guardarlo en el manifiesto; verificar con pruebas: con `source` → manifiesto lo incluye, `source` + `distribute` → 400, sin `source` → manifiesto igual al de `add-contact-upload-console`
- [x] 1.3 Verificar con una prueba en `v3/cli-whatsapp` (`node:test`) que `parseCSV` (o `assignment-csv.js`) sobre un CSV con `ana_upload_id` como última columna produce el mismo `message` interpolado y los mismos campos de `resultados.csv` que sin la columna, y que `rawValues` conserva `ana_upload_id`

## 2. v3: consulta y estados de contactos por revisar

- [x] 2.1 Crear `src/lib/reviewItems.ts`: listado paginado de `review/{campaign}/`, parseo por fila con `parseError`, filtro por `ana_upload_id` o `none`, lectura/escritura condicional de `review-state/` con 3 reintentos (design D2/D3); verificar con `test/reviewItems.test.ts`: filtro por carga, `none`, fila mal formada, conflicto concurrente fusiona, 409 tras 3 fallos
- [x] 2.2 Crear `src/handlers/adminReview.ts` con `GET /admin/campaigns/{campaign}/review-items` y `POST .../review-items/resolve` (validación, permisos con `requireAdminAccess`, verificación del manifiesto para `reassign`, idempotencia con el mismo `reassignUploadId`, 409 para items ya resueltos) y registrarlas en `serverless.yml` con `cognitoAdminJwt`; verificar con pruebas de handler cada escenario de `specs/v3/agent-assignments/spec.md` y que ninguna ruta escribe bajo `review/`
- [ ] 2.3 Documentar en `v3/ana-backend/README.md` y `README-SUPERVISORES.md` las rutas, los estados, la columna reservada y que `GET /supervisors/review/{campaign}` queda como respaldo hasta el retiro de `X-Admin-Key` (design D5); verificar los ejemplos `curl` contra dev con un id token

## 3. ANA Admin

- [x] 3.1 En `src/lib/contacts/`, rechazar `ana_upload_id` en v3 y marcar variables que solo resolverían por coincidencia parcial contra esa columna; verificar con pruebas vitest (`{upload}` → error, `{first_name}` → válido, `{id}` con columna `id_credito` → válido) y con la prueba de equivalencia contra `parseCSV` del CLI
- [x] 3.2 Crear rutas BFF `GET /api/campaigns/[campaign]/review-items` y `POST /api/campaigns/[campaign]/review-items/resolve` (permisos de la sección Contactos, propagación del token, sin datos de contactos en logs); verificar con pruebas de route handler con backend mockeado
- [x] 3.3 Construir `/contactos/historial/[uploadId]` con la sección "Por revisar" por agente (solo v3), estados, autor/fecha, enlace a la carga de reasignación, y la vista "Por revisar sin carga asociada"; verificar con pruebas de componente de los escenarios del spec `admin-web/contact-upload`
- [x] 3.4 Implementar "Reasignar" (selector de habilitados, CSV sin `ana_upload_id`, flujo de carga `single` con `source`, `ConfirmDialog` con aviso de WhatsApp, marcado con reintento) y "Descartar"; verificar con pruebas de componente: reasignación exitosa, marcado fallido con reintento sin segunda carga, descarte, roster cambiado → 409
- [ ] 3.5 Documentar en `admin-web/README.md` el flujo de revisión y reasignación; verificar con un CSV `*.example.csv` en dev

## 4. Integración

- [ ] 4.1 Prueba de punta a punta en dev (con `report-pending-progress` desplegado): carga desde ANA Admin a un agente de prueba, cierre del CLI durante el envío, contacto visible en el detalle de la carga, reasignación a otro agente que lo recibe por `GET /get/chats` y estado "Reasignado"; registrar evidencia en el PR
- [ ] 4.2 Confirmar con quien implementa `add-agent-roster-management` (D11) y `migrate-cli-to-cognito-login` (D12) que sus scripts incluyen `review-state/`; verificar en sus pruebas el prefijo
