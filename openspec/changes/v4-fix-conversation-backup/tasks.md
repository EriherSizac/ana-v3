# Tasks

## 1. Backend: resumen y leída

- [x] 1.1 Agregar `vitest` y `aws-sdk-client-mock` a `v4/backend` si ningún cambio previo lo hizo; verificar con `npm test`
- [x] 1.2 Reescribir `putMessage` en `api.ts` según design D1; verificar con vitest + aws-sdk-client-mock: mensaje repetido → sin `UpdateCommand`; entrante nuevo → `ADD unreadCount 1`; mensaje viejo → `lastMessage` condicionado
- [x] 1.3 Implementar `POST /conversations/{chatId}/read` (design D4) y registrarla en `serverless.yml`; verificar con vitest (partición propia aunque llegue `operatorId`; inexistente → 200 sin crear)

## 2. Backend: paginación

- [ ] 2.1 Deploy A: agregar el GSI `operator-recent-index` a `ConversationsTable` en `serverless.yml`; verificar con `npx serverless deploy --stage dev` y `aws dynamodb describe-table` (`ACTIVE`), luego prod
- [x] 2.2 Paginar `listConversations` (índice, `limit`, `nextToken` base64url) y hacer que `putConversationMeta` fije `lastMessageTime` con `if_not_exists`; verificar con vitest (450 items en páginas de 200; `nextToken` inválido → 400 `{"error":"nextToken inválido"}`)
- [x] 2.3 Paginar `listMessages` (descendente, invertir página, `limit`, `nextToken`); verificar con vitest (700 mensajes → 200 más recientes ascendentes + `nextToken`)

## 3. Desktop

- [x] 3.1 Agregar `vitest` a `v4/desktop` si ningún cambio previo lo hizo y extraer a `src/lib/` funciones puras de fusión de páginas (`mergeConversations`, `prependMessages` sin duplicar ids); verificar con vitest
- [ ] 3.2 En `src/routes/Chats.tsx` y `src/lib/api.ts`: conteo de no leídos, "Cargar más", error con "Reintentar", "Ver mensajes anteriores", `POST /conversations/{chatId}/read` al abrir chat propio y recarga silenciosa de la lista ante `wa:sent` exitoso; verificar con `npm run build` y manualmente en dev con un chat de más de 200 mensajes
- [ ] 3.3 Escuchar `message_create` con `fromMe` en `electron/whatsapp/client.ts` y persistirlo como los entrantes; verificar en dev enviando un mensaje desde el teléfono vinculado (aparece en el hilo tras recargar) y una respuesta desde la app (un solo item en la tabla de mensajes)

## 4. Documentación

- [x] 4.1 Actualizar `v4/ARCHITECTURE.md` (paginación, leída, mensajes propios); verificar que los parámetros documentados coinciden con las pruebas 2.2/2.3

## 5. Despliegue y release

- [ ] 5.1 Deploy B del backend en dev y prod; verificar con `curl` que `GET /conversations?limit=2` trae `nextToken` y que un `PUT /messages` repetido no cambia `unreadCount`
- [ ] 5.2 Release del desktop: subir `version`, `npm run publish`, verificar `latest.yml` en `s3://ana-desktop-updates/updates/` y en la PC piloto la lista con "Cargar más" y el conteo de no leídos

## Workflow follow-up

- Tras archivar, quitar de la nota de Purpose de `openspec/specs/v4/desktop-chats/spec.md` la frase sobre la lista que no se refresca tras envíos de campaña y de `whatsapp-session` la de mensajes propios no capturados.
