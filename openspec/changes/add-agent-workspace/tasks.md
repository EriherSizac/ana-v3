# Tasks

## 1. v3 backend

- [x] 1.1 Crear `src/lib/assignmentCsv.ts` (parser del CLI con líneas originales) y `src/lib/templateRender.ts` (port de `renderTemplate` con marcadores sin resolver); verificar con pruebas de equivalencia contra `v3/cli-whatsapp/assignment-csv.js` y `template-utils.js`
- [x] 1.2 Crear `src/handlers/agentAssignments.ts` con listado, lectura de archivo, publicación (validación, ETag, teléfonos, render, archivo publicado, consumo, rollback, manifiesto, idempotencia) e historial, y registrarlas en `serverless.yml` con `cognitoAgentJwt`; verificar con pruebas vitest (S3 mockeado) de cada escenario de `specs/v3/agent-workspace/spec.md` y prueba de `serverless.yml`
- [x] 1.3 Documentar las rutas en `v3/ana-backend/README.md` y verificar que coinciden con `serverless.yml`

## 2. ANA Admin

- [x] 2.1 Agregar `ana:campaign:message:send` a la entrada y la sección "Mi asignación"; verificar con pruebas de acceso/navegación (agente solo ve "Mi asignación"; rutas de otras secciones 403)
- [x] 2.2 Crear `src/lib/workspace/` (parser, combinación, teléfonos, render y marcadores desconocidos) con pruebas de equivalencia contra los módulos del CLI
- [x] 2.3 Crear rutas BFF `/api/agent/*` (permiso, alcance, token propagado, `publishId` con un reintento, mapeo de errores, sin datos de contacto en logs); verificar con pruebas de route handler
- [x] 2.4 Construir `/mi-asignacion` (campañas, pendientes, combinar, tabla con búsqueda/orden/selección y teléfonos enmascarados, columnas de teléfono, editor con variables y vista previa por fila, `ConfirmDialog`, estados, historial) siguiendo `docs/design-system.md`; verificar con pruebas de componente de los escenarios de `specs/admin-web/agent-workspace/spec.md` y `npm run check:design`
- [x] 2.5 Documentar "Mi asignación" en `admin-web/README.md` y verificar contra la UI implementada

## 3. Integración

- [x] 3.1 Correr las suites completas (admin-web: test, typecheck, lint, check:design, build con `.env.test`; v3/ana-backend: test y typecheck; v3/cli-whatsapp: `node --test`) y verificar que todas pasan

## Workflow follow-up

- Desplegar v3 (`sls deploy`) y reconstruir ANA Admin (Amplify) junto con `add-supervisor-contact-access`.
- Prueba de punta a punta en dev: carga de supervisor → "Mi asignación" → publicación → `GET /get/chats` desde el CLI.
- Archivar después de `add-supervisor-contact-access`.
