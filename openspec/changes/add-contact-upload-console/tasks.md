# Tasks

## 1. Lógica compartida de contactos (admin-web)

- [x] 1.1 Implementar `admin-web/src/lib/contacts/` isomórfico: parseo con `papaparse` (BOM, `trim`, filas vacías), detección de columna de teléfono por flota, validación de filas (columnas, teléfono < 10 dígitos, duplicados, salto de línea en campo para v3), plan determinista (D2, orden de `Object.keys` para v4) y hash del plan; verificar con pruebas vitest y fixtures `*.example.csv` con datos falsos
- [x] 1.2 Agregar pruebas de equivalencia: los mismos fixtures parseados con `csv-parse` + `normalizeContactRow` (como `v4/backend/src/handlers/csvTrigger.ts`) y con `parseCSV` de `v3/cli-whatsapp/agent-config.js` dan las mismas filas válidas y el mismo agente por fila que el plan; verificar que la suite pasa en CI

## 2. v3: carga de administración

- [x] 2.1 Extraer el procesamiento de la columna `message` de `src/handlers/supervisors.ts` a `src/lib/contactsCsv.ts` (sin cambiar comportamiento) y agregar la conversión de CR/LF a `\n` literal solo para la nueva ruta; verificar con pruebas que la ruta de supervisor produce la misma salida que antes
- [x] 2.2 Implementar `src/handlers/adminContacts.ts` `POST /admin/campaigns/{campaign}/contacts` (413, validaciones, permisos upload+distribute vía `requireAdminAccess`, verificación de roster, escritura `agents/` + `historic/` con mismo `{ts}`, rollback, manifiesto, idempotencia por `uploadId`) y registrarla en `serverless.yml` con `cognitoAdminJwt`; verificar con pruebas (S3 mockeado) cada escenario de `specs/v3/agent-assignments/spec.md`
- [x] 2.3 Implementar `GET /admin/campaigns/{campaign}/uploads` (50 más recientes, sin `message`); verificar con pruebas de orden, vacío y 403
- [x] 2.4 Probar en dev que un archivo escrito por la nueva ruta lo entrega `GET /get/chats/{agent}/{campaign}` y el CLI lo parsea con el mensaje interpolado; documentar las rutas en `v3/ana-backend/README.md` y `README-SUPERVISORES.md` (ANA Admin como vía principal) y verificar los ejemplos — (verificado 2026-10-29: rutas documentadas en README.md §Carga de contactos y README-SUPERVISORES.md §ANA Admin (vía principal); ejemplos en prod responden 401 sin token; equivalencia con el parser del CLI en `admin-web/test/contacts/equivalence.test.ts`; en prod, últimos 4 días: 1 `adminUploadContacts`, 2 `agentPublishAssignments` y 15 `getChats`)

## 3. v4: historial de cargas

- [x] 3.1 Agregar la tabla `ana-backend-uploads-{stage}` (PK `campaign`, SK `srcKey`, TTL) y permisos IAM en `v4/backend/serverless.yml`, y `src/lib/uploads.ts` (`recordUpload`, `listUploads`); verificar con `serverless package` y pruebas unitarias — (verificado 2026-10-29: tabla `ana-backend-uploads-prod` existe en us-east-2; `src/lib/uploads.ts` y `test/uploads.test.ts` en verde)
- [x] 3.2 Registrar en `csvTrigger` cargas procesadas (modo, filas, jobs, `perAgent`) y rechazadas (`too_large`, `too_many_rows`, `missing_operator`) usando la fecha del objeto; verificar con pruebas: reparto por pesos 49/49, evento duplicado = un registro, rechazo por filas
- [x] 3.3 Agregar `GET /uploads/history` (con `srcKey` opcional, autorización fail-closed por campaña) al handler `api.ts` y a `serverless.yml`; verificar con pruebas de 200/403 y documentarlo en `v4/CAMPANAS_Y_ASIGNACION.md`

## 4. ANA Admin: sección Contactos

- [x] 4.1 Crear `POST /api/campaigns/[campaign]/uploads` (permisos, verificación del plan con roster vigente → 409, entrega v3 con `uploadId` y un reintento, entrega v4 por presign + PUT con headers `x-amz-meta-*`, bloqueo si `assignments` > 1500) y `GET /api/campaigns/[campaign]/uploads`; verificar con pruebas de route handler con backends mockeados, incluida la ausencia de datos de contactos en logs
- [x] 4.2 Construir `/contactos`: selectores de campaña/flota/modo/agente con búsqueda, aviso sin habilitados, carga con límites, selector de columna (v4), mensaje/plantilla y código de país, tabla de inválidas, vista previa por agente, `ConfirmDialog` y estados de entrega (incluido "Procesando" con sondeo de 60 s para v4); registrar la sección en la navegación; verificar con pruebas de componente de cada escenario del spec
- [x] 4.3 Construir `/contactos/historial` con filtros de campaña y flota, Skeleton y estados (completada, fallida, procesada, rechazada); verificar con pruebas de componente
- [x] 4.4 Documentar en `admin-web/README.md` el flujo de carga, límites por flota y formato de CSV aceptado; verificar con un CSV de ejemplo de `*.example.csv`

## 5. Integración

- [ ] 5.1 Prueba de punta a punta en dev para v3 (reparto entre 2 agentes habilitados → archivos en `agents/`, consumo por el CLI) y v4 (asignar a un agente → jobs solo de ese agente, registro en historial con los mismos conteos que la vista previa); registrar evidencia en el PR
