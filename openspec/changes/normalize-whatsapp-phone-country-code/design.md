# Design

## Context

Formatos de teléfono observados hoy en el CLI v3 (ver proposal.md - Why):

| Consumidor | Dónde | Entrada típica | Salida actual |
|---|---|---|---|
| URL de chat (automático) | `whatsapp.js:1252-1268` | `phone` del CSV | dígitos crudos (bug con 10 dígitos) |
| `/client-info` automático y monitor | `agent-config.js:23` `normalizePhoneForBackend` | CSV / `data-id` | `+52`+10; otros → `+`+dígitos |
| `phone_number` de la interacción automática | `index.js:496-498` | CSV | últimos 10 dígitos |
| Monitor | `whatsapp-monitor.js:468-472` | `data-id` `521...@c.us` | `+52`+10 → últimos 10 |
| Gestión (`/client-info` e interacción) | `whatsapp-manual.js:2170` (Node) | encabezado del chat | `+52`+10; no MX → vacío |
| Modal sin WhatsApp | `whatsapp-manual.js:300-303` | `resultados.csv` | últimos 10 |
| Llave de respaldo automático | `whatsapp-manual.js:1487` (navegador) | encabezado/lista | `521`+10 |
| Historial "Ver" / "Abrir" | `whatsapp-manual.js:2731`, `2931`, `3273` (navegador) | respaldo | `521`+10 / `send?phone=52`+10 |

Las llaves en S3 de los respaldos son `backups/{campaign}/{agent_id}/{contact_phone}/chat_backup.json` (`chatBackups.ts:41,250`) y ya contienen `521...`. Las funciones del navegador se definen dentro de `page.addInitScript(() => {...})` y no pueden importar módulos de Node.

## Goals / Non-Goals

**Goals:**
- Una sola fuente de verdad para las reglas de teléfono, probada con `node --test`, usada en Node y en las páginas.
- Corregir la URL del chat automático sin alterar ningún payload al CRM ni ninguna llave de respaldo.

**Non-Goals:**
- Unificar `phone_number` de interacciones (10 dígitos vs `+52` en Gestión): decidido no hacerlo (D4).
- Migrar llaves de respaldo a `52`+10.
- Los botones "Abrir" del historial (propiedad de `fix-historial-xss`).
- El respaldo masivo (`chat-backup.js`), que guarda el teléfono tal como aparece (`+` y dígitos) dentro del JSON y no lo usa como llave.

## Decisions

### D1. Parseo único → salidas por consumidor
`phone-utils.js` expone `createPhoneUtils()`, una fábrica sin dependencias externas que devuelve:
- `parseMxPhone(raw)` → `{ digits, national10 | null }`: quita todo lo que no es dígito; `national10` se obtiene solo si los dígitos son 10, `52`+10 (12) o `521`+10 (13).
- `toWhatsAppUrlPhone(raw)` → `52`+national10, o `digits` si no es MX, o `''`.
- `toCrmSearchPhone(raw)` → `+52`+national10, o `+`+digits si no es MX, o `''` (idéntico al actual de `agent-config.js`).
- `toGestionCrmPhone(raw)` → `+52`+national10, o `''` si no es MX.
- `toLast10(raw)` → últimos 10 dígitos (regla actual de `index.js`, monitor y modal).
- `toBackupKeyPhone(raw)` → `521`+national10, o `digits` si no es MX (idéntico al actual).

Node usa `export const phone = createPhoneUtils()`; `normalizePhoneForBackend` de `agent-config.js` pasa a ser alias de `toCrmSearchPhone` para no romper importaciones.
- Alternativa: una función `normalizePhone(raw, target)` con `switch`. Equivalente; nombres explícitos hacen más legible cada sitio de uso y los diffs de revisión.

### D2. Inyección en el navegador desde la misma fuente
Antes de los `addInitScript` existentes, cada página (manual) registra `page.addInitScript({ content: \`window.__anaPhone = (${createPhoneUtils.toString()})();\` })`. Los scripts del navegador reemplazan sus copias locales (`normalizePhoneForBackend` del respaldo, `normalizePhone` del historial) por `window.__anaPhone.toBackupKeyPhone(...)`. Los botones "Abrir" del historial no se tocan aquí: el cambio en curso `fix-historial-xss` ya define su regla (últimos 10 dígitos, error si no hay 10) y puede apoyarse en `window.__anaPhone.toLast10`. Por eso `createPhoneUtils` MUST ser autocontenida (sin referencias a variables externas, sin imports); una prueba lo verifica evaluando `Function('return (' + createPhoneUtils.toString() + ')()')()` en aislamiento.
- Alternativa: `page.exposeFunction` y llamar a Node. Obliga a volver asíncronas funciones que hoy son síncronas dentro de bucles de sondeo; descartada.
- Alternativa: mantener copias y probarlas por separado. No elimina la divergencia que motiva el cambio.

### D3. Qué se considera número MX
Solo longitudes exactas 10 / 12 (`52`) / 13 (`521`). Un número de 10 dígitos siempre es nacional MX (los agentes y carteras son MX). Prefijos antiguos (`044`, `045`, `01`) no se reconocen y pasan sin cambio; se fija con prueba.

### D4. Gestión → CRM conserva `+52XXXXXXXXXX` (decisión confirmada)
El teléfono que Gestión envía al CRM (`/client-info` y la interacción) se mantiene en `+52` + 10 dígitos (`toGestionCrmPhone`); es el comportamiento correcto y no se unifica con los 10 dígitos de los flujos automático, monitor y modal sin WhatsApp. Este cambio solo ajusta las longitudes reconocidas (D3) en Gestión.
- Alternativa: unificar todos los flujos en un formato. Descartada: no hay evidencia de que el CRM falle con ninguno y cambiarlo puede afectar reportes existentes.

## Risks / Trade-offs

- [WhatsApp Web podría preferir `521` para algunos móviles antiguos] → desde 2019 el formato internacional MX es `52`+10 y WhatsApp lo acepta; la prueba manual 3.x lo confirma con un número real antes del release.
- [Un CSV con números de 10 dígitos que no son MX] → se les antepondría `52`; aceptado, las carteras son MX.
- [`toString()` de la fábrica puede cambiar con minificación del bundle esbuild (`build.ps1`)] → el bundle no minifica; aun así la prueba de autocontención y la verificación manual en la ventana manual cubren el riesgo.
- [Cambio de Gestión con 14+ dígitos `521...`] → hoy produce un valor sin sentido; pasa a vacío y el modal muestra "No se encontró información de cliente para este teléfono.", aceptado.

## Migration Plan

Sin migración de datos. Release normal del CLI (build + upload). Rollback = publicar una versión mayor con el código anterior.

## Decisiones de implementación

- **Llave de respaldo con 12 dígitos que empiezan con `521`.** Con D1/D3 literal, `521234567890` (12 dígitos, `52` + un "nacional" que empieza con `1`) daría la llave `5211234567890`, mientras que la implementación anterior devolvía los dígitos tal cual. Para no crear una llave nueva en ese caso límite (requisito "Estabilidad de la llave de respaldo"), `toBackupKeyPhone` conserva esos 12 dígitos sin cambio. Las demás salidas no se ven afectadas (CRM y URL coinciden con las implementaciones previas); una prueba con oráculos lo fija.
- **`phoneUtilsInitScript()`** se exporta desde `phone-utils.js` para construir el contenido de `addInitScript` (`window.__anaPhone = (createPhoneUtils.toString())();`) en un solo lugar; la ventana manual lo registra antes del script de protecciones. Se verificó que el código sigue siendo autocontenido también tras empaquetar `phone-utils.js` con `esbuild` (mismas opciones que `build:bundle`).
- **Monitor:** `phoneDigits` (que se sigue pasando a `getGestionDataFromBackendForMonitor` y a los logs) se obtiene con `phone.parseMxPhone(phoneE164).digits` en lugar de un `replace(/\D/g, '')` ad hoc; el valor es el mismo.
- **Gestión:** se eliminó la función Node `normalizePhoneForBackend` de `whatsapp-manual.js`; `getGestionDataFromBackend` llama directamente a `phone.toGestionCrmPhone`. Las funciones del navegador conservan su nombre local (`normalizePhoneForBackend`/`normalizePhone`) como envoltorio de una línea sobre `window.__anaPhone.toBackupKeyPhone` para minimizar el diff.
- **`sendMessage`** registra en consola la URL del chat (`🔗 Abriendo chat: ...`) para la verificación manual de la tarea 2.1.
