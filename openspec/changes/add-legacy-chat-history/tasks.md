# Tasks

## 1. v3: lectura del archivo legado

- [ ] 1.1 Implementar `v3/ana-backend/src/lib/legacyChats.ts` (lectura del índice con `schemaVersion` 1, filtros `agent`/`phone`/`from`/`to`, orden y paginación de 50; lectura de `chat_backup.json` con campos `id`, `timestamp`, `from`, `body`, `media`; reescritura `media/{campaign}/...` → `legacy/media/{campaign}/...` y URL prefirmada de 300 s con `attachment` para tipos que no son imagen/audio/video, design.md D3); verificar con `test/legacyChats.test.ts` (S3 mockeado): filtro por dígitos `5512345678` encuentra `5215512345678`, `from` > `to` → error, índice inexistente → vacío, media de otra campaña → `null`, PDF con `attachment`
- [ ] 1.2 Implementar `requireLegacyChatAccess` (design.md D2) sobre la resolución de `requireAdminAccess`; verificar con pruebas: admin en cualquier campaña, líder en su campaña, líder en otra → 403 sin S3, usuario con `*` y `isLeader`, v4 caído → 503
- [ ] 1.3 Crear `src/handlers/adminLegacyChats.ts` con `GET /admin/campaigns/{campaign}/legacy-chats`, `GET /admin/campaigns/{campaign}/legacy-chats/{agent}/{phone}` y `GET /admin/campaigns/{campaign}/legacy-agents` (design.md D6), el log `legacy_chat_access` (design.md D5) y registrarlas en `serverless.yml` con `cognitoAdminJwt`; verificar con pruebas de handler cada escenario de `specs/v3/legacy-chat-archive/spec.md`, que solo hay métodos `GET` y que ninguna línea de log contiene `body` ni URLs firmadas

## 2. v3: índice

- [ ] 2.1 Crear `scripts/build-legacy-chat-index.ts` (design.md D1: listado paginado de `legacy/backups/{campaign}/`, excluye los respaldos diarios `{YYYY-MM}/`, fechas desde los mensajes, respaldo ilegible con `totalMessages: 0`, dry-run por defecto, `--apply`, `--bucket`, `--profile`, `--campaign` opcional, nunca imprime contenidos); verificar con `test/build-legacy-chat-index.test.ts` contra S3 mockeado: índice esperado para 2 conversaciones, respaldo ilegible, dry-run sin `PutObject`
- [ ] 2.2 Documentar en `v3/ana-backend/README.md` las rutas, la regla de acceso y cómo regenerar el índice; verificar que el comando documentado corre en dry-run contra dev

## 3. ANA Admin: sección Historial legacy

- [ ] 3.1 Crear las rutas BFF `GET /api/campaigns/[campaign]/legacy-chats`, `GET /api/campaigns/[campaign]/legacy-chats/[agent]/[phone]` y `GET /api/campaigns/[campaign]/legacy-agents` con `withAccess` y la regla admin/líder por campaña, sin caché; verificar con pruebas de route handler (backend mockeado): 403 para usuario sin rol, propagación del token, sin llaves en la solicitud
- [ ] 3.2 Construir `/historial-legacy` (selector de campaña con búsqueda, filtros en pills por agente legado (selector con nombres de `legacy-agents` unidos a los del índice, etiqueta "Legacy", sin acciones de habilitación), teléfono y fechas, tabla paginada con Skeleton y "Sin conversaciones") y registrarla en la navegación solo para `isAdmin`/`isLeader`; verificar con pruebas de componente de los escenarios de búsqueda, visibilidad y "Agentes legados como referencia" del spec (incluido un nombre que coincide con un username del pool)
- [ ] 3.3 Construir la vista de conversación (texto con `white-space: pre-wrap`, hora en `America/Mexico_City`, imágenes/audio/video con URL prefirmada, enlace de descarga para otros tipos, "Multimedia no disponible", nueva solicitud al fallar una URL vencida) y activar `react/no-danger` en ESLint; verificar con pruebas de componente que `<img src=x onerror=alert(1)>` se muestra literal sin crear `img`, y que `npm run lint` falla con un `dangerouslySetInnerHTML` de prueba

## 4. Despliegue y verificación

- [ ] 4.1 Confirmar que el movimiento a `legacy/` y la extracción de `legacy/agents/` de `migrate-cli-to-cognito-login` (tarea 8.5) terminaron; desplegar v3 en prod, ejecutar el índice en dry-run y `--apply`; verificar que existe `legacy/index/{campaign}.json` por cada campaña con historial y que sus conteos coinciden con el inventario del movimiento
- [ ] 4.2 Prueba de aceptación en prod con un admin y un líder: búsqueda por teléfono y fecha, apertura de una conversación con imagen, líder bloqueado en una campaña ajena, y línea `legacy_chat_access` en CloudWatch sin contenido; registrar resultados en el PR
