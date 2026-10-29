# Proposal

## Why

En "Mi asignación" (`add-agent-workspace`) el agente revisa cientos de filas sin poder ordenar ni filtrar, la selección de varias columnas de teléfono envía un mensaje por cada teléfono válido (sin poder elegir a cuál), el flujo en una sola página es difícil de seguir y se ofrecen archivos pendientes antiguos que no deben enviarse.

## What Changes

- **Asistente de 4 pasos** ("Archivo de asignación", "Contactos", "Mensaje", "Resumen y envío") con stepper, Atrás/Siguiente con validación, borrador por campaña en `sessionStorage`, `ConfirmDialog` para enviar y pantalla de éxito/error (según `docs/design-system.md`).
- **Ordenar y filtrar** la tabla de contactos: orden por columna (numérico y fechas `dd/mm/yyyy`), barra de filtros §7.1 (búsqueda, `SearchableMultiselect` por columnas categóricas, rango min/max de montos, "Limpiar filtros", `FilterPill`); "seleccionar todos" = filas filtradas; estado por campaña en `localStorage`.
- **Modo de teléfono**: "Primer teléfono válido" (por defecto en la UI; columnas ordenadas, un mensaje por crédito) o "Todos los seleccionados"; columna "Teléfono a enviar" con override por fila.
- **v3 backend**: `/publish` acepta `phoneMode` (`"first" | "all"`, ausente ⇒ `"all"` por compatibilidad), `phoneColumns` ordenadas y `overrides` `{rowKey: phone}` validados; listado y publicación excluyen archivos con más de 90 días.

## Capabilities

### New Capabilities

Ninguna.

### Modified Capabilities

- `admin-web/agent-workspace` (de `add-agent-workspace`): requisitos nuevos de asistente, orden/filtros, modo de teléfono y antigüedad.
- `v3/agent-workspace` (de `add-agent-workspace`): requisitos nuevos de modo de teléfono, overrides y antigüedad máxima.

## Impact

- admin-web: `MyAssignmentView.tsx` (asistente), `WizardStepper.tsx`, `AssignmentFilesStep.tsx`, `WizardSummary.tsx`, `lib/workspace/table-filters.ts`, `lib/workspace/wizard.ts`, `lib/workspace/index.ts` (`planPhones`), BFF `agentWorkspace.ts`; pruebas vitest/testing-library.
- v3 backend: `src/lib/publication.ts`, `src/handlers/agentAssignments.ts`; pruebas. Compatible con clientes anteriores (sin `phoneMode` se conserva el comportamiento actual). El listado ahora lee hasta 20 archivos para contar filas.
- CLI v3: sin cambios.
