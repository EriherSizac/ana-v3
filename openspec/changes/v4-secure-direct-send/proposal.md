# Proposal

## Why

El valor real de `SEND_API_KEY` está versionado en texto plano en `v4/ENVIO_DIRECTO.md` (tabla de datos y ejemplos `curl`): cualquiera con acceso al repo (o a su historial) puede encolar mensajes de WhatsApp en nombre de cualquier agente con `POST /send`. Además la comparación no es de tiempo constante, no hay límite de tasa, el `username` no se valida (jobs huérfanos) y dos envíos al mismo teléfono y agente en el mismo milisegundo comparten `jobId` y el segundo pisa al primero. Es el riesgo de seguridad más inmediato de v4 y no depende de ningún otro cambio.

## What Changes

- **Rotación obligatoria** de `SEND_API_KEY` (la expuesta se da por comprometida) y retiro de su valor de `v4/ENVIO_DIRECTO.md`, que pasa a explicar cómo pedir la key y dónde vive.
- La key se lee de SSM Parameter Store (SecureString) en el despliegue en lugar de `backend/.env`; se admite una segunda key `SEND_API_KEY_NEXT` solo durante una rotación.
- Comparación en tiempo constante (digest SHA-256 de ambos lados + `timingSafeEqual`).
- Límite de tasa de la ruta `POST /send` en API Gateway (429 al excederlo).
- Validación del agente destino: `username` debe ser un agente elegible de la campaña (misma fuente que el reparto); si no, 400; si la fuente no responde, 503 (fail-closed).
- `jobId` de envío directo con sufijo aleatorio (sin colisiones en el mismo milisegundo) y `idempotencyKey` opcional para que el sistema llamante pueda reintentar sin duplicar.
- **BREAKING** (para integradores): la key vieja deja de funcionar al terminar la rotación; un `username` que no es agente de la campaña ahora recibe 400 en vez de encolarse.

Fuera de alcance: keys por cliente/integrador con alcance por campaña, callback del resultado del envío, asociar la key a un agente.

## Capabilities

### New Capabilities

_Ninguna._

### Modified Capabilities

- `v4/api-auth`: la autenticación de `POST /send` usa keys de SSM con comparación de tiempo constante y rotación; se agrega límite de tasa.
- `v4/direct-send`: `jobId` sin colisiones, clave de idempotencia opcional y validación del agente destino.

## Impact

- Código: `v4/backend/src/handlers/directSend.ts`, nuevo `v4/backend/src/lib/apiKey.ts`, `v4/backend/serverless.yml` (variables desde `${ssm:...}`, throttling de la ruta), `v4/backend/src/lib/dashboard.ts` (reutilizado).
- Documentación: `v4/ENVIO_DIRECTO.md` (sin el valor de la key; error 400 por campaña inexistente y por agente fuera de la campaña; 429; `idempotencyKey`).
- Operación: parámetros SSM `/ana/v4/<stage>/send-api-key` y `/ana/v4/<stage>/send-api-key-next` en `us-east-2`; coordinación con los sistemas que hoy llaman `POST /send` para entregarles la key nueva.
- Desktop: sin cambios (el job directo conserva su forma; solo cambia el formato del `jobId`).
- Pruebas: vitest en `v4/backend` (se agrega si ningún cambio previo lo hizo).
