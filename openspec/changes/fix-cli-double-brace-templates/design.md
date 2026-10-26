# Design

## Context

Hoy el mensaje del flujo automático pasa por dos interpolaciones en momentos distintos (ver proposal.md - Why):

1. `parseCSV` (`agent-config.js:398-411`), al recibir el CSV de `/get/chats`: reemplaza `\{(\w+)\}` usando campos mapeados, columnas originales (`rawValues`) y coincidencia parcial. Esta pasada no distingue `{name}` de `{{name}}`.
2. `sendMessage` (`whatsapp.js:1263`) llama a `replaceVariables` (`message-utils.js`): variables estándar, expresiones `{{expr}}`, clave exacta y `\n` literal. Solo conoce el objeto `contact`, no las columnas originales que `fieldMapping` renombró (`contact_name` → `name`, `id_credito` → `credit`, `phone_number` → `phone`).

`parseCSV` mapea `total_balance` → `total_balance`; `normalizeContact` (`message-utils.js`, ruta de CSV local, hoy sin uso desde `index.js`) produce `total_balanc`. `replaceVariables` solo lee `total_balanc`.

`agent-config.js` tiene efectos al importarse (crea el directorio de datos en `%APPDATA%\ANA`), por lo que no sirve como unidad de prueba. El CLI no tiene pruebas ni script `test`; el build portable copia una lista fija de archivos (`build-portable.ps1:92`).

## Goals / Non-Goals

**Goals:**
- Una sola función pura de renderizado, probada con `node --test`, usada por el flujo automático.
- Compatibilidad total con plantillas existentes de llaves simples y expresiones matemáticas.

**Non-Goals:**
- Unificar con `v3/lib/template.ts` (web) o cambiar la spec `v3/template-rendering`: la web no tiene la pasada de llaves simples y su defecto no existe allí.
- Cambiar la coincidencia parcial de llaves simples (puede sorprender, pero hay plantillas que dependen de ella).
- Endurecer el evaluador de expresiones (`Function(...)` sobre una expresión ya filtrada a `[0-9+\-*/().\s%]`); se conserva igual.

## Decisions

### D1. Tokenizador con una sola expresión regular alternada
`renderTemplate(template, { fields, raw })` usa `/\{\{([^{}]+)\}\}|\{(\w+)\}/g` con una función de reemplazo: si casa el grupo 1 se aplica la lógica de llaves dobles; si casa el grupo 2, la de llaves simples. `String.prototype.replace` con regex global recorre la cadena una vez de izquierda a derecha y nunca reprocesa el texto insertado, lo que da gratis "valores no se reinterpretan". Después se convierte `\n` literal en salto de línea.
- Alternativa: tokenizador manual carácter a carácter. Más código para el mismo resultado; la regex alternada es suficiente porque los marcadores no se anidan.
- Alternativa: lookbehind/lookahead en la regex de llaves simples (`(?<!\{)\{(\w+)\}(?!\})`). Arregla `{{name}}` pero mantiene dos pasadas y la reinterpretación de valores; descartada.

### D2. Renderizar una sola vez, en `parseCSV`
El renderizado se hace donde están disponibles tanto los campos mapeados como `rawValues`: `parseCSV` deja en `contact.message` el texto final. `sendMessage` deja de llamar a `replaceVariables` y envía `messageTemplate` tal cual. Así se cumple "una sola pasada" también entre etapas y el log `[DEBUG] Objeto contact completo` de `index.js:489` muestra el mensaje final.
- Alternativa: renderizar en `sendMessage` adjuntando `rawValues` como propiedad no enumerable del contacto. Funciona, pero mueve datos ocultos por el flujo y sigue habiendo dos lugares que "parecen" interpolar.
- `replaceVariables` se conserva exportada como envoltorio de `renderTemplate(template, { fields: contact, raw: contact })` por compatibilidad con `csv-utils.js`/`normalizeContact`, sin uso nuevo.

### D3. Orden de resolución
- Llaves dobles: estándar (`phone`, `name`, `first_name`, `last_name`, `credit`, `discount`, `product` → campo o vacío; `total_balance`/`total_balanc` → `fields.total_balance || fields.total_balanc || ''`); si hay operador → expresión (identificadores resueltos contra `fields` y luego `raw`); si no → `fields[clave]`, luego `raw[clave]`, si no literal.
- Llaves simples: idéntico al actual (campo mapeado salvo `message` → columna original → primera columna que contenga el texto → literal).

### D4. Módulo y pruebas
Nuevo `v3/cli-whatsapp/template-utils.js` sin imports con efectos. Pruebas en `v3/cli-whatsapp/test/template-utils.test.js` con `node:test` + `node:assert/strict`; script `"test": "node --test test/"` en `package.json`. `parseCSV` se mueve tal cual a un módulo puro `assignment-csv.js` (exporta `parseAssignmentCsv`), que `agent-config.js` importa, para poder probar el caso extremo CSV → mensaje final sin los efectos de `agent-config.js`. Los nuevos módulos se agregan a `$filesToCopy` de `build-portable.ps1`; `build.ps1` (esbuild bundle) lo incluye solo.

## Risks / Trade-offs

- [Plantillas que hoy se ven "bien" con `{Juan}` porque el supervisor las corrigió escribiendo `{{{name}}}`] → con el cambio `{{{name}}}` produciría `{Juan}`. Mitigación: prueba que documente el caso; revisar plantillas de `GET /templates` antes del release.
- [Valores numéricos con coma de miles (`1,500`) en expresiones se interpretan como `1.5`] → comportamiento existente, fuera de alcance; queda cubierto por una prueba que lo fija.
- [Olvidar el nuevo archivo en `build-portable.ps1`] → el CLI portable fallaría al arrancar (`ERR_MODULE_NOT_FOUND`). Mitigación: tarea explícita y verificación arrancando `dist-portable/ANA.bat`.

## Migration Plan

1. Implementar y probar (`npm test`).
2. Prueba manual con una asignación de prueba propia (`direct: true`) que contenga `{{name}}`, `{first_name}`, `{{total_balance}}` y `{{total_balance * 0.5}}`.
3. `build-completo.ps1` (incrementa patch) y `npm run upload`; los CLIs instalados se actualizan al siguiente arranque.
4. Rollback: republicar `versions/latest.json` apuntando a la versión anterior no hace downgrade (solo se actualiza si la remota es mayor); el rollback real es publicar una versión mayor con el código anterior.
