# Tasks

## 1. Infraestructura del gateway (v4)

- [ ] 1.1 Agregar a `v4/backend/serverless.yml` la tabla `RealtimeTable` (`PK`/`SK`, on-demand, TTL `ttl`), el bus `AnaRealtimeBus`, el parámetro `realtimeEnabled`, las env `REALTIME_TABLE`, `REALTIME_BUS`, `REALTIME_ENABLED`, `REALTIME_ALLOWED_ORIGINS`, permisos IAM (`dynamodb:*Item/Query/BatchWriteItem` sobre la tabla, `events:PutEvents`, `execute-api:ManageConnections`) y la salida `RealtimeWsUrl`; verificar con `npx serverless package --stage dev` que la plantilla contiene los recursos y que no cambian los recursos existentes
- [ ] 1.2 Agregar dependencias `@aws-sdk/client-apigatewaymanagementapi`, `@aws-sdk/client-eventbridge` y `aws-jwt-verify` (si falta) en `v4/backend`; verificar con `npm ci && npm run build`

## 2. Conexión, autenticación y latido

- [ ] 2.1 Crear `src/lib/realtime.ts` con temas (`u#`, `k#`, `c#`), sobre de eventos (validación de catálogo, tamaño ≤ 1 KB, sin campos de contacto) y `emitRealtime` (PutEvents con timeout 1 s y métrica `EmitFailed`); verificar con vitest: sobre válido por tipo, rechazo de tipo desconocido y de `ref` con llaves no permitidas, fallo de PutEvents no lanza
- [ ] 2.2 Crear el authorizer en `src/handlers/realtime.ts` (subprotocolo `ana.v1, <token>`, `aws-jwt-verify` id token, `client` válido, origen, `REALTIME_ENABLED`) con contexto `{username, client, version, exp}`; verificar con vitest cada escenario de "Autenticación con el ID token en el subprotocolo", "Chequeo de origen", "Endpoint WebSocket único" e "Interruptor de realtime"
- [ ] 2.3 Implementar `$connect` (temas por identidad con `resolveUserAccess` solo para `admin`, items de tema + `meta`, TTL 3 h, respuesta con `Sec-WebSocket-Protocol: ana.v1`), `$disconnect` y `ping` (`pong` con `exp`, `unknown_action`), y registrarlos como eventos `websocket` en `serverless.yml`; verificar con vitest + `aws-sdk-client-mock` los escenarios de "Suscripciones derivadas de la identidad", "Registro y limpieza de conexiones" y "Latido"
- [ ] 2.4 Desplegar en dev y verificar con `wscat -c "<RealtimeWsUrl>?client=cli&v=test" -s ana.v1 -s <idToken>`: conexión aceptada, `{"action":"ping"}` → `pong`, sin subprotocolo → 401, origen `https://evil.example` → 403, y que el access log del stage no contiene el token

## 3. Reparto (`notify`) y productores v4

- [ ] 3.1 Crear `src/handlers/notify.ts` (regla del bus `source: ana.v4`): resolución de temas (campaña = `c#<c>` ∪ `c#*`), dedupe, `PostToConnection` concurrencia 25, borrado en 410, no entrega y cierre con token vencido > 5 min, descarte de eventos > 60 s, métricas `PostOk/PostGone/PostFailed/EventsEmitted`; verificar con vitest cada escenario de "Registro y limpieza de conexiones", "Token vencido durante la conexión" y "Entrega de mejor esfuerzo"
- [ ] 3.2 Emitir `jobs.changed` desde `csvTrigger.ts`, `directSend.ts`, `jobsAdmin.ts` (reassign y review/resolve, ambos operadores) y `uploads.changed` desde `csvTrigger.ts` y `jobsPoll.ts` (ack, con límite de uno por carga cada 10 s); verificar con vitest que cada handler llama `emitRealtime` con el sobre esperado y que su respuesta no cambia si `emitRealtime` falla
- [ ] 3.3 Emitir `review.changed` (reassign/resolve), `roster.changed` (`PUT /admin/agent-roster` en `agents.ts`) y `settings.changed` scope `desktop` (`PUT /admin/desktop-settings` en `settings.ts`); verificar con vitest los escenarios de "Eventos de campaña v4" y "Evento de configuración del desktop"
- [ ] 3.4 Documentar en `v4/ARCHITECTURE.md` el endpoint, el subprotocolo, el catálogo de eventos, los temas y el contrato de backoff/fallback de los clientes (design D9); verificar que el catálogo documentado coincide con el de `src/lib/realtime.ts`

## 4. Puente v3 → v4

- [ ] 4.1 En `notify` (o `src/handlers/notifyS3.ts`, regla `source: aws.s3` del bus v4) traducir llaves S3 a eventos según `specs/v3/realtime-bridge/spec.md`; verificar con vitest cada escenario (incluidos `agents/prueba/notas.txt` → `BridgeSkipped` y borrado en `assignments/agents/` → `assignment.pending`)
- [ ] 4.2 En `v3/ana-backend/serverless.yml` activar `NotificationConfiguration.EventBridgeConfiguration` en `StorageBucket` y crear la regla del bus por defecto (filtro de bucket y prefijos) con destino el ARN del bus v4 (`${param:realtimeBusArn}`) y su rol IAM; verificar con `npx serverless package --stage dev` que `StorageBucket` solo agrega esa propiedad y que ninguna función v3 cambia
- [ ] 4.3 Desplegar v3 en dev y verificar de punta a punta: con `wscat` conectado como `jperez` (`client=cli`), publicar desde "Mi asignación" en dev produce `assignment.published` en < 2 s, y escribir un respaldo de chat no produce eventos

## 5. Interruptor y observabilidad

- [ ] 5.1 Crear `realtimeStats` (cada 5 min): `ActiveConnections` por tipo y, con `REALTIME_ENABLED=false`, cierre de todas las conexiones; verificar con vitest (mock de la tabla y de `DeleteConnection`)
- [ ] 5.2 Agregar alarmas (`realtime-post-failing` > 5 % en 15 min, errores de `notify`, errores del authorizer) y el access log del stage WebSocket con formato sin headers; verificar con `npx serverless package` y, en dev, forzando fallos (`PostToConnection` a un id inválido) que la métrica `PostFailed` aparece en CloudWatch
- [ ] 5.3 Probar el apagado en dev: desplegar `--param="realtimeEnabled=false"` con un `wscat` abierto; verificar que en ≤ 5 min se cierra, que reconectar da 403 y que las rutas REST responden igual

## 6. Despliegue a prod

- [ ] 6.1 Desplegar v4 en prod (`npx serverless deploy --stage prod --param="realtimeEnabled=true" ...` conservando los parámetros vigentes) y luego v3 prod con `realtimeBusArn`; verificar con `wscat` como un usuario de prueba la conexión, el `pong` y un evento real (una publicación de prueba desde "Mi asignación" en la campaña `prueba` produce `assignment.published`)
- [ ] 6.2 Registrar la URL `RealtimeWsUrl` de dev y prod en `v4/ARCHITECTURE.md` y en la configuración de cada cliente (`add-realtime-v4-desktop`, `add-realtime-v3-cli`, `add-realtime-admin-web`); verificar que los tres cambios referencian la misma URL

## Workflow follow-up

- Rollout: este cambio va primero; los clientes se liberan después, cada uno con su flag local, y el rollback global es `realtimeEnabled=false`.
- Archivar antes que los tres cambios de clientes (definen requisitos sobre este canal).
