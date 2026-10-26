# Tasks

## 1. Backend: reserva, revisión y acuse

- [ ] 1.1 Agregar a `src/lib/jobs.ts` los estados `sending`, `review`, `discarded` y una función pura `classify(job, now)` (pendiente / por revisar / final, con vencimiento de 10 min de `sending`); verificar con vitest de cada estado y del umbral exacto
- [ ] 1.2 Implementar `POST /jobs/claim` en `jobsPoll.ts` con `UpdateCommand` condicional (design D1) y registrar la ruta en `serverless.yml` (authorizer `cognitoJwt`); verificar con vitest + aws-sdk-client-mock (pending → 200; `sending`/`sent`/inexistente → 409 con `status`)
- [ ] 1.3 En `poll`, aplicar el paso perezoso `sending` vencido → `review` (escritura condicional) y devolver `sending`/`review` con los no finales y `discarded` con los finales; verificar con vitest (job reservado hace 11 min → `review`; hace 5 min → sigue `sending`)
- [ ] 1.4 Extender `ack` con las transiciones de design D3 (`discarded` → `invalid`); verificar con vitest de "Acuse tardío" y "Acuse de un descartado"

## 2. Backend: consulta y resolución

- [ ] 2.1 Implementar `GET /jobs/review` en `jobsAdmin.ts` (índice por campaña filtrando `review`/`discarded`/`sending` vencidos, `srcKey` opcional, `BatchGet` de la tabla base para `row`/`phone`, misma autorización que `summary`); verificar con vitest (filtro por `srcKey`, campaña ajena → 403, sin `campaign` → 400)
- [ ] 2.2 Implementar `POST /jobs/review/resolve` (design D5, máx. 100 items, transacción para `requeue`, autorización de `reassign`); verificar con vitest de los tres escenarios de resolución de `specs/v4/send-jobs/spec.md`
- [ ] 2.3 Agregar `review` por operador a `GET /jobs/summary`; verificar con vitest (3 pendientes + 2 `review` → `pending: 3`, `review: 2`, `total: 3`)
- [ ] 2.4 Documentar en `v4/ARCHITECTURE.md` y `v4/CAMPANAS_Y_ASIGNACION.md` los estados, la reserva, el umbral de 10 min y la resolución; verificar que los nombres de rutas y estados coinciden con `serverless.yml` y `lib/jobs.ts`

## 3. Desktop

- [ ] 3.1 En `electron/jobs/poller.ts`, reservar antes de `runJob` (409 → saltar; red → saltar sin enviar), reintentar el ack (1 s, 5 s, 30 s) y considerar `sending`/`review` como no aprobables; verificar con vitest de `JobPoller` con dependencias falsas (claim 409 no llama `runJob`; ack falla 2 veces y luego ok → un solo `runJob`; borrado del CSV solo sin pendientes ni reservados)
- [ ] 3.2 Agregar la pestaña "Por revisar (N)" en `src/routes/Assignment.tsx` y "Descartado" en historial; verificar con `npm run build` y manualmente en dev cerrando la app durante "escribiendo…" y reabriendo 11 min después (el contacto aparece en "Por revisar" y no se reenvía)
- [ ] 3.3 Mostrar "N por revisar" en `src/routes/TeamViewer.tsx`; verificar con `npm run build` y en dev con el resumen de la campaña de prueba

## 4. ANA Admin

- [ ] 4.1 Agregar rutas BFF `/api/v4/campaigns/{campaign}/review` (GET con `srcKey` opcional) y `/api/v4/campaigns/{campaign}/review/resolve` (POST) que propagan el id token a v4, con alcance de campaña del acceso del usuario; verificar con pruebas vitest del BFF (campaña fuera de alcance → 403 sin llamar a v4)
- [ ] 4.2 Agregar la sección "Por revisar" al detalle de carga v4 y la vista "Por revisar (v4)" por campaña, con acciones, `ConfirmDialog` y destinos del roster v4 habilitado; verificar con pruebas de componente de cada escenario de `specs/admin-web/contact-upload/spec.md` y con el lint del sistema de diseño de `admin-web`

## 5. Despliegue y release

- [ ] 5.1 Desplegar el backend en dev y prod (`npx serverless deploy --stage dev|prod` en `v4/backend`); verificar con `curl` en dev: claim 200/409, poll con un job `review`, resolve `discard`
- [ ] 5.2 Release del desktop: subir `version`, `npm run publish`, verificar `latest.yml` en `s3://ana-desktop-updates/updates/` y repetir en la PC piloto la prueba de 3.2
- [ ] 5.3 Desplegar ANA Admin (Amplify Hosting, rama de la app) y verificar en el ambiente de pruebas el flujo completo: carga v4 → interrupción → "Por revisar" en el detalle → "Reenviar a…" → el agente destino lo ve pendiente

## Workflow follow-up

- Archivar después de `v4-harden-send-job-queue` (este cambio modifica "Tabla de jobs" partiendo de su versión) y después de `add-contact-upload-console` (agrega requisitos a `admin-web/contact-upload`).
- Tras archivar, quitar de la nota de Purpose de `openspec/specs/v4/job-processing/spec.md` y de "Chequeo periódico y overlay a media sesión" en `desktop-update` la mención al job sin acuse que puede reenviarse.
