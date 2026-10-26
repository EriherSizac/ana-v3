# Tasks

## 1. v4: permiso y habilitación en el roster

- [ ] 1.1 Agregar `AGENTS_MANAGE: 'ana:admin:agents:manage'` a `v4/backend/src/lib/permissions.ts` y otorgarlo a líderes en `resolveUserAccess` (`access.ts`); agregar vitest en `v4/backend` (si no existe) y verificar con pruebas que líder y admin lo reciben, un agente no, y que `setRolePerms` lo acepta como válido
- [ ] 1.2 Cambiar `registerAgent` (`lib/agents.ts`) a `UpdateCommand SET lastSeen` y extender `listCampaignAgents` con `enabled/enabledUpdatedAt/enabledUpdatedBy`; agregar `setAgentsEnabled(campaign, entries, by)` y `listEnabledAgents(campaign)`/`isCampaignManaged`; verificar con pruebas (cliente DynamoDB mockeado) que el heartbeat no borra `enabled`
- [ ] 1.3 Agregar `GET /admin/agent-roster` y `POST /admin/agent-roster` al handler `agents.ts` y a `serverless.yml` con `authorizer: cognitoJwt`, autorización fail-closed (admin o permiso + campaña propia), validación de body (1–100, booleanos) y `campaignExists`; verificar con pruebas de handler: 403 con flag off, 400 por campaña inexistente, 200 con roster actualizado
- [ ] 1.4 Aplicar el filtro de habilitados en campañas gestionadas a `getEligibleAgents` en el presign (`eligibleAgents`) y en `csvTrigger`, y validar destinatarios de `assignments` en `presignCsv`; verificar con pruebas: campaña no gestionada sin cambios, gestionada filtra, ninguno habilitado → uploader, `assignments` a deshabilitado → 400
- [ ] 1.5 Documentar en `v4/CAMPANAS_Y_ASIGNACION.md` (sección "Habilitación desde ANA Admin") las rutas nuevas, la regla de campaña gestionada y el nuevo permiso; verificar que los ejemplos coinciden con las pruebas

## 2. v3: base de administración autenticada

- [ ] 2.1 Agregar vitest y `aws-sdk-client-mock` como devDependencies en `v3/ana-backend` (reutilizar si otra change ya los agregó) y actualizar `@aws-sdk/client-s3` a una versión con `IfMatch`/`IfNoneMatch` en `PutObject`; verificar `npm test` y `tsc --noEmit` limpios
- [ ] 2.2 Declarar en `serverless.yml` el authorizer `cognitoAdminJwt` (emisor del pool, audiencia `${env:COGNITO_ADMIN_CLIENT_IDS}` separada por comas) y las variables `COGNITO_ADMIN_CLIENT_IDS`, `ANA_V4_API_BASE`; actualizar `.env.example`; verificar con `serverless package` que las rutas `/admin/*` quedan con authorizer y las demás no cambian
- [ ] 2.3 Implementar `src/lib/identifiers.ts` (normalización y regex de campaña/username) y `src/lib/adminAccess.ts` (v4 `GET /me`, timeout 5 s, caché 60 s sin errores, decisión por `permissions/campaigns/isAdmin`, respuestas 403/503 sin detalle); verificar con pruebas unitarias de cada caso del spec `v3/backend-api-security`

## 3. v3: roster

- [ ] 3.1 Implementar `src/lib/roster.ts` (`readRoster` con regla de habilitación y error ante JSON inválido o versión ≠ 1, `isAgentEnabled`, `updateRoster` con escritura condicional y 3 reintentos) exportando el contrato para que lo reuse `migrate-cli-to-cognito-login`; verificar con pruebas: inexistente = vacío, versión 2 = error, `"true"` texto no habilita, conflicto concurrente fusiona, 409 tras 3 fallos
- [ ] 3.2 Implementar `src/handlers/adminRoster.ts` con `GET /admin/campaigns/{campaign}/roster` y `POST /admin/campaigns/{campaign}/roster/agents` (validaciones, `updatedBy` del token, orden por username) y registrarlas en `serverless.yml`; verificar con pruebas de handler cada escenario de `specs/v3/agent-roster/spec.md`
- [ ] 3.3 Crear `scripts/seed-rosters-from-credentials.ts` (dry-run por defecto, `--apply`, perfil `pernexium`, reporte de no emparejados y campañas fuera del catálogo); verificar con prueba contra S3/Cognito mockeados y una corrida dry-run real en prod adjunta al PR
- [ ] 3.4 Documentar en `v3/ana-backend/README.md` y `README-SUPERVISORES.md` el roster (llave, forma, regla), las rutas `/admin/*`, el uso de ANA Admin en lugar de `credentials.csv` y el plan de retiro de `X-Admin-Key`; verificar que los ejemplos `curl` funcionan contra dev con un id token

## 4. ANA Admin: sección Agentes

- [ ] 4.1 Implementar `src/server/directory/` (`ListUsers` paginado con `@aws-sdk/client-cognito-identity-provider` en `us-east-2`, API de Roles `GET /users` y `GET /users/{username}`, caché 5 min con invalidación) y clientes `src/server/backends/{v3Roster,v4Roster}.ts`; verificar con pruebas mockeadas que la API de Roles caída no rompe el listado
- [ ] 4.2 Crear `GET /api/users` (búsqueda, filtros por estado de flota y "con rol en la campaña", página de 50) y `POST /api/campaigns/[campaign]/agents` (permiso `ana:admin:agents:manage`, alcance, 409 si deshabilitado en Cognito, 400 si no existe en el pool, propagación del token); verificar con pruebas de route handler
- [ ] 4.3 Construir `/agentes`: selector de campaña con búsqueda, filtros Notion-style con pills, tabla con Skeleton, columnas de roles/campañas y estado v3/v4, sección "fuera del pool", acciones por fila y barra masiva con `ConfirmDialog` (advertencias de sin rol y de primera gestión v4) y reporte por flota; registrar la sección en la navegación; verificar con pruebas de componente (habilitar, fallo parcial, usuario deshabilitado en Cognito)
- [ ] 4.4 Configurar el permiso IAM `cognito-idp:ListUsers` sobre el ARN del pool en el rol de cómputo del hosting y documentarlo en `admin-web/README.md`; verificar en el entorno desplegado que `/api/users` responde 200

## 5. Integración

- [ ] 5.1 Prueba de punta a punta en dev: habilitar un usuario en v3 y v4 desde ANA Admin, verificar `rosters/{campaign}.json` en S3 y la entrada en la tabla `agents`, subir por presign v4 con `distribute` y confirmar que solo recibe jobs el habilitado; registrar evidencia en el PR
- [ ] 5.2 Verificar con quien implementa `migrate-cli-to-cognito-login` que su lector usa `src/lib/roster.ts` (o el mismo contrato) y que un agente habilitado desde ANA Admin ve la campaña en `GET /agent/campaigns`
