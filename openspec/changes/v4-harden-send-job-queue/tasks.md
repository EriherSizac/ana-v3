# Tasks

## 1. Índice por campaña con estado

- [x] 1.1 Agregar `vitest` y `aws-sdk-client-mock` a `v4/backend` si ningún cambio previo lo hizo; verificar con `npm test`
- [ ] 1.2 Deploy A: agregar en `serverless.yml` el GSI `campaign-status-index` (design D1) sin tocar `campaign-index`, y la variable `JOBS_CAMPAIGN_INDEX` (valor inicial `campaign-index`); verificar con `npx serverless deploy --stage dev` y `aws dynamodb describe-table` (índice `ACTIVE`), luego lo mismo en prod

## 2. Poll y ack

- [x] 2.1 Reescribir `poll` en `jobsPoll.ts` según design D3 (no finales primero hasta 2000, 300 finales por `sentAt`, `truncated`, totales; `leased`/sin estado = pendiente); verificar con vitest (partición falsa de 2500 enviados + 40 pendientes; 3000 pendientes → `truncated`)
- [x] 2.2 Reescribir `ack` según design D4 (`acked` real, `notFound`, `invalid`); verificar con vitest de los tres escenarios de `specs/v4/send-jobs/spec.md`
- [x] 2.3 Dejar de escribir `leaseUntil` en jobs nuevos (`csvTrigger`, `directSend`) y quitar `LEASE_MS` sin uso de `lib/jobs.ts`; verificar con `npx tsc --noEmit` y vitest de la forma del job

## 3. Resumen y reasignación

- [x] 3.1 Cambiar `summary` en `jobsAdmin.ts` para usar `process.env.JOBS_CAMPAIGN_INDEX` y filtrar por `status`; verificar con vitest (10 `sent` + 2 `pending` → `pending: 2`; `leased` siempre 0)
- [x] 3.2 Reescribir `reassign` según design D7 (condición por estado, concurrencia 10, presupuesto 25 s, `partial`, `skipped` = `skippedLeased`); verificar con vitest (carrera → `skipped`; historial no se intenta; presupuesto agotado con reloj falso → `partial: true`)

## 4. Carga de CSV

- [x] 4.1 En `presignCsv` (`api.ts`), firmar `campaignid` = key sin `csv-uploads/` y `label` = `campaignId` del cliente (100 caracteres); verificar con vitest del presign (metadata esperada)
- [x] 4.2 En `csvTrigger.ts`, `jobId = <campaignid>#<i>` con `label`, marcador `UPLOAD#<srcKey>` condicional, reintento de `UnprocessedItems` (6 intentos, espera exponencial con jitter), `csv_jobs_partial` y `csv_rejected`/`parse_error` sin lanzar; verificar con vitest + aws-sdk-client-mock (evento duplicado no escribe; `UnprocessedItems` en el primer intento se reintenta; CSV con comilla sin cerrar no lanza)

- [x] 4.3 Borrar el objeto al terminar la escritura completa (conservar en escritura parcial) y agregar al `CsvBucket` una regla de ciclo de vida que expira `csv-uploads/` a los 7 días; verificar con vitest (escritura completa → `DeleteObject`; parcial → sin borrar) y con `npx serverless package` que la plantilla contiene la `LifecycleConfiguration`

## 5. Desktop

- [x] 5.1 Leer `truncated`/`pendingTotal` en `electron/jobs/poller.ts` y mostrar el aviso en `src/routes/Assignment.tsx`; verificar con vitest del poller (propaga los campos) y `npm run build`

## 6. Documentación

- [x] 6.1 Alinear `v4/ARCHITECTURE.md`, `v4/ARQUITECTURA_FLUJOS.md`, `v4/CONTEXT.md` y `v4/CAMPANAS_Y_ASIGNACION.md` con el código: sin lease, `ack` no borra, poll con prioridad de pendientes, identificador de carga del servidor y `label`; verificar con `git grep -n -i "lease" -- v4/*.md` que solo quedan menciones al estado heredado

## 7. Despliegue y release

- [ ] 7.1 Deploy B en dev con `JOBS_CAMPAIGN_INDEX=campaign-status-index`; verificar con una carga de prueba que `GET /jobs/summary` no cuenta enviados, que subir dos veces el mismo CSV crea jobs distintos y que `POST /jobs/reassign` no reporta `skipped` por historial; luego prod
- [ ] 7.2 Release del desktop: subir `version`, `npm run publish`, verificar `latest.yml` en `s3://ana-desktop-updates/updates/` y en la PC piloto que "Mi asignación" carga normalmente
- [ ] 7.3 Deploy C (≥ 1 día sin errores en prod): retirar `campaign-index` de `serverless.yml` y desplegar dev y prod; verificar con `aws dynamodb describe-table` que solo queda `campaign-status-index` y que el resumen sigue respondiendo

## Workflow follow-up

- Tras archivar, quitar de la nota de Purpose de `openspec/specs/v4/send-jobs/spec.md` la discrepancia de lease con la documentación (ya alineada) y de `openspec/specs/v4/csv-ingestion/spec.md` la nota de `BatchWrite`.
