# Tasks

## 1. Infraestructura de pruebas del backend

- [x] 1.1 Si `v3/ana-backend` aún no tiene suite (otro cambio pudo agregarla), agregar devDependencies `vitest` y `aws-sdk-client-mock`, el script `"test": "vitest run"` y `vitest.config.ts` con `include: ['test/**/*.test.ts']`; verificar que `npm test` corre y que `npm run build` no compila `test/`

## 2. Llave de administración en las lecturas de supervisor

- [x] 2.1 En `src/handlers/supervisors.ts`, agregar `requireAdmin` al inicio de `getAgentContacts`, `listAgentAssignments` y `getAgentAssignments`; verificar con `test/supervisors-read.test.ts` que sin llave → 401 sin llamadas a S3, llave vacía en entorno → 503, y llave válida → comportamiento actual (200 con CSV / listado, 404)
- [x] 2.2 Actualizar `v3/ana-backend/README.md` (tabla de endpoints: las tres consultas llevan `X-Admin-Key`) y `README-SUPERVISORES.md` (las tres consultas `GET /supervisors/...` llevan `-H "X-Admin-Key: $ADMIN_API_KEY"`); verificar que los `curl` documentados responden 200/404 contra el stage dev con la llave y 401 sin ella (no existe stage dev de v3: cubierto por pruebas de handler; verificación real en 3.2)
- [x] 2.3 Verificar `npm test` y `npm run build` en verde en `v3/ana-backend`

## 3. Despliegue

- [ ] 3.1 Antes del deploy, revisar en CloudWatch (métrica `AWS/Lambda Invocations` y logs de `ana-backend-prod-getAgentContacts`, `-listAgentAssignments`, `-getAgentAssignments`, últimos 30 días) que no hay consumidores distintos de supervisores; si los hay, detener y escalar; dejar el resultado en `PLAN_SEGURIDAD_Y_DEUDA.md`
- [ ] 3.2 Desplegar prod (`npm run deploy -- --stage prod`); verificar con `curl` que las tres consultas responden 401 sin llave y 200/404 con llave, y actualizar F1.4 en `PLAN_SEGURIDAD_Y_DEUDA.md` con la fecha y el commit (la parte de `GET /get/chats` queda a cargo de `migrate-cli-to-cognito-login`)

## Workflow follow-up

- Archivar este cambio antes que `migrate-cli-to-cognito-login` (ambos modifican "Rutas intencionalmente públicas" de `backend-api-security`; este primero).
- Al archivar, actualizar la nota de Purpose de `openspec/specs/v3/agent-assignments/spec.md` (lecturas `GET /supervisors/...` sin `X-Admin-Key`).
