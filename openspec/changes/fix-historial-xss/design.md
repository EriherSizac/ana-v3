# Design

## Context

Ver proposal.md (Why). Estado actual relevante:

- Toda la UI propia de la ventana manual se construye dentro de funciones pasadas a `page.addInitScript(() => …)` / `page.evaluate(() => …)`. Playwright serializa esas funciones con `Function.prototype.toString()`, así que **no pueden importar módulos** ni cerrar sobre variables de Node: cualquier helper debe vivir en la página.
- El build (`build.ps1`) empaqueta con esbuild (`--bundle`, sin minificar) y `pkg --no-bytecode`, por lo que `toString()` conserva el código fuente de las funciones (es lo que ya hace funcionar a Playwright en el `.exe`).
- La página expone funciones de Node vía `exposeFunction` (`submitGestionInteraction`, `saveChatBackupToBackend`, `getChatBackupFromBackend`, `listAllChatBackupsFromBackend`, `getGestionDataFromBackend`, `getNoWhatsappPhonesFromNode`, `submitNoWhatsappInfoInteraction`, `logToNodeConsole`), todas invocables desde cualquier script que corra en la página.
- Fuentes de datos no confiables: texto de mensajes y nombres de contacto que el deudor controla (llegan al respaldo vía DOM de WhatsApp); respaldos en `POST /backups/chat`, ruta pública sin autenticación (spec `v3/backend-api-security`), por lo que cualquiera que conozca campaña y `agent_id` puede plantar un mensaje; datos del CRM (`/client-info`, `/result-codes`).
- No hay pruebas en `v3/cli-whatsapp`; Node local 22 (`node --test` disponible), target de `pkg` node18.

### Auditoría de `innerHTML` (ventanas manual y monitor, y módulo de respaldo que corre en la manual)

| Ubicación | Qué interpola | Origen | Riesgo | Acción |
|---|---|---|---|---|
| `whatsapp-manual.js:91` overlay login manual (código muerto) | `savedUser`, `savedCampaign` | `.agent-config.json` local | Bajo (no se invoca; dato local) | Escapar por higiene |
| `whatsapp-manual.js:398`, `424`, `436`, `447` modal/botón sin WhatsApp | Estático | — | Ninguno | Sin cambio |
| `whatsapp-manual.js:428` píldoras sin WhatsApp | `count` (número), últimos 4 dígitos ya filtrados con `\D` | `resultados.csv` local | Ninguno por construcción | Sin cambio aquí (lo reescribe `fix-no-whatsapp-modal-duplicates`) |
| `whatsapp-manual.js:1339` indicador modo manual | Estático | — | Ninguno | Sin cambio |
| `whatsapp-manual.js:1362` panel contactos permitidos | `numbers.length` | Interno | Ninguno | Sin cambio |
| `whatsapp-manual.js:1712` overlay "Respaldando chat..." | Estático | — | Ninguno | Sin cambio |
| `whatsapp-manual.js:1765` cuenta regresiva | `countdownSeconds`, cálculos | Interno | Ninguno | Sin cambio |
| `whatsapp-manual.js:1847` `showBackupToast(message)` (sin llamadas hoy) | `message` | Parámetro genérico | Latente | Pasar `message` por `textContent` |
| `whatsapp-manual.js:1898` `showBackupNotification(message)` | `result.stats.new_messages` en el mensaje | Backend ANA | Medio | Pasar `message` por `textContent` |
| `whatsapp-manual.js:2489`, `2518` modal gestión | Estático | — | Ninguno | Sin cambio |
| `whatsapp-manual.js:2539` formulario gestión | `full_name`, `credit_id`, `product_name`, `dictamen`, `subdictamen` (texto y atributos `value`) | CRM | Medio | Escapar texto y atributos |
| `whatsapp-manual.js:2596` error gestión | `e.message` | Excepción / red | Bajo-medio | `textContent` |
| `whatsapp-manual.js:2606`, `2702`, `2812`, `2849`, `2857`, `2864`, `2871`, `2875` | Estático / vaciado | — | Ninguno | Sin cambio |
| `whatsapp-manual.js:2892` fila del historial | `phone10`, `last_message_preview`, `lastUpdated`, `total_messages`, `data-phone`, `data-phone10` | Backend ANA (escribible sin auth) | **Alto** | Construir con `textContent`/`dataset` |
| `whatsapp-manual.js:3182` encabezado de la burbuja | `phoneDisplay` (dígitos), `date` (`last_updated` crudo) | Backend ANA | Medio | Escapar |
| `whatsapp-manual.js:3240` mensaje de la burbuja | `name`/`contact_name`, `timestamp`/`sent_at`, `body`/`message`/`text`, `type` | Deudor vía WhatsApp + backend | **Alto** (vector principal) | Construir con `textContent` |
| `chat-backup.js:713` botón respaldar | Estático | — | Ninguno | Sin cambio |
| `chat-backup.js:795` overlay respaldo masivo | `prog.message` (incluye `chat.title` de WhatsApp y `error.message`) | WhatsApp / excepción | Medio-alto | `textContent` para `prog.message` |
| `whatsapp-monitor.js:102` overlay login monitor (código muerto) | `savedUser`, `savedCampaign` | Config local | Bajo | Escapar por higiene |

Referencia (ventana de automatización, fuera de alcance): `whatsapp.js:53`/`218`/`564` overlays de login con `savedUser`/`savedCampaign` de la config local, `743` estático, `1134` vaciado. No muestran datos de terceros; se dejan igual.

Otros sumideros revisados sin hallazgos: no hay `insertAdjacentHTML`, `outerHTML` ni `document.write` en `v3/cli-whatsapp`. Las notificaciones `showNotification` de gestión e historial ya usan `textContent`.

## Goals / Non-Goals

**Goals:**
- Ningún dato externo (backend, CRM, WhatsApp) se interpreta como HTML en la ventana manual.
- Helper de escape probado con `node:test` y reutilizable en el contexto de la página.
- Mantener el aspecto visual actual (mismos estilos, saltos de línea, orden).

**Non-Goals:**
- Autenticar o sanear en el backend `POST /backups/chat` (pendiente para el plan de seguridad; se anota como riesgo).
- Endurecer la ventana de automatización (`whatsapp.js`).
- Restringir las funciones expuestas (`exposeFunction`) o validar sus argumentos en Node (deseable, otro cambio).
- Corregir la campaña/agente de desarrollo fijos del historial (`whatsapp-manual.js:2758`).

## Decisions

1. **DOM + `textContent` como regla principal; `escapeHtml` solo donde se conserve una plantilla.** Para la burbuja de mensajes, la fila del historial y el overlay de respaldo se construirán los nodos variables con `createElement` + `textContent` (y `dataset` para `data-phone*`), dejando en plantillas solo el marcado estático. Para el formulario de gestión (opciones `<option>` y radios con muchas líneas de estilo) se mantendrá la plantilla y se escaparán texto y atributos con `escapeHtml`. *Alternativa descartada*: escapar todo con plantillas — más fácil de olvidar un campo en atributos. *Alternativa descartada*: sanitizador tipo DOMPurify — dependencia nueva para mostrar texto plano; no hace falta HTML enriquecido.

2. **Módulo `v3/cli-whatsapp/dom-safety.js` con funciones puras autocontenidas** (`escapeHtml(value)`: convierte `null/undefined` a `''`, castea a string y reemplaza `& < > " '`; `digitsOnly(value)`; `phone10ForWhatsappUrl(value)` → últimos 10 dígitos o `''`). Se exporta además `domSafetyInitScript()` que devuelve el código `window.__anaDomSafety = { escapeHtml: (${escapeHtml}), … }` y se registra con `page.addInitScript({ content })` **antes** de los demás init scripts de la ventana manual (Playwright los ejecuta en orden de registro). Las funciones no deben referenciar nada fuera de su cuerpo para sobrevivir a `toString()`. *Alternativa descartada*: duplicar el helper inline en cada init script — sin pruebas y con riesgo de divergencia.

3. **Fallback defensivo en la página.** Cada bloque que use el helper hará `const esc = (window.__anaDomSafety && window.__anaDomSafety.escapeHtml) || ((s) => String(s ?? '').replace(/[&<>"']/g, '') )`: si por cualquier razón el init script no se cargó, se eliminan los caracteres peligrosos en lugar de renderizar crudo (falla cerrada). En `chat-backup.js` (`page.evaluate`) se usa directamente `textContent`, sin depender del helper.

4. **Navegación "Abrir chat" con `phone10ForWhatsappUrl`.** Los dígitos se toman de `contact_phone` (fila) o `phoneDisplay` (burbuja); si no hay 10 dígitos no se navega y se muestra `showNotification('❌ Teléfono inválido', 'error')`.

5. **Saltos de línea**: el cuerpo del mensaje ya usa `white-space: pre-wrap`, así que `textContent` conserva los saltos sin `<br>`.

## Risks / Trade-offs

- [Un `innerHTML` nuevo en el futuro reintroduce el problema] → Prueba de humo `grep` documentada en tasks (revisar que cada `innerHTML` con `${` interpola solo valores escapados o internos) y comentario en `dom-safety.js` con la regla.
- [esbuild altera `toString()` de las funciones del helper] → Prueba unitaria que reconstruye la función desde `toString()` y la ejecuta; verificación manual en el `.exe` construido.
- [Respaldo ya almacenado con payload malicioso] → Con el render seguro deja de ejecutarse; no se requiere migración de datos. Se anota en el informe para revisar respaldos existentes si se sospecha explotación.
- [`POST /backups/chat` sigue público] → Fuera de alcance; se recomienda abrir un cambio en `v3/backend-api-security`.
- [Agentes con versiones viejas siguen vulnerables hasta autoupdate] → Publicar release con prioridad; el autoupdate se aplica al reiniciar el CLI.

## Migration Plan

1. Implementar y probar (`node --test`) en `v3/cli-whatsapp`.
2. Verificación manual con un respaldo plantado (ver tasks).
3. `npm run build` (incrementa versión patch, genera `dist/ANA.exe` y `dist/latest.json`, invoca `setup-and-upload.ps1`) y confirmar `versions/latest.json` en S3.
4. Rollback: el autoupdate nunca baja de versión (`self-update.js` solo actualiza si la remota es mayor), así que revertir significa revertir el commit y publicar otra versión patch con `npm run build`. Volver a subir un `latest.json` antiguo solo detiene la propagación a quien aún no actualizó.

## Decisiones de implementación

- **Script `test`:** ya existía como `node --test` (añadido por `fix-cli-double-brace-templates`; `node --test test/` falla en Node 22). Se reutiliza tal cual; la tarea 1.3 se verificó con `npm test` y con el bundle de `esbuild` (generado fuera de `dist/` para no dejar artefactos).
- **Orden de init scripts:** `domSafetyInitScript()` se registra primero en `initManualWhatsApp`, seguido de `phoneUtilsInitScript()` (de `normalize-whatsapp-phone-country-code`) y después los init scripts existentes.
- **"Abrir chat" usa `window.__anaDomSafety.phone10ForWhatsappUrl`** (exige 10 dígitos, como pide el requisito "Teléfono saneado al abrir chat desde el historial") y no `window.__anaPhone.toLast10`, que devuelve menos de 10 dígitos sin error. Si el helper no cargó, el fallback devuelve `''` y no se navega (falla cerrada). En la fila se usa `contact_phone` crudo guardado en `dataset.phone`; en la burbuja, el `phoneNumber` con el que se cargó el historial.
- **`dataset` en lugar de atributos interpolados:** los botones de la fila ya no llevan `data-phone`/`data-phone10` en la plantilla; se asigna `dataset.phone` después de crear el nodo y ambos botones lo leen.
- **Overlays de login muertos:** `escapeLocal` inline; `${savedUser}` sin valor ahora muestra vacío en lugar de `undefined` (código no invocado).
- **Cuerpo del mensaje en la burbuja:** al asignarse con `textContent`, se eliminan los espacios y saltos de indentación que la plantilla anterior añadía alrededor del texto dentro del `pre-wrap`; el texto y sus saltos de línea propios se conservan.
- **`build-portable.ps1`:** se agregó `dom-safety.js` a `$filesToCopy` (no estaba en tasks, pero sin él el portable falla con `ERR_MODULE_NOT_FOUND`).

### Auditoría actualizada de `innerHTML` (post-implementación, tarea 4.2)

| Ubicación | Interpolación restante | Estado |
|---|---|---|
| `whatsapp-manual.js:96` overlay login (muerto) | `escapeLocal(savedUser/savedCampaign)`, `requireAll` | Escapado |
| `whatsapp-manual.js:399`, `425`, `437`, `448` | Estático | Sin cambio |
| `whatsapp-manual.js:429` píldoras sin WhatsApp | `pills` (últimos 4 dígitos, filtrados con `\D`) | Interno |
| `whatsapp-manual.js:1346`, `1369`, `1697`, `1750` | Estático / `numbers.length` / cuenta regresiva | Interno |
| `whatsapp-manual.js:1832` toast, `1884` notificación de respaldo | `type`, hora local; `message` por `textContent` | Corregido |
| `whatsapp-manual.js:2451`, `2480` | Estático | Sin cambio |
| `whatsapp-manual.js:2504` formulario de gestión | `esc(...)` en texto y atributos `value` | Escapado |
| `whatsapp-manual.js:2561` error de gestión | Estático + `textContent` | Corregido |
| `whatsapp-manual.js:2572`, `2668`, `2764`, `2801`–`2827` | Estático / vaciado | Sin cambio |
| `whatsapp-manual.js:2845` fila del historial | Solo marcado; datos por `textContent`/`dataset` | Corregido |
| `whatsapp-manual.js:3146` encabezado de la burbuja | Solo marcado; resumen por `textContent` | Corregido |
| `whatsapp-manual.js:3207` mensaje de la burbuja | Solo marcado + colores internos; datos por `textContent` | Corregido |
| `whatsapp-monitor.js:106` overlay login (muerto) | `escapeLocal(...)` | Escapado |
| `chat-backup.js:713` | Estático | Sin cambio |
| `chat-backup.js:795` overlay respaldo masivo | `statusIcon`, `statusColor`, `percentage`, `prog.current/total` (internos); `prog.message` por `textContent` | Corregido |
