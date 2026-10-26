# Design

## Context

`directSend.ts` compara `event.headers['x-api-key'] !== process.env.SEND_API_KEY` y la variable llega de `backend/.env` vía `${env:SEND_API_KEY, ''}`. `v4/ENVIO_DIRECTO.md` contiene el valor real en tres lugares (tabla, encabezado de ejemplo y `curl`), por lo que borrarlo del archivo no basta: sigue en el historial de git. El job directo se escribe con `PutCommand` sin condición y `jobId = direct#<epochMs>#<dígitos>`. La lista de agentes elegibles ya existe en `lib/dashboard.ts` (`getEligibleAgents`).

Consumidores: CloudWatch muestra 0 invocaciones de `ana-backend-prod-directSend` en los últimos 90 días y no se encontró ningún llamador en otros repositorios. No hay integradores que coordinar: la key nueva se guarda en SSM y se entrega solo a quien la solicite.

## Goals / Non-Goals

**Goals:**
- Que la key expuesta deje de servir y que ninguna key vuelva a quedar en el repo.
- Que el endpoint no sea un oráculo de tiempo ni se pueda usar para inundar la cola.
- Que un job directo no se pierda ni se duplique por colisión o reintento.

**Non-Goals:**
- Multi-tenant de keys (una key por integrador con permisos). Se evalúa cuando haya más de un integrador.
- Reescribir el historial de git para borrar la key (se rota; reescribir historia rompe clones y no elimina copias ya hechas).

## Decisions

- **D1. Key en SSM, no en `.env`.** `serverless.yml` resuelve `SEND_API_KEY: ${ssm:/ana/v4/${sls:stage}/send-api-key}` y `SEND_API_KEY_NEXT: ${ssm:/ana/v4/${sls:stage}/send-api-key-next, ''}`. Alternativa: leer SSM en runtime con caché; se descarta por latencia y permisos extra; la rotación ya exige redeploy controlado.
- **D2. Rotación con dos keys.** Durante la ventana de rotación se aceptan `SEND_API_KEY` y `SEND_API_KEY_NEXT`; al confirmar que los integradores usan la nueva, se promueve (`NEXT` → actual) y se vacía `NEXT`. Para la key expuesta no hace falta ventana: no hay consumidores conocidos (ver Context), así que se reemplaza directamente y `NEXT` queda vacío; el mecanismo se conserva para rotaciones futuras con integradores reales.
- **D3. Comparación de tiempo constante.** `sha256(header)` vs `sha256(key)` con `crypto.timingSafeEqual` (mismo largo siempre); se evalúan ambas keys siempre, sin cortocircuito.
- **D4. Throttling en API Gateway.** HTTP API no expone throttling por ruta en la sintaxis de `httpApi` de Serverless; se agrega en `resources.extensions` un `RouteSettings` para `POST /send` en el stage (`ThrottlingRateLimit: 5`, `ThrottlingBurstLimit: 10`). API Gateway responde 429 sin invocar la Lambda.
- **D5. Validación del agente.** `username` se compara sin distinguir mayúsculas contra `getEligibleAgents(campaign)`; el job se escribe en la partición con la grafía que devuelve la fuente. Lista vacía por error de red o no-2xx → 503 (fail-closed), porque encolar a un usuario inexistente deja el job huérfano 7 días. Cuando `add-agent-roster-management` active `AGENT_ROSTER_FILTER`, la validación usa la misma regla de habilitación que el reparto (se reutiliza la función que ese cambio introduce).
- **D6. `jobId`.** Sin `idempotencyKey`: `direct#<epochMs>#<dígitos>#<8 hex de crypto.randomBytes>`. Con `idempotencyKey` (`^[A-Za-z0-9_-]{1,64}$`): `direct#key#<idempotencyKey>` con `ConditionExpression: attribute_not_exists(jobId)`; si ya existe se responde 200 con el mismo `jobId` y `duplicate: true` sin reescribir. El desktop no interpreta el `jobId`, así que el cambio de formato es compatible.

## Risks / Trade-offs

- [Un llamador no identificado usa la ruta] → Sin invocaciones en 90 días; tras rotar, los 401 de `directSend` se monitorean una semana y quien aparezca solicita la key nueva.
- [La validación por Dashboard rechaza agentes internos (`@pernexium.com.mx`)] → Es el mismo criterio que el reparto; se documenta. Si se necesita enviar desde cuentas internas, se discute en el cambio de roster.
- [Throttling global de la ruta afecta a todos los integradores juntos] → Aceptable sin consumidores actuales; se revisa con el non-goal de keys por cliente.

## Migration Plan

1. Crear los parámetros SSM en `us-east-2` (dev y prod): `send-api-key` = key nueva de 32 bytes aleatorios, `send-api-key-next` = vacío. La key expuesta no se carga en ningún parámetro.
2. Desplegar dev, probar, desplegar prod. Desde ese momento la key expuesta responde 401.
3. La key nueva no se distribuye; se entrega por canal seguro solo a quien la solicite.
4. Rollback: redeploy de la versión anterior del código con la key nueva (la expuesta no vuelve a habilitarse).


## Decisiones de implementación

- **Distinguir "fuente caída" de "sin agentes".** `getEligibleAgents` devolvía `[]` en ambos casos. Se agregó `fetchEligibleAgents` en `lib/dashboard.ts` (misma fuente y regla) que devuelve `null` si la API falla; `getEligibleAgents` quedó como envoltorio `?? []`, sin cambio de comportamiento para `api.ts`/`csvTrigger.ts`. Cuando `add-agent-roster-management` introduzca su regla de habilitación, `directSend` debe pasar a usarla (D5).
- **`PutCommand` siempre condicional.** También sin `idempotencyKey` se usa `attribute_not_exists(jobId)`: con el sufijo aleatorio la colisión es improbable, pero si ocurriera se responde 500 en lugar de pisar un job. Solo con clave el `ConditionalCheckFailedException` se traduce a `200 duplicate: true`.
- **Keys leídas en cada invocación.** `SEND_API_KEY`/`SEND_API_KEY_NEXT` se leen de `process.env` dentro del handler (no al importar), lo que permite probar el caso "sin keys → 401" y no cambia el costo.
- **Orden de validación**: auth → campos requeridos → `idempotencyKey` → campaña → agente → `Put`. Una `idempotencyKey` inválida responde 400 antes de consultar fuentes externas.
- **Throttling** vía `resources.extensions.HttpApiStage.Properties.RouteSettings['POST /send']` con `DependsOn: HttpApiRoutePostSend` (el stage referencia la ruta por su `routeKey`).
- **`send-api-key-next` "vacío"**: SSM no admite un `String`/`SecureString` vacío, así que "vacío" se implementa no creando (o borrando) el parámetro; `serverless.yml` usa default `''` para él. `send-api-key` no tiene default: si falta, el deploy falla (fail-closed).
- **Verificación de `serverless package` no ejecutada**: Serverless Framework v4 exige `serverless login` o `SERVERLESS_ACCESS_KEY`/licencia y la resolución `${ssm:...}` necesita credenciales AWS y el parámetro creado; la tarea 2.3 queda sin marcar hasta correrla.
