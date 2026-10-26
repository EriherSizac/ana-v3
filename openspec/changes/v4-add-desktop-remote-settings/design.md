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
- **D4. Consumo en el desktop.** `remoteSettings` en el main: `GET /settings` tras `auth:set-token` y cada 5 min; mantiene el último válido en memoria; emite `settings:changed` al renderer. `JobPoller` lee los valores en cada `rateLimitWait` (un cambio aplica al siguiente cálculo de espera). El renderer consulta `getSettings()` al montar `Chats` y escucha cambios para `openChatInteraction`, que vale `false` por defecto (negocio no usa ese registro): sin configuración leída, no se registra la apertura.
- **D5. Sección en ANA Admin.** El BFF llama v4 con el token del usuario; la página muestra cada llave con su control (toggle o número con límites), valor por defecto y auditoría; guardar envía solo la llave cambiada con la `version` leída.

## Risks / Trade-offs

- [Un Developer baja el ritmo y aumenta el riesgo de bloqueo] → Límites duros (mínimo 60 s, máximo 20 por ventana) y confirmación que muestra el valor anterior; auditoría por llave.
- [Backend caído al arrancar] → Valores por defecto: el ritmo actual y el registro de apertura apagado (el estado deseado por negocio).

## Decisiones de implementación

- **Respuesta de `PUT /admin/desktop-settings`:** devuelve la misma vista de administración que el `GET` (incluye la `version` nueva y la auditoría), para que ANA Admin actualice la fila sin otra consulta. La validación de llaves y valores corre antes de comparar la versión (una llave desconocida responde 400 aunque la versión no coincida).
- **Primer guardado:** `version` 0 significa "nunca configurada" y se escribe con `attribute_not_exists(PK)`; después, `version = :expected`.
- **`isDeveloper` en v4:** `isDeveloperRole` en `permissions.ts` (sin acentos ni mayúsculas contiene "developer") calculado en `resolveUserAccess`; el superadmin fijo `erick.silva` lo trae en `false` (no tiene roles); el superadmin por rol lo calcula de sus roles reales. Accesos cacheados antes del deploy no traen el campo y cuentan como `false` hasta vencer (≤ 15 min).
- **Desktop:** `RemoteSettings` valida otra vez los límites del lado del main (espejo del catálogo) y descarta llave por llave lo inválido. El poller recibe `pace()` y lo lee en cada cálculo de espera; la ventana usa el envío `length − max` para que bajar el máximo funcione con más envíos ya registrados. El renderer obtiene la configuración con `getSettings()` y escucha `settings:changed`; la decisión de notificar la apertura vive en la función pura `shouldReportOpen`.
- **ANA Admin:** la sección "Desktop v4" se monta dentro de la página existente (`CliSettingsView` acepta `children` para no duplicar `<main>`) y reutiliza su `Toggle`. Los enteros se editan con un `Input` + "Guardar" (deshabilitado fuera de límites, con "Permitido: min a max"); los booleanos con el interruptor. Tras un 409 el control vuelve al valor anterior y se muestra el mensaje.
- **2.3:** `getSettings`/`onSettings` y el condicionamiento están implementados (con prueba pura y `npm run build`); queda sin marcar porque su verificación pide comprobar en dev, con un backend desplegado, que no hay llamadas a `/interactions/open` y que al activar la llave vuelven en ≤ 5 min.
