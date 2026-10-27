# Proposal

## Why

Los tres clientes de ANA se enteran de los cambios por polling: el desktop v4 consulta `GET /jobs/poll` cada 5 s (más `GET /settings` cada 5 min), el CLI v3 consulta `GET /get/chats/{agent}/{campaign}` cada 30 s (más `GET /agent/settings` cada 5 min) y ANA Admin no se actualiza sola (cargas, contactos por revisar, roster, "Mi asignación"). Eso cuesta invocaciones inútiles casi siempre vacías, retrasa hasta 30 s una asignación publicada y obliga a recargar la consola. Un canal de notificaciones compartido permite avisar al momento y bajar el polling a respaldo lento.

## What Changes

- v4 backend: nueva API WebSocket de API Gateway en el stack `ana-backend-<stage>` (us-east-2), autenticada en `$connect` con el ID token de Cognito del pool `us-east-2_UepfOyKpd` (cliente `1r6niimhkl2fmias6kk85n4ou4`) enviado como subprotocolo, con chequeo de origen para navegadores.
- Registro de conexiones en una tabla DynamoDB nueva (`ana-backend-realtime-<stage>`) con suscripciones por usuario, por tipo de cliente y, para ANA Admin, por campaña; limpieza en `$disconnect`, TTL y borrado de conexiones muertas (410).
- Ruta `ping` (latido cada 5 min ante el límite de inactividad de 10 min) y reconexión planeada antes del máximo de 2 h.
- Catálogo cerrado de eventos v1 (`jobs.changed`, `uploads.changed`, `review.changed`, `roster.changed`, `assignment.pending`, `assignment.published`, `publications.changed`, `settings.changed`): solo avisos con ids, nunca datos de contactos; el cliente vuelve a leer por REST, que conserva toda la autorización.
- Bus EventBridge `ana-realtime-<stage>` y Lambda `notify` que reparte cada evento (`PostToConnection`); los handlers v4 (`csvTrigger`, `jobs/reassign`, `jobs/review/resolve`, `jobs/ack`, `POST /send`, `PUT /admin/desktop-settings`, `PUT /admin/agent-roster`) publican al bus sin bloquear su respuesta.
- Puente v3 → v4: el bucket `ana-backend-storage-<stage>` (us-east-1) publica sus eventos de objeto a EventBridge y una regla reenvía, entre regiones, solo los prefijos relevantes al bus de v4, donde se traducen a eventos del catálogo. Ningún handler v3 cambia.
- Interruptor `realtimeEnabled` (parámetro de despliegue): apagado rechaza conexiones nuevas, cierra las abiertas y descarta eventos, de modo que todos los clientes vuelven a su polling rápido.
- Observabilidad: métricas `AnaRealtime/*` (conexiones aceptadas/rechazadas, activas por tipo de cliente, envíos fallidos y 410), alarmas y logs sin tokens ni datos de contacto.

Sin cambios de contrato REST: los clientes instalados siguen funcionando con polling.

Fuera de alcance: los clientes (ver `add-realtime-v4-desktop`, `add-realtime-v3-cli`, `add-realtime-admin-web`), mensajes cliente→servidor distintos de `ping`, dominio propio para el endpoint, entrega garantizada o historial de eventos.

## Capabilities

### New Capabilities

- `v4/realtime-gateway`: endpoint WebSocket, autenticación y origen, registro de conexiones y suscripciones, latido y duración, catálogo y sobre de eventos, reparto, eventos emitidos por v4, interruptor y observabilidad.
- `v3/realtime-bridge`: qué cambios del almacenamiento S3 de v3 producen qué eventos del catálogo y cómo llegan a v4.

### Modified Capabilities

(ninguna; los productores v4 se describen como requisitos nuevos en `v4/realtime-gateway` para no chocar con los MODIFIED pendientes de `v4/job-processing`, `v4/send-jobs` y `v4/team-jobs`)

## Impact

- `v4/backend/serverless.yml`: `websocket` events (`$connect` con authorizer, `$disconnect`, `ping`), tabla `RealtimeTable`, bus `AnaRealtimeBus`, Lambda `notify` y `realtimeStats`, permisos `execute-api:ManageConnections` y `events:PutEvents`, salida `RealtimeWsUrl`, parámetro `realtimeEnabled`, alarmas.
- `v4/backend/src`: nuevos `handlers/realtime.ts` (authorizer, connect, disconnect, ping), `handlers/notify.ts`, `lib/realtime.ts` (`emitRealtime`, topics, sobre); llamadas a `emitRealtime` en `csvTrigger.ts`, `jobsAdmin.ts`, `jobsPoll.ts`, `directSend.ts`, `settings.ts`, `agents.ts`. Reutiliza `resolveUserAccess` (`lib/access.ts`) y `canonicalOperatorId`/`campaignKey` (`lib/identity.ts`).
- `v3/ana-backend/serverless.yml`: `NotificationConfiguration.EventBridgeConfiguration` en `StorageBucket`, regla en el bus por defecto de us-east-1 con destino el bus de us-east-2 y su rol IAM.
- Dependencia nueva en v4 backend: `@aws-sdk/client-apigatewaymanagementapi`, `@aws-sdk/client-eventbridge`; `aws-jwt-verify` ya se usa en el ecosistema.
- Costo: ver design.md (orden de dólares al mes para la flota actual).
- Otro ingeniero edita reglas de roles en `v4/backend` en paralelo: este cambio solo consume `resolveUserAccess` y no toca `permissions.ts`.
