# Proposal

## Why

Varios defectos del desktop v4 cambian el mensaje que recibe el deudor o hacen perder trabajo del agente:

- **Plantilla aplicada a todo**: en "Mi asignación" la plantilla del primer job seleccionado se envía como reemplazo para **todos** los seleccionados; con jobs de varios archivos (otra campaña, otro líder, otra plantilla) los deudores de los demás archivos reciben un mensaje que no les corresponde, con variables que su fila puede no tener (se envían vacías).
- **Moneda con coma decimal**: `{saldo}` con "1234,56" se formatea como "$123,456.00" porque el formato de un campo simple quita todo lo no numérico; las expresiones sí entienden la coma.
- **Respuesta manual perdida**: el texto se borra antes de saber si se envió; si WhatsApp está desconectado la respuesta desaparece sin aviso (también con archivos).
- "Envío iniciado." aparece hasta que **termina** el lote (la aprobación espera todo el envío), la selección conserva jobs ya enviados (contador "seleccionados/pendientes" mayor al total) y la tarjeta flotante muestra el teléfono completo del último envío.

## What Changes

- Aprobación por archivo: una plantilla editable por cada archivo con jobs seleccionados (precargada con la de ese archivo); cada job se envía con la plantilla de su archivo. La aprobación se bloquea si una plantilla queda vacía o usa variables que no existen en las columnas (ni alias) de ese archivo.
- La aprobación responde al aceptarse ("Envío iniciado.") y el progreso sigue por la tarjeta flotante.
- La selección descarta jobs que dejaron de estar pendientes.
- Formato de moneda con la misma interpretación de separadores que las expresiones (coma decimal y miles).
- Respuesta manual: el texto (o archivo) se conserva hasta confirmar el envío; si falla se muestra "No se envió: <motivo>" y se puede reintentar; mientras se envía, el campo y los botones se deshabilitan.
- Tarjeta flotante con el teléfono enmascarado (`***` + últimos 4).
- Release del desktop.

Fuera de alcance: plantillas por campaña administradas en el backend, validación de variables en la carga (`campaign-upload-ui` ya la tiene), permisos de respuesta (`v4-enforce-permissions`).

## Capabilities

### New Capabilities

_Ninguna._

### Modified Capabilities

- `v4/job-processing`: "Aprobación de envío" por archivo con validación y respuesta inmediata; "Búsqueda y selección" sin jobs ya procesados; "Progreso del envío" con teléfono enmascarado.
- `v4/template-interpolation`: "Formato de moneda" entiende coma decimal y separador de miles.
- `v4/desktop-chats`: "Respuesta manual" conserva el texto hasta confirmar y muestra el error.

## Impact

- Desktop: `src/routes/Assignment.tsx`, `src/ui/TemplateEditor.tsx` (reutilizado por archivo), `electron/jobs/poller.ts` (`approve` con plantillas por `srcKey`, respuesta inmediata), `electron/main.ts` y `electron/preload.ts` (firma `approveJobs(jobIds, templatesBySrcKey)`), `src/types/ana.d.ts`, `electron/whatsapp/template.ts` (`formatMoney`/parseo compartido), `src/routes/Chats.tsx`, `src/ui/FloatingProgress.tsx`.
- Backend: sin cambios.
- Pruebas: vitest de `template.ts`, de la validación de variables y de `JobPoller.approve`.
