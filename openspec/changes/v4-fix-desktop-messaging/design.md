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
