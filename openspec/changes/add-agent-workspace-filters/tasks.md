# Tasks

## 1. v3 backend

- [x] 1.1 `publication.ts`/`agentAssignments.ts`: `phoneMode`, `phoneColumns` ordenadas y `overrides` validados (400); verificar con `test/phoneMode.test.ts`
- [x] 1.2 Excluir del listado y rechazar en `/publish` archivos con más de 90 días; verificar con `test/staleAssignments.test.ts`

## 2. ANA Admin

- [x] 2.1 Crear `lib/workspace/table-filters.ts` (orden, filtros, persistencia); verificar con `test/workspace/table-filters.test.ts`
- [x] 2.2 Modo de teléfono, columnas ordenadas y override por fila (`planPhones`); verificar con `test/workspace/phone-mode.test.ts` (equivalencia con el backend)
- [x] 2.3 Asistente de 4 pasos con borrador en `sessionStorage`; verificar con `test/workspace/my-assignment-view.test.tsx`, `wizard-lib.test.ts`, `contacts-filters-view.test.tsx` y `npm run check:design`
