# Tasks

## 1. Infraestructura del gateway (v4)

- [ ] 1.1 Agregar a `v4/backend/serverless.yml` la tabla `RealtimeTable` (`PK`/`SK`, on-demand, TTL `ttl`), el bus `AnaRealtimeBus`, los parámetros `realtimeEnabled` (default `true`) y `realtimeClientIds`, las env `REALTIME_TABLE`, `REALTIME_BUS`, `REALTIME_ENABLED`, `REALTIME_ALLOWED_ORIGINS`, permisos IAM (`dynamodb:*Item/Query/BatchWriteItem` sobre la tabla, `events:PutEvents`, `execute-api:ManageConnections`) y la salida `RealtimeWsUrl` (URL execute-api por defecto, sin dominio propio); verificar con `npx serverless package --stage dev` (o, sin credenciales, con una prueba que parsee `serverless.yml`) que la plantilla contiene los recursos y que no cambian los recursos existentes
- [ ] 1.2 Agregar dependencias `@aws-sdk/client-apigatewaymanagementapi`, `@aws-sdk/client-eventbridge` y `aws-jwt-verify` en `v4/backend`; verificar con `npm ci && npm run typecheck`

## 2. Conexión, autenticación y latido

- [ ] 2.1 Crear `src/lib/realtime.ts` con temas (`u#`, `k#`, `c#`, `m#`, `r#`), sobre de eventos (validación de catálogo, tamaño ≤ 1 KB, sin campos de contacto), `emitRealtime` (PutEvents con timeout 1 s y métrica `EmitFailed`) y `forceRefresh` (petición `ana.realtime.force` al bus con el mismo contrato); verificar con vitest: sobre válido por tipo, rechazo de tipo desconocido y de `ref` con llaves no permitidas, fallo de PutEvents no lanza
- [ ] 2.2 Crear el authorizer en `src/handlers/realtime.ts` (subprotocolo `ana.v1, <token>`, `aws-jwt-verify` id token, `client` válido, origen, `REALTIME_ENABLED`) con contexto `{username, client, version, exp}`; verificar con vitest cada escenario de "Autenticación con el ID token en el subprotocolo", "Chequeo de origen", "Endpoint WebSocket único" e "Interruptor de realtime"
- [ ] 2.3 Implementar `$connect` (temas por identidad con `resolveUserAccess` para los tres tipos: `c#` solo `admin`, `m#`/`r#` para todos, `r#unknown` si falla en `desktop`/`cli` y rechazo `access_error` en `admin`; items de tema + `meta`, TTL 3 h, respuesta con `Sec-WebSocket-Protocol: ana.v1`), `$disconnect` y `ping` (`pong` con `exp`, `unknown_action`), y registrarlos como eventos `websocket` en `serverless.yml`; verificar con vitest + `aws-sdk-client-mock` los escenarios de "Suscripciones derivadas de la identidad", "Registro y limpieza de conexiones" y "Latido"
- [ ] 2.4 Desplegar en dev y verificar con `wscat -c "<RealtimeWsUrl>?client=cli&v=test" -s ana.v1 -s <idToken>`: conexión aceptada, `{"action":"ping"}` → `pong`, sin subprotocolo → 401, origen `https://evil.example` → 403, y que el access log del stage no contiene el token

## 3. Reparto (`notify`) y productores v4

- [ ] 3.1 Crear `src/handlers/notify.ts` (regla del bus `source: ana.v4`): resolución de temas (campaña = `c#<c>` ∪ `c#*`), dedupe, `PostToConnection` concurrencia 25, borrado en 410, no entrega y cierre con token vencido > 5 min, descarte de eventos > 60 s, métricas `PostOk/PostGone/PostFailed/EventsEmitted`; verificar con vitest cada escenario de "Registro y limpieza de conexiones", "Token vencido durante la conexión" y "Entrega de mejor esfuerzo"
- [ ] 3.2 Emitir `jobs.changed` desde `csvTrigger.ts`, `directSend.ts`, `jobsAdmin.ts` (reassign y review/resolve, ambos operadores) y `uploads.changed` desde `csvTrigger.ts` y `jobsPoll.ts` (ack, con límite de uno por carga cada 10 s); verificar con vitest que cada handler llama `emitRealtime` con el sobre esperado y que su respuesta no cambia si `emitRealtime` falla
- [ ] 3.3 Emitir `review.changed` (reassign/resolve), `roster.changed` (`POST /admin/agent-roster` en `agents.ts`) y `settings.changed` scope `desktop` (`PUT /admin/desktop-settings` en `settings.ts`); verificar con vitest los escenarios de "Eventos de campaña v4" y "Evento de configuración del desktop"
- [ ] 3.4 Documentar en `v4/ARCHITECTURE.md` el endpoint, el subprotocolo, el catálogo de eventos (incluido `session.refresh`), los temas, la actualización forzada y el contrato de backoff/fallback de los clientes (design D9, D12); verificar que el catálogo documentado coincide con el de `src/lib/realtime.ts`

## 4. Puente v3 → v4

- [ ] 4.1 En `notify` (rama de la regla `source: aws.s3` del bus v4) traducir llaves S3 a eventos según `specs/v3/realtime-bridge/spec.md`, incluida la actualización forzada por `rosters/{c}.json` (`m#<c>`) y por `config/cli-settings.json` (`k#cli`); verificar con vitest cada escenario (incluidos `agents/prueba/notas.txt` → `BridgeSkipped` y borrado en `assignments/agents/` → `assignment.pending`)
- [ ] 4.2 En `v3/ana-backend/serverless.yml` activar `NotificationConfiguration.EventBridgeConfiguration` en `StorageBucket` y crear la regla del bus por defecto (filtro de bucket y prefijos) con destino el ARN del bus v4 (`${param:realtimeBusArn}`) y su rol IAM; verificar con una prueba que parsee `serverless.yml` (o `npx serverless package --stage dev`) que `StorageBucket` solo agrega esa propiedad y que ninguna función v3 cambia
- [ ] 4.3 Desplegar v3 en dev y verificar de punta a punta: con `wscat` conectado como `jperez` (`client=cli`), publicar desde "Mi asignación" en dev produce `assignment.published` en < 2 s, y escribir un respaldo de chat no produce eventos

## 5. Interruptor y observabilidad

- [ ] 5.1 Crear `realtimeStats` (cada 5 min): `ActiveConnections` por tipo y, con `REALTIME_ENABLED=false`, cierre de todas las conexiones; verificar con vitest (mock de la tabla y de `DeleteConnection`)
- [ ] 5.2 Agregar alarmas (`realtime-post-failing` > 5 % en 15 min, errores de `notify`, errores del authorizer) y el access log del stage WebSocket con formato sin headers; verificar con la prueba de `serverless.yml` y, en dev, forzando fallos (`PostToConnection` a un id inválido) que la métrica `PostFailed` aparece en CloudWatch
- [ ] 5.3 Probar el apagado en dev: desplegar `--param="realtimeEnabled=false"` con un `wscat` abierto; verificar que en ≤ 5 min se cierra, que reconectar da 403 y que las rutas REST responden igual

## 6. Actualización forzada

- [ ] 6.1 En `notify`, ejecutar las peticiones `ana.realtime.force` (destinos `user`, `campaign` = `m#<c>` sin `m#*`, `role` = `r#<id>` ∪ `r#unknown`, `client` = `k#<client>`, `all` = `k#desktop` ∪ `k#cli` ∪ `k#admin`): `session.refresh` con `reason` y `DeleteConnection` a cada conexión, métrica `ForcedClosed` por razón; verificar con vitest los escenarios de "Señal de actualización de acceso"
- [ ] 6.2 Forzar automáticamente: `PUT /admin/role-permissions/{roleId}` (`api.ts`, rol), `POST /admin/agent-roster` (`agents.ts`, usuarios del cuerpo) y `PUT /admin/desktop-settings` (`settings.ts`, `k#desktop`), sin cambiar sus respuestas si el bus falla; verificar con vitest los escenarios de "Actualización forzada automática"
- [ ] 6.3 Crear `src/handlers/realtimeAdmin.ts` y la ruta `POST /admin/realtime/refresh` en `serverless.yml` (authorizer `cognitoJwt`, chequeo fijo `access.isAdmin`, validación de alcance, 202, log `realtime_force`); verificar con vitest los escenarios de "Actualización forzada manual"
- [ ] 6.4 En dev, con dos `wscat` (un `cli` de `jperez` y otro de otro usuario), forzar `{"scope":"user","username":"jperez"}` y verificar que solo el primero recibe `session.refresh` y se cierra; repetir guardando permisos de un rol de `jperez`

## 7. Despliegue a prod

- [ ] 7.1 Desplegar v4 en prod (`npx serverless deploy --stage prod --param="realtimeEnabled=true" ...` conservando los parámetros vigentes) y luego v3 prod con `realtimeBusArn`; verificar con `wscat` como un usuario de prueba la conexión, el `pong` y un evento real (una publicación de prueba desde "Mi asignación" en la campaña `prueba` produce `assignment.published`)
- [ ] 7.2 Registrar la URL `RealtimeWsUrl` (execute-api) de dev y prod en `v4/ARCHITECTURE.md` y en la configuración de cada cliente (`ANA_REALTIME_URL` del desktop y del CLI, `NEXT_PUBLIC_REALTIME_URL` de ANA Admin); verificar que los tres usan la misma URL

## Workflow follow-up

- Rollout: este cambio va primero; los clientes se liberan después a toda la flota, cada uno con su flag local, y el rollback global es `realtimeEnabled=false`.
- Archivar antes que los tres cambios de clientes (definen requisitos sobre este canal).
