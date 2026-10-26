# Design

## Context

- `JobPoller` usa constantes `MIN_GAP_MS`, `WINDOW_MS`, `MAX_PER_WINDOW`. `Chats.tsx` llama `POST /interactions/open` en cada apertura propia.
- v3 guarda su configuración en S3 (`config/cli-settings.json`) y autoriza Developer con v4 `GET /me` (`roleNames` contiene "developer"). v4 ya tiene `roleNames` en el acceso resuelto.
- La tabla `ana-backend-roleperms-<stage>` es single-table (`PK`/`SK`) con un solo tipo de item hoy.

## Goals / Non-Goals

**Goals:** cambiar ritmo y registro de apertura sin release, con valores acotados y auditoría.

**Non-Goals:** configuración en tiempo real (se acepta hasta 5 min de propagación); flags arbitrarios sin catálogo.

## Decisions

- **D1. Almacén en DynamoDB, no S3.** Item `{PK:"CONFIG", SK:"DESKTOP_SETTINGS", schemaVersion:1, version:<n>, values:{...}, audit:{<key>:{updatedBy, updatedAt}}}` en la tabla de permisos de rol. Escritura con `ConditionExpression: version = :expected` (o `attribute_not_exists` en el primer guardado). Alternativa: S3 como v3; se descarta porque v4 no usa S3 para estado y DynamoDB da la condición de versión directa.
- **D2. Catálogo cerrado en código** con tipo, límites, por defecto, etiqueta y descripción en español; valores guardados fuera de límites o de tipo se ignoran (se usa el por defecto) y se registran.
- **D3. Developer.** `isDeveloper = roleNames.some(n => normalize(n).includes('developer'))` (minúsculas, sin acentos), calculado en `resolveUserAccess` y expuesto en `GET /me` sin conceder permisos `ana:*`; las rutas de administración exigen `isDeveloper` como hard check. Así ANA Admin y v4 usan la misma regla.
- **D4. Consumo en el desktop.** `remoteSettings` en el main: `GET /settings` tras `auth:set-token` y cada 5 min; mantiene el último válido en memoria; emite `settings:changed` al renderer. `JobPoller` lee los valores en cada `rateLimitWait` (un cambio aplica al siguiente cálculo de espera). El renderer consulta `getSettings()` al montar `Chats` y escucha cambios para `openChatInteraction`.
- **D5. Sección en ANA Admin.** El BFF llama v4 con el token del usuario; la página muestra cada llave con su control (toggle o número con límites), valor por defecto y auditoría; guardar envía solo la llave cambiada con la `version` leída.

## Risks / Trade-offs

- [Un Developer baja el ritmo y aumenta el riesgo de bloqueo] → Límites duros (mínimo 60 s, máximo 20 por ventana) y confirmación que muestra el valor anterior; auditoría por llave.
- [Backend caído al arrancar] → Valores por defecto (los actuales), que son el comportamiento conocido.
