# Design

## Context

- `Assignment.tsx` toma `firstSelected.template` como valor por defecto y llama `approveJobs([...selected], template || undefined)`; `JobPoller.approve` aplica `templateOverride` a todos y hace `await` de todo el envío antes de responder.
- `template.ts`: `formatMoney(v)` usa `String(v).replace(/[^\d.-]/g, '')`; `evalMathExpr` tiene su propio parseo con coma decimal.
- `Chats.tsx` `sendReply` hace `setReply('')` antes de `await window.ana.sendReply` y no muestra errores.
- El `TemplateEditor` ya calcula variables desconocidas para "Campañas" (`campaign-upload-ui`).

## Goals / Non-Goals

**Goals:** que cada deudor reciba la plantilla de su carga; montos correctos; ninguna respuesta perdida en silencio.

**Non-Goals:** cambiar el ritmo o el orden de envío; editar plantillas de jobs directos (siguen sin aprobación).

## Decisions

- **D1. Plantillas por `srcKey`.** La vista agrupa la selección por `srcKey` (o `campaignId` si no hay `srcKey`) y muestra un editor por grupo, titulado con el `label` o nombre del archivo y el número de seleccionados; con un solo grupo la UI se ve como hoy. IPC: `approveJobs(jobIds: string[], templates: Record<string, string>)`; el main aplica a cada job `templates[srcKey] ?? job.template`. Alternativa: aprobar un archivo a la vez; se descarta porque obliga a varios clics para el caso común de un agente con dos cargas.
- **D2. Validación de variables por grupo.** Se reutiliza la función de variables desconocidas del editor de "Campañas" con las columnas de la fila del primer job del grupo más los alias; plantilla vacía o con variables desconocidas → botón deshabilitado y mensaje por grupo.
- **D3. Respuesta inmediata.** `approve` valida, marca `sending = true`, arranca el proceso sin `await` y responde `{ ok: true }`; los errores posteriores se reflejan en el progreso. Mantiene "Ya hay un envío en curso".
- **D4. Selección.** En cada publicación de la asignación, la selección se interseca con los jobs pendientes; los nuevos pendientes se agregan seleccionados como hoy.
- **D5. Parseo numérico único.** `parseLocaleNumber(raw)` (el algoritmo actual de `evalMathExpr`: coma decimal si termina en `,d` o `,dd`; si no, comas como miles) usado por `formatMoney` y por las expresiones. "1.234,56" → 1234.56; "1,234.56" → 1234.56; "1234,56" → 1234.56; "1,234" → 1234.
- **D6. Respuesta manual.** `sending` local: deshabilita campo, 📎 y "Enviar"; al terminar con `ok` limpia el campo; con error conserva texto y archivo seleccionado y muestra "No se envió: <error>" bajo el campo hasta el siguiente intento o cambio de chat.
- **D7. Máscara** con la misma función que las tablas (`***` + 4).

## Risks / Trade-offs

- [Agentes acostumbrados a "una plantilla para todo"] → Con un solo archivo la UI no cambia; con varios, cada editor muestra el nombre del archivo.
- [Un CSV con "1.234" como miles sin decimales se lee como 1.234] → Ambigüedad inherente; es la regla que ya usan las expresiones; se documenta que los montos deben llevar decimales o usar punto decimal.

## Decisiones de implementación

- **Clave de archivo** `fileKey(job) = srcKey || campaignId`, exportada en `electron/jobs/poller.ts` y replicada en `Assignment.tsx`; la UI manda `templates` con TODOS los grupos seleccionados (editados o no) y el main aplica `templates[fileKey] ?? job.template`.
- **Validación en el main** además de la UI: si algún job seleccionado queda sin plantilla (ni la del grupo ni la propia), `approve` responde `{ ok: false, error: 'Falta el mensaje de un archivo' }`.
- **Respuesta inmediata**: `approve` marca `sending`, programa el lote con `setTimeout(0)` (así la respuesta llega antes del primer `runJob`) y responde `{ ok: true }`; `currentBatch()` expone la promesa del lote para pruebas. Se conserva la integración con `pauseNewJobs`/`waitIdle` del cambio de sesión.
- **Etiqueta del grupo**: último segmento del `srcKey` (nombre del objeto en S3) o la campaña; no hay `label` en el job.
- **`parseLocaleNumber`** se exporta de `template.ts`; efecto colateral: una expresión sobre una columna sin dígitos (p. ej. `{nombre*2}`) ya no se evalúa como 0 sino que deja el placeholder visible (antes `Number('')` daba 0).
- **`getUnknownTemplateVars`** se movió a `src/lib/templateVars.ts` (puro) y `TemplateEditor.tsx` lo re-exporta, así `Campaigns.tsx` no cambia.
- **`maskPhone`** se movió a `src/lib/mask.ts` (re-exportado desde `src/lib/api.ts`) para probarlo sin Amplify.
- **Respuesta manual**: guardia síncrona con `useRef` contra doble Enter además del estado `replySending`; un archivo que falla queda como chip "📎 nombre · Reintentar · Quitar" junto al error.
- Verificaciones manuales en dev (2.3 dos CSV y `{apodo}`, 3.1 WhatsApp desconectado y doble Enter) y release (5.1) pendientes.
