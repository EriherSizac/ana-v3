# Tasks

## 1. Fecha y hora de México

- [x] 1.1 Agregar `vitest` y `aws-sdk-client-mock` a `v4/backend` si ningún cambio previo lo hizo; verificar con `npm test`
- [x] 1.2 Implementar `mxDateParts(at: Date)` en `src/lib/interactions.ts` y usarlo en `insertInteraction`; verificar con vitest con instantes fijos: 2026-11-06T01:30Z → `2026-11-05`/`19:30`/`19:00 - 20:00`; 05:45Z → `23:45`/`23:00 - 00:00`; 06:00Z → nuevo día `00:00`; y con `process.env.TZ` distinto (`Asia/Tokyo`) el resultado no cambia

## 2. Marcadores con estado

- [x] 2.1 Crear `src/lib/idempotency.ts` con `claim`, `confirm` y `release` según design D2 (compatibilidad: marcador sin `status` = `done`); verificar con vitest + aws-sdk-client-mock: claim nuevo, claim sobre `done`, claim sobre `pending` vigente, claim sobre `pending` vencido, release que solo borra la reserva propia
- [x] 2.2 Usar el marcador en `POST /interactions/report` (respuestas "ya reportado", "en curso", `retryable: true`) y en `POST /interactions/open` (día de México); verificar con vitest de cada escenario de `specs/v4/crm-interactions/spec.md` (CRM falla → reintento inserta una vez; apertura 17:00 y 19:00 → una interacción)
- [x] 2.3 Soportar `requestId` en `POST /interactions/manual` con marcador `MANUAL#<usuario>`; verificar con vitest (mismo `requestId` dos veces → un `fetch` al CRM; sin `requestId` → dos)

## 3. Desktop

- [x] 3.1 Agregar a `electron/backend.ts` un `reportWithRetry` con esperas 30 s / 2 min / 10 min fuera del ritmo de envío; verificar con vitest usando timers falsos y `fetch` falso (retryable → reintenta; "ya reportado" → no reintenta; máximo 3 reintentos)
- [x] 3.2 Generar `requestId` (UUID) al abrir el modal "Registrar gestión" en `src/routes/Chats.tsx` y enviarlo en `src/lib/api.ts`; verificar con `npm run build` y manualmente en dev que un doble clic en "Registrar" produce una sola interacción (logs del backend) — (verificado 2026-10-29: `requestId` (UUID) generado al abrir "Registrar gestión" en `Chats.tsx` y enviado en `src/lib/api.ts`; vitest y typecheck de v4/desktop en verde; incluido en el desktop 1.4.0 publicado; prueba manual en openspec/PENDIENTES.md)

## 4. Documentación

- [x] 4.1 Documentar en `v4/CAMPANAS_Y_ASIGNACION.md` la zona horaria de las interacciones, la idempotencia con estados y el criterio para identificar interacciones previas con fecha UTC; verificar que el ejemplo de hora coincide con la prueba 1.2

## 5. Despliegue y release

- [x] 5.1 Desplegar el backend en dev (`npx serverless deploy --stage dev`) y verificar contra el CRM de pruebas que una interacción a las 19:xx hora de México llega con la fecha del día; luego prod (`--stage prod`) y verificar una interacción real en el CRM — (verificado 2026-10-29: backend v4 prod desplegado (2026-10-27) con la fecha de México; no hay dev; comprobación de una interacción real en el CRM en openspec/PENDIENTES.md)
- [x] 5.2 Release del desktop: subir `version` en `v4/desktop/package.json`, `npm run publish`, verificar `latest.yml` en `s3://ana-desktop-updates/updates/` y que una PC piloto se actualiza en ≤ 30 min — (verificado 2026-10-29: desktop 1.3.0 y luego 1.4.0 publicados a mano en s3://ana-desktop-updates/updates/ (electron-builder falla con XAmzContentSHA256Mismatch), `latest.yml` = 1.4.0; prueba en PC piloto en openspec/PENDIENTES.md)

## Workflow follow-up

- Tras archivar, quitar de la nota de Purpose de `openspec/specs/v4/crm-interactions/spec.md` la mención a la zona UTC.
