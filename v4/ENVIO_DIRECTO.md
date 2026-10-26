# Envío directo de WhatsApp — `POST /send`

Documentación de integración para disparar un mensaje de WhatsApp a un contacto desde **otro sistema** (CRM, dashboard, automatización), usando la sesión de WhatsApp de un agente de ana.

---

## 1. Qué hace

Encola un *send-job* marcado como **automático** en la cola del agente indicado. La app de escritorio de ese agente lo recoge en su siguiente poll (~5 segundos) y lo envía **sin pasar por la aprobación manual** de "Mi asignación" (a diferencia de las campañas del líder, que sí requieren que el agente apruebe).

```
Tu sistema ──POST /send──▶ API Gateway ──▶ Lambda directSend ──▶ DynamoDB (tabla jobs)
                                                                      │
Agente (Electron) ◀──GET /jobs/poll (~5s)─────────────────────────────┘
   │
   ├─ resolveJid(phone)  → ¿tiene WhatsApp?
   ├─ sendMessage        → WhatsApp Web (typing simulado 2–9s)
   ├─ PUT /messages      → respaldo en DynamoDB (visible en la app)
   ├─ POST /jobs/ack     → borra el job
   └─ POST /interactions/report → interacción en el CRM
```

## 2. Requisitos previos

| Requisito | Detalle |
|---|---|
| Backend desplegado | `serverless deploy` con el parámetro SSM `/ana/v4/<stage>/send-api-key` creado (ver §9) |
| API key | `<SEND_API_KEY>` — se pide al equipo de ANA (ver §9) y se manda en el header `X-Api-Key`. Sin ella → `401` |
| Agente de la campaña | `username` debe ser un agente elegible de `campaign` (activo, externo y con el rol de la campaña si aplica: la misma regla que el reparto de CSV). Si no → `400` |
| Agente con sesión activa | El `username` indicado debe tener la app de escritorio **abierta y con WhatsApp conectado**. Si está offline, el job queda en cola hasta 7 días (TTL) y se envía cuando vuelva |
| Teléfono MX o E.164 | Ver normalización en §4 |

## 3. Endpoint

```
POST https://njpfef2qna.execute-api.us-east-2.amazonaws.com/send
```

**Headers**

| Header | Valor |
|---|---|
| `Content-Type` | `application/json` |
| `X-Api-Key` | `<SEND_API_KEY>` |

**Body**

| Campo | Tipo | Requerido | Descripción |
|---|---|---|---|
| `message` | string | ✅ | Texto a enviar. Soporta formato WhatsApp (`*negrita*`, `_cursiva_`) y saltos de línea `\n`. Si mandas `row`, también soporta plantillas `{campo}` (ver §5) |
| `username` | string | ✅ | `operatorId` del agente (su username de Cognito) cuya sesión de WhatsApp hará el envío. Se valida sin distinguir mayúsculas contra los agentes de la campaña; el job se guarda con la grafía oficial |
| `phone` | string | ✅ | Teléfono destino, crudo (`5512345678`, `+525512345678`, `525512345678`…) |
| `campaign` | string | ✅ | Nombre de campaña. Agrupa el job en el índice por campaña y se usa como `campaign_name` al registrar la interacción en el CRM |
| `countryCode` | string | ❌ | Lada por defecto si el teléfono trae 10 dígitos. Default `52` |
| `row` | object | ❌ | Datos para interpolar `{campo}` en `message` (ej. `{"nombre":"Ana","saldo":"1234.5"}`) |
| `idempotencyKey` | string | ❌ | 1 a 64 caracteres `[A-Za-z0-9_-]`. Si reintentas con la misma clave no se crea otro job: la respuesta trae el mismo `jobId` y `duplicate: true` |

## 4. Normalización del teléfono

El desktop normaliza antes de enviar (`normalizeDigits` + `getNumberId`):

- `5512345678` (10 dígitos) → se antepone `countryCode` (52)
- `+52 55 1234 5678` / `52...` / `521...` → se limpian símbolos y el `1` de México lo resuelve WhatsApp
- WhatsApp decide el JID real; si el número **no tiene WhatsApp**, el job termina como `no_whatsapp` y se registra así en el CRM (incluye `PATCH /phone` para marcarlo sin WhatsApp)

## 5. Plantillas en `message` (opcional)

Si mandas `row`, `message` pasa por el mismo motor de plantillas de las campañas:

| Sintaxis | Resultado |
|---|---|
| `{nombre}` | valor de `row.nombre` (acepta también `{{nombre}}` estilo v3) |
| `{saldo}` | formatea MXN automático si la columna es saldo/monto/balance/amount |
| `{saldo*0.9}` | expresión matemática (`+ - * / % ()`) |
| `{descuento:dinero}` | fuerza formato `$1,234.00` |
| `{saldo:num}` | desactiva el formato de dinero |

Sin `row`, el texto se envía literal (los `{placeholders}` no encontrados quedan visibles).

## 6. Respuestas

**200 OK** — job encolado:
```json
{
  "queued": true,
  "jobId": "direct#1765400000000#5512345678#9f2c41ab",
  "operatorId": "erick.silva",
  "campaign": "bancoppel"
}
```
El `jobId` lleva un sufijo aleatorio, así que dos envíos en el mismo milisegundo nunca chocan. Con `idempotencyKey` el `jobId` es `direct#key#<idempotencyKey>`; un reintento con la misma clave responde `200` con el mismo `jobId` y `"duplicate": true` sin modificar el job.
> `queued: true` significa **aceptado**, no entregado. La entrega ocurre cuando el desktop del agente lo procese (segundos si está online).

**Errores**

| Código | Body | Causa |
|---|---|---|
| `401` | `{"error":"no autorizado"}` | `X-Api-Key` ausente/incorrecta, o `SEND_API_KEY` no configurada en el backend |
| `400` | `{"error":"faltan message/username/phone/campaign"}` | falta un campo requerido |
| `400` | `{"error":"la campaña \"<x>\" no existe"}` | `campaign` no está en el catálogo de campañas |
| `400` | `{"error":"el agente \"<username>\" no pertenece a la campaña"}` | `username` no es agente elegible de `campaign` |
| `400` | `{"error":"idempotencyKey inválida"}` | `idempotencyKey` vacía, de más de 64 caracteres o con caracteres fuera de `[A-Za-z0-9_-]` |
| `429` | `{"message":"Too Many Requests"}` | se excedió el límite de la ruta (5 solicitudes/s, ráfaga 10); reintenta con backoff |
| `404` | `{"error":"ruta no manejada: ..."}` | método/ruta equivocados |
| `503` | `{"error":"no se pudo validar el agente"}` | la API de agentes de la campaña no respondió; no se encoló nada, reintenta |
| `500` | `{"error":"error interno"}` | revisar CloudWatch del Lambda `directSend` |

## 7. Ejemplos

**curl**
```bash
curl -X POST "https://njpfef2qna.execute-api.us-east-2.amazonaws.com/send" \
  -H "Content-Type: application/json" \
  -H "X-Api-Key: $SEND_API_KEY" \
  -d '{
    "message": "Hola {nombre}, tienes un pago pendiente de {saldo:dinero}. ¿Te apoyo?",
    "username": "erick.silva",
    "phone": "5512345678",
    "campaign": "bancoppel",
    "row": { "nombre": "Ana", "saldo": "12450.50" },
    "idempotencyKey": "crm-123"
  }'
```

**Node.js**
```js
const res = await fetch('https://njpfef2qna.execute-api.us-east-2.amazonaws.com/send', {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'x-api-key': process.env.SEND_API_KEY,
  },
  body: JSON.stringify({
    message: 'Hola {nombre}, tu saldo es {saldo}.',
    username: 'erick.silva',
    phone: '5512345678',
    campaign: 'bancoppel',
    row: { nombre: 'Ana', saldo: '12450.50' },
  }),
});
const data = await res.json(); // { queued: true, jobId: ... }
```

**Python**
```python
import requests, os

r = requests.post(
    "https://njpfef2qna.execute-api.us-east-2.amazonaws.com/send",
    headers={"X-Api-Key": os.environ["SEND_API_KEY"]},
    json={
        "message": "Hola {nombre}, tu saldo es {saldo}.",
        "username": "erick.silva",
        "phone": "5512345678",
        "campaign": "bancoppel",
        "row": {"nombre": "Ana", "saldo": "12450.50"},
    },
    timeout=10,
)
r.raise_for_status()
print(r.json())  # {'queued': True, 'jobId': ...}
```

## 8. Comportamiento y garantías

- **Límite de tasa del endpoint**: `POST /send` acepta 5 solicitudes/s con ráfaga de 10 (global para la ruta); el exceso recibe `429` sin encolar nada.
- **Ritmo anti-bloqueo**: los directos comparten el rate limit del agente (máx **7 mensajes / 20 min**, gap ≥2 min, typing simulado 2–9s). Si mandas 20 directos seguidos, se van drenando a ese ritmo.
- **Orden**: por agente, FIFO aproximado dentro de cada poll.
- **Persistencia**: el job vive en DynamoDB con TTL de 7 días. Agente offline → se envía cuando conecte; pasados 7 días, expira sin enviarse.
- **Sin duplicados de CRM**: el reporte de interacción es idempotente por `jobId`.
- **Visibilidad**: el mensaje enviado aparece en la conversación dentro de la app del agente (se respalda con `PUT /messages`), y el líder lo ve en la vista de equipo.
- **Registro CRM**: cada envío genera una interacción outbound (`subdictamen` "Se envía WhatsApp" / "No tiene Whatsapp", `campaign_name` = `campaign`); números sin WhatsApp se marcan vía `PATCH /phone`.
- **No hay callback**: el endpoint no notifica la entrega. Si necesitas confirmación, consulta la conversación vía `GET /conversations` (requiere JWT) o pide que agreguemos un webhook de resultado.

## 9. Seguridad

- La key viaja en header, **nunca** en la URL.
- **Dónde vive**: SecureString de SSM Parameter Store en `us-east-2` (perfil `pernexium`): `/ana/v4/<stage>/send-api-key` (obligatoria) y `/ana/v4/<stage>/send-api-key-next` (solo durante una rotación). `serverless.yml` las resuelve al desplegar; ningún archivo del repo debe contener su valor.
- **Cómo pedirla**: solicítala al responsable del backend de ANA; se entrega por un canal seguro (gestor de secretos o mensaje cifrado), nunca por correo en claro, chat abierto ni commits.
- **Rotación**: (1) crear la key nueva (32 bytes aleatorios) en `send-api-key-next` y desplegar: se aceptan ambas; (2) entregar la nueva a los integradores; (3) al confirmar en CloudWatch que solo llega la nueva, copiarla a `send-api-key`, borrar el parámetro `send-api-key-next` (SSM no admite valores vacíos; sin él la variable queda vacía) y redesplegar: la anterior responde `401`. La ventana de rotación debe durar horas, no días.
- La comparación de la key es de tiempo constante (digest SHA-256 + `timingSafeEqual`).
- Una key que estuvo versionada en este archivo se considera comprometida y debe rotarse (sigue en el historial de git).
- El endpoint no tiene authorizer Cognito (es sistema-a-sistema); el handler responde `401` a cualquier key incorrecta y también si la env var está vacía (fail-closed).
- Quien tenga la key puede enviar como cualquier agente **de la campaña indicada**: trátala como secreto de servidor, no la pongas en frontends.

## 10. Implementación (referencia de código)

| Pieza | Archivo |
|---|---|
| Handler del endpoint | `backend/src/handlers/directSend.ts` |
| Ruta + env + throttling | `backend/serverless.yml` (función `directSend`, `SEND_API_KEY`/`SEND_API_KEY_NEXT` desde SSM, `RouteSettings` de `POST /send`) |
| Comparación de la key | `backend/src/lib/apiKey.ts` |
| Agentes elegibles | `backend/src/lib/dashboard.ts` (`fetchEligibleAgents`) |
| Modelo del job (`auto: true`) | `backend/src/lib/jobs.ts` |
| Consumo en desktop (auto-envío sin aprobación) | `desktop/electron/jobs/poller.ts` (filtro `j.auto` en el loop) |
| Envío + registro CRM | `desktop/electron/main.ts` (`runJob`) y `backend/src/handlers/interactions.ts` |
