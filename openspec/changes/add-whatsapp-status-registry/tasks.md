# Tasks

## 1. Backend v3

- [x] 1.1 `serverless.yml`: tabla `WaStatusTable` (PAY_PER_REQUEST, PITR, Retain), `WA_STATUS_TABLE`, permisos DynamoDB en el rol, funciones `agentPostWaStatus`, `agentLookupWaStatus`, `adminPostWaStatus`, `adminLookupWaStatus`; dependencias `@aws-sdk/client-dynamodb` y `@aws-sdk/lib-dynamodb`; prueba estática de serverless
- [x] 1.2 `src/lib/waStatus.ts`: normalización (D2), escritura ordenada (D3), marca manual (D5) y consulta por lote con reintentos (D6); vitest con DynamoDB mockeado (orden, reintento, bloques de 100, `UnprocessedKeys`)
- [x] 1.3 `src/handlers/waStatus.ts` y llamada de mejor esfuerzo en `agentResults.postResults` (D4); vitest de autorización (401/403 sin tocar DynamoDB), 400 por > 2000 teléfonos y lote aceptado aunque falle el registro

## 2. ANA Admin

- [ ] 2.1 BFF `/api/agent/wa-status`, `/api/agent/wa-status/lookup` (permiso de envío) y `/api/campaigns/[campaign]/wa-status/lookup` (permiso de subir Contactos); pruebas de rutas
- [ ] 2.2 `lib/wa-status.ts` y hook `useWaStatus` (D7–D9); pruebas de clasificación, filtro y elección automática, incluida equivalencia con `buildPublication` de v3
- [ ] 2.3 `WaStatusBadge`, `WaStatusPanel` e integración mínima en `MyAssignmentView`; pruebas de insignias, aviso, filtro, marca por fila y en lote (optimista y reversión)
- [ ] 2.4 `WaUploadNotice` en la vista previa de `ContactsUploadView`; prueba de conteo no bloqueante
- [ ] 2.5 Verificar `test`, `typecheck`, `lint`, `check:design`, `next build` con `.env.test` y `check:bundle`

## 3. Despliegue

- [ ] 3.1 Desplegar v3 backend (crea la tabla); verificar con `curl` que `POST /agent/wa-status/lookup` sin token responde 401
- [ ] 3.2 Desplegar ANA Admin y comprobar con un agente de prueba: un número reportado `no_whatsapp` aparece marcado en Mi asignación y "Marcar con WhatsApp" lo corrige
- [ ] 3.3 Pendiente (otra change): escritura desde v4 desktop con `source: v4_desktop`
