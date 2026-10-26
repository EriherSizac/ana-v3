# Design

## Context

Ver proposal.md (Why). Estado actual en `injectNoWhatsappInfoButton` (`whatsapp-manual.js:268–460`):

- Node expone `getNoWhatsappPhonesFromNode()` (lee `CONFIG.outputCsv` = `<datos ANA>/resultados.csv`, split por `\r?\n` y por `,`) y `submitNoWhatsappInfoInteraction(phones10)` (arma hasta 200 interacciones y llama a `insertInteractions` de `agent-config.js`, que ya reintenta 404 sin `+52`).
- `openModal()` en la página pide los teléfonos, pinta píldoras y llama a `submitNoWhatsappInfoInteraction` sin esperar ni mostrar resultado.
- `resultados.csv` lo escribe `saveResults` con `csv-writer` (RFC 4180: entrecomilla campos con coma, comilla o salto de línea) y se **sobrescribe en cada ciclo**; columnas: `phone,name,first_name,last_name,credit,discount,total_balanc,product,status,error,sent_at,response`. `response` contiene texto libre del deudor.
- El flujo automático ya registra por cada contacto sin WhatsApp una interacción `No tiene Whatsapp` (outbound) y hace el PATCH de teléfono (spec `v3/crm-interactions`). La interacción `Consulta No Whatsapp` es adicional y su único propósito observable es dejar constancia de que el agente consultó la lista; negocio confirmó que hoy no se usa.
- El cambio paralelo `add-cli-remote-settings` (capacidad `v3/cli-remote-settings`) introduce ajustes remotos del CLI, editados desde la web de administración por usuarios con rol Developer y obtenidos por el CLI al arrancar y de forma periódica, con valor seguro por defecto cuando no están disponibles. Este diseño solo consume el booleano `noWhatsappConsultRegistration`; su almacenamiento y obtención no se especifican aquí.
- `csv-parser@3` ya es dependencia (importado, sin usar, en `csv-utils.js`) y queda dentro del bundle de esbuild.
- Directorio de datos: `ANA_DATA_DIR` o `%APPDATA%\ANA` (mismo cálculo en `config.js` y `agent-config.js`); ahí vive `.agent-config.json`.

## Goals / Non-Goals

**Goals:**
- Abrir el modal no tiene efectos en el CRM.
- Por defecto (ajuste `false` o no disponible) la ventana manual no envía ninguna interacción `Consulta No Whatsapp` ni escribe el archivo de registro.
- Con el ajuste en `true`, como máximo una interacción "Consulta No Whatsapp" por teléfono, agente, campaña y día local desde un mismo equipo.
- Lectura de `resultados.csv` correcta frente a comillas, comas, saltos de línea y BOM.

**Non-Goals:**
- Limpiar los duplicados ya creados en el CRM (requiere acceso al CRM; se deja como pregunta para negocio).
- Deduplicar entre equipos distintos del mismo agente (no hay estado compartido en el backend; ver riesgos).
- Corregir `contact_date` en UTC (mismo defecto que en `v3/manual-gestion`; se mantiene el payload para no mezclar cambios).
- Reescribir `readContacts` de `csv-utils.js`.
- Definir cómo se almacena, edita u obtiene `noWhatsappConsultRegistration` (lo hace `add-cli-remote-settings`).

## Decisions

1. **Registro desactivado por defecto, habilitable por ajuste remoto.** Como negocio no usa el subdictamen, el comportamiento por defecto es no registrar nada. El registro se conserva solo como opción controlada por `noWhatsappConsultRegistration`: si algún día se necesita, un Developer lo activa desde la web de administración sin publicar otro release. Activo, se hace con un botón explícito "Registrar consulta (N)" (N = pendientes) y deduplicado. *Alternativa descartada*: eliminar el registro por completo — más simple, pero reactivarlo exigiría otro release a toda la flota. *Alternativa descartada*: mantener el registro al abrir con deduplicación — el efecto secundario al abrir sigue siendo sorpresivo y el agente no sabe que está registrando algo.

   **Lectura del ajuste**: la ventana manual consulta el valor vigente que expone la implementación de `v3/cli-remote-settings` en el proceso Node (la interfaz concreta la fija ese cambio) en dos puntos: al abrir el modal (para decidir si se muestra el botón) y de nuevo dentro de `registerNoWhatsappConsulta()` antes de enviar, para que un cambio a `false` mientras el modal está abierto no permita registrar. Cualquier valor distinto de `true` estricto (ausente, `undefined`, error, cadena) se trata como `false`.

2. **Deduplicación persistida localmente** en `<datos ANA>/no-whatsapp-consultas.json`:
   ```json
   { "version": 1, "entries": { "<agent_id>|<campaign>|<YYYY-MM-DD local>": ["5512345678", "..."] } }
   ```
   - Fecha local (`getFullYear/getMonth/getDate`), coherente con "día" del agente; el `contact_date` del payload no cambia.
   - Se marcan los teléfonos **solo tras 2xx**; el lote es todo o nada porque la API recibe un único `POST`.
   - En cada escritura se podan claves con fecha de más de 7 días.
   - Escritura atómica: escribir `*.tmp` y `fs.renameSync` sobre el destino. Archivo ausente o JSON inválido ⇒ almacén vacío.
   - *Alternativa descartada*: guardar en `.agent-config.json` — ese archivo lo reescribe `saveAgentConfig` y mezclar estados arriesga perder la config del agente. *Alternativa descartada*: deduplicar en memoria — se pierde al reiniciar ANA, que es frecuente (autoupdate).

3. **Parser CSV: `csv-parser` (ya dependencia) en lugar de `csv-utils.js`.** El parser de `readContacts` está embebido, acoplado a `CONFIG.inputCsv` y `normalizeContact`, separa la cabecera de forma ingenua y no trata `\r`; extraerlo y arreglarlo sería un refactor del flujo de envío automático fuera de alcance. `csv-parser` cumple RFC 4180 y ya va en el bundle. Se usará con `mapHeaders: ({ header }) => header.replace(/^﻿/, '').trim().toLowerCase()` alimentado con `Readable.from([texto])` (el archivo es pequeño; leer completo evita bloquear el archivo mientras `saveResults` escribe). *Alternativa*: parser propio de ~30 líneas — más código que probar sin ventaja.

4. **Módulo puro `v3/cli-whatsapp/no-whatsapp-registry.js`**, sin importar `config.js` (que crea directorios al importarse), con:
   - `parseNoWhatsappPhones(csvText) → Promise<string[]>` (últimos 10 dígitos, únicos, en orden de aparición, solo `status === 'no_whatsapp'`).
   - `localDateKey(date)`, `registryKey(agentId, campaign, date)`.
   - `loadRegistry(filePath)`, `saveRegistry(filePath, registry, now)` (con poda), `pendingPhones(registry, key, phones)`, `markRegistered(registry, key, phones)`.
   - `registrationEnabledFrom(value)` → `value === true` (cualquier otro valor ⇒ `false`).
   - `buildConsultaInteractions({ phones10, campaignName, userId, now })` (mismo payload que hoy, comentario `no_whatsapp_info_registered`).
   `whatsapp-manual.js` solo orquesta: lee el archivo, llama al módulo y a `insertInteractions`.

5. **Contrato página ↔ Node.**
   - `getNoWhatsappPhonesFromNode()` → `{ count, masked, registrationEnabled, pending }` (ya no devuelve los 10 dígitos a la página; no los necesita). Con `registrationEnabled: false` no se lee el archivo de registro y `pending` es `0`.
   - Nueva `registerNoWhatsappConsulta()` sin argumentos: Node vuelve a comprobar el ajuste (si no es `true`, devuelve `{ ok: false, error: 'disabled' }` sin llamar a la API ni tocar el archivo), vuelve a leer el CSV, calcula pendientes, envía hasta 200, persiste si 2xx y devuelve `{ ok, status, registered, pending, error? }`. Tomar la lista en Node (no desde la página) evita que un script en la página dicte qué teléfonos registrar.
   - Guardia de concurrencia en Node (promesa en curso reutilizada) además del `disabled` del botón.
   - Se elimina `submitNoWhatsappInfoInteraction`.

6. **UI**: el cuerpo del modal se construye con `textContent` (alineado con `fix-historial-xss`). Con `registrationEnabled: false` el modal solo muestra total y píldoras, sin botón ni texto sobre registro. Con `true`, estados del botón: "Registrar consulta (N)" → "⏳ Registrando..." → "✅ Registrada (N)" / "❌ No se pudo registrar ({status})"; con N = 0 se muestra "Consulta ya registrada hoy" sin botón activo.

## Risks / Trade-offs

- [`add-cli-remote-settings` no está desplegado o su interfaz cambia] → El valor por defecto es `false`, que coincide con lo que quiere negocio. La integración se aísla en una función `isNoWhatsappConsultRegistrationEnabled()` en `whatsapp-manual.js` que devuelve `false` si el módulo de ajustes no existe o falla. Si este cambio se implementa primero, esa función devuelve `false` fijo hasta que llegue el otro cambio.
- [Con el ajuste activo, el mismo agente en dos equipos registra dos veces] → Aceptado; el volumen máximo baja de "cada apertura" a "una vez por equipo y día". Una deduplicación global requeriría estado en el backend.
- [El volumen de "Consulta No Whatsapp" cae a cero] → Esperado; negocio confirmó que el subdictamen no se usa.
- [Interacción enviada pero respuesta perdida (timeout)] → El teléfono queda pendiente y podría reenviarse una vez; aceptado, mucho menor que el duplicado actual.
- [Conflicto de escritura si dos ventanas escriben el registro] → Solo la ventana manual escribe; la escritura atómica evita archivos truncados.
- [`csv-parser` cambia comportamiento con BOM o `\r\n`] → Pruebas unitarias con ambos casos.

## Migration Plan

1. Implementar módulo + pruebas, integrar en `whatsapp-manual.js`, verificar en WhatsApp Web real.
2. `npm run build` (bump patch + upload) y confirmar `versions/latest.json`.
3. Sin migración de datos: el archivo de registro solo se crea en el primer registro exitoso con el ajuste activo.
4. Orden con `add-cli-remote-settings`: indiferente. Desplegar este primero deja el registro desactivado, que es el estado deseado.
5. Rollback: revertir y publicar otra versión patch (el autoupdate no baja de versión).

## Open Questions

- ¿Se deben depurar en el CRM los duplicados históricos? No afecta este cambio del CLI.
