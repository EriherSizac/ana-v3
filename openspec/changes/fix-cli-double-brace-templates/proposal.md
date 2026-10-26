# Proposal

## Why

En el envío automático del CLI v3 las plantillas con llaves dobles llegan rotas al deudor: la pasada de llaves simples de `agent-config.js:400` (`/\{(\w+)\}/`) también encuentra `{name}` dentro de `{{name}}` y lo convierte en `{Juan}`, que se envía literal. Como las plantillas de supervisores usan `{{variable}}` (la sintaxis documentada en `template-rendering`), toda variable simple con llaves dobles del flujo automático queda afectada. Además, `{{total_balance}}` lee el campo `total_balanc` (`message-utils.js:18`), que el parser del CSV del backend nunca llena (mapea `total_balance` → `total_balance`), así que el saldo sale vacío.

## What Changes

- La interpolación del mensaje del flujo automático se hace en **una sola pasada** que reconoce primero los marcadores `{{...}}` y después los `{variable}`: `{{name}}` produce `Juan` y `{name}` sigue produciendo `Juan`.
- Los valores sustituidos no se vuelven a interpretar como marcadores (un valor que contenga `{x}` o `{{x}}` se inserta literal).
- Las expresiones matemáticas `{{total_balance * 0.5}}` conservan su comportamiento actual.
- `{{total_balance}}` y `{{total_balanc}}` toman `total_balance` y, si está vacío, `total_balanc` (compatibilidad con contactos normalizados por la ruta antigua).
- Un `{{clave}}` no estándar también se resuelve por el nombre original de la columna del CSV (p. ej. `{{contact_name}}`), además del campo mapeado.
- Se extrae la lógica de plantillas a un módulo puro con pruebas unitarias `node:test` (primeras pruebas del CLI).
- Release del CLI (bump de versión, build e instalación vía autoupdate).

Fuera de alcance: la app web (`v3/lib/template.ts`, spec `v3/template-rendering`) no tiene la pasada de llaves simples ni el defecto; no se modifica. Tampoco se cambia el backend ni el formato del CSV.

## Capabilities

### New Capabilities

_Ninguna._

### Modified Capabilities

- `v3/automated-sending`: cambian "Interpolación de variables con llaves simples" (ya no actúa dentro de `{{...}}`, una sola pasada) y "Variables estándar con llaves dobles" (fuente de `total_balance` con fallback, resolución por columna original).

## Impact

- Código: `v3/cli-whatsapp/agent-config.js` (`parseCSV`), `v3/cli-whatsapp/message-utils.js` (`replaceVariables`), `v3/cli-whatsapp/whatsapp.js` (`sendMessage`), nuevo módulo de plantillas y carpeta de pruebas; `package.json` (script `test`); `build-portable.ps1` (lista de archivos copiados).
- Comportamiento visible: los deudores reciben las variables con llaves dobles correctamente sustituidas; plantillas que hoy "funcionan" enviando `{Juan}` cambian de salida (corrección esperada).
- Flota: requiere publicar una nueva versión del CLI; sin cambio de contrato con el backend.
