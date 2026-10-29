# Tasks

## 1. Backend v3

- [x] 1.1 `chats.ts`: cabecera `X-Ana-Assignment-Key` en la respuesta 200 de `GET /get/chats`; verificar con vitest que el cuerpo no cambia
- [x] 1.2 `src/lib/sendResults.ts`: validación de items, día MX, llave del lote (D4), lectura con deduplicación y compactación (D5), filtros, orden, cursor y agregados por publicación (D6); verificar con vitest (S3 mockeado)
- [x] 1.3 `src/handlers/agentResults.ts`: `POST /agent/results`, `GET /agent/results/{campaign}` y `GET /admin/campaigns/{campaign}/results` con la autorización de D8; verificar 400/403 sin tocar S3, reintento idempotente (412) y respuestas sin teléfonos completos
- [x] 1.4 `serverless.yml`: tres funciones (`timeout: 29` en lecturas), regla de ciclo de vida `results/` 180 días y prefijo `results/` en la regla del puente; actualizar las pruebas estáticas de serverless

## 2. Realtime (v4 backend y ANA Admin)

- [x] 2.1 v4 `realtime.ts`: `results.changed` en `USER_EVENTS`; `realtimeBridge.ts`: prefijo `results/` → `results.changed` al agente (sin `_compact.json`); verificar con las pruebas de realtime de v4
- [x] 2.2 ANA Admin: `results.changed` en `KNOWN_EVENTS`

## 3. CLI v3

- [x] 3.1 `results-outbox.js` (D3) y `buildResultItem`; pruebas `node:test` de deduplicación, persistencia tras reinicio, reintento con espera, descarte con 400 y lotes por campaña
- [x] 3.2 `agent-config.js` devuelve `sourceKey` de la cabecera; `assignment-journal.js` guarda `source_key` opcional; `index.js` encola tras cada intento y al marcar `por_revisar`, e inicia la bandeja tras el login
- [x] 3.3 `build-portable.ps1`: agregar `results-outbox.js` a `$filesToCopy`; verificar `node --check` de los módulos y `npm run build:bundle`

## 4. ANA Admin

- [x] 4.1 BFF: `/api/agent/results/[campaign]` (permiso de envío) y `/api/campaigns/[campaign]/results` (permisos de Contactos) con validación de query; pruebas de rutas
- [x] 4.2 `lib/workspace/send-history.ts` (query, etiquetas, CSV, hora MX) y `components/workspace/SendHistoryView.tsx` (tarjetas, tabla, filtros, orden, exportación, Skeleton, recarga en vivo); páginas `/mi-asignacion/historial` y `/historial-envios`, sección nueva y enlace en Mi asignación; pruebas de vista
- [x] 4.3 Verificar `test`, `typecheck`, `lint`, `check:design`, `next build` con `.env.test` y `check:bundle`

## 5. Despliegue y release

- [ ] 5.1 Desplegar v4 backend (evento `results.changed`), luego v3 backend a prod; verificar con `curl` que `POST /agent/results` sin token responde 401
- [ ] 5.2 Desplegar ANA Admin y comprobar la vista con un agente de prueba
- [ ] 5.3 Release del CLI 1.0.51 y prueba de punta a punta: una publicación de 3 contactos aparece con sus 3 resultados en el historial
