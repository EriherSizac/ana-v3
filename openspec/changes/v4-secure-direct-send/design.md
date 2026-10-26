# Design

## Context

`directSend.ts` compara `event.headers['x-api-key'] !== process.env.SEND_API_KEY` y la variable llega de `backend/.env` vía `${env:SEND_API_KEY, ''}`. `v4/ENVIO_DIRECTO.md` contiene el valor real en tres lugares (tabla, encabezado de ejemplo y `curl`), por lo que borrarlo del archivo no basta: sigue en el historial de git. El job directo se escribe con `PutCommand` sin condición y `jobId = direct#<epochMs>#<dígitos>`. La lista de agentes elegibles ya existe en `lib/dashboard.ts` (`getEligibleAgents`).

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
- **D2. Rotación con dos keys.** Durante la ventana de rotación se aceptan `SEND_API_KEY` y `SEND_API_KEY_NEXT`; al confirmar que los integradores usan la nueva, se promueve (`NEXT` → actual) y se vacía `NEXT`. Para la key expuesta, la ventana debe ser lo más corta posible (horas, no días).
- **D3. Comparación de tiempo constante.** `sha256(header)` vs `sha256(key)` con `crypto.timingSafeEqual` (mismo largo siempre); se evalúan ambas keys siempre, sin cortocircuito.
- **D4. Throttling en API Gateway.** HTTP API no expone throttling por ruta en la sintaxis de `httpApi` de Serverless; se agrega en `resources.extensions` un `RouteSettings` para `POST /send` en el stage (`ThrottlingRateLimit: 5`, `ThrottlingBurstLimit: 10`). API Gateway responde 429 sin invocar la Lambda.
- **D5. Validación del agente.** `username` se compara sin distinguir mayúsculas contra `getEligibleAgents(campaign)`; el job se escribe en la partición con la grafía que devuelve la fuente. Lista vacía por error de red o no-2xx → 503 (fail-closed), porque encolar a un usuario inexistente deja el job huérfano 7 días. Cuando `add-agent-roster-management` active `AGENT_ROSTER_FILTER`, la validación usa la misma regla de habilitación que el reparto (se reutiliza la función que ese cambio introduce).
- **D6. `jobId`.** Sin `idempotencyKey`: `direct#<epochMs>#<dígitos>#<8 hex de crypto.randomBytes>`. Con `idempotencyKey` (`^[A-Za-z0-9_-]{1,64}$`): `direct#key#<idempotencyKey>` con `ConditionExpression: attribute_not_exists(jobId)`; si ya existe se responde 200 con el mismo `jobId` y `duplicate: true` sin reescribir. El desktop no interpreta el `jobId`, así que el cambio de formato es compatible.

## Risks / Trade-offs

- [Un integrador desconocido usa la key expuesta] → Antes de rotar se revisan los logs de CloudWatch de `directSend` (IPs/User-Agent) de los últimos 30 días; tras rotar, los 401 se monitorean una semana.
- [La validación por Dashboard rechaza agentes internos (`@pernexium.com.mx`)] → Es el mismo criterio que el reparto; se documenta. Si se necesita enviar desde cuentas internas, se discute en el cambio de roster.
- [Throttling global de la ruta afecta a todos los integradores juntos] → Aceptable con un solo integrador; se revisa con D-non-goal de keys por cliente.

## Migration Plan

1. Crear los parámetros SSM en `us-east-2` (dev y prod) con una key nueva de 32 bytes aleatorios; la key expuesta va a `send-api-key` solo hasta que el integrador migre: `send-api-key` = expuesta, `send-api-key-next` = nueva.
2. Desplegar dev, probar, desplegar prod. Entregar la key nueva a los integradores por canal seguro.
3. Al confirmar tráfico solo con la nueva (logs), promover: `send-api-key` = nueva, `send-api-key-next` = vacío; redeploy. Desde aquí la expuesta responde 401.
4. Rollback: volver a desplegar con los parámetros anteriores (la versión del código es compatible con una sola key).

## Open Questions

- Qué sistemas llaman hoy `POST /send` en prod (CRM, dashboard, automatizaciones) y quién recibe la key nueva; se responde con los logs antes del paso 1 sin cambiar el diseño.
