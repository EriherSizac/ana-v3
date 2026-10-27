# Tasks

## 1. v4 backend

- [x] 1.1 Agregar `isSupervisorRole` y aplicar en `resolveUserAccess` carga + reparto (siempre) y envío (salvo deny del rol), sin `AGENTS_MANAGE`, con `isSupervisor` en el acceso; verificar con pruebas vitest de los escenarios de `specs/v4/access-control/spec.md`
- [x] 1.2 Incluir supervisores en `deriveCampaignAgents` con `kind` (agente gana; deny de envío excluye) y leer `kind` en `campaignAgentsList` (ausente = `agent`); verificar con pruebas de derivación y de parseo de listas sin `kind`
- [x] 1.3 Exponer `kind` en `GET /admin/agent-roster`, permitir su lectura con upload + distribute (`canReadRoster`) manteniendo el POST con gestión, y limitar `getDistributableAgents` a `kind:"agent"` (assignments acepta supervisores); verificar con pruebas de handler y de distribución

## 2. v4 desktop

- [x] 2.1 Mostrar vacío el editor cuando la plantilla es `{mensaje}` y el archivo no tiene `mensaje`/`message`; verificar con prueba vitest del helper y que el resto de pruebas del desktop siguen verdes

## 3. v3 backend

- [x] 3.1 Leer `kind` en `roster.ts` (ausente = `agent`) y exponerlo en `GET /admin/campaigns/{c}/roster`, que acepta `AGENTS_MANAGE` o upload + distribute (POST sin cambios); verificar con pruebas de roster y de handler (supervisor lee 200, escribe 403; supervisor habilitado pasa la autenticación de agente)
- [x] 3.2 Cambiar `POST /admin/campaigns/{c}/contacts`: ignorar `message`, no agregar columna `message`, escribir en `assignments/agents/` + `historic/` con `ana_upload_id`, rollback sobre `assignments/`, manifiesto con `destination:"assignments"` y `message:null`; verificar actualizando las pruebas de `adminContacts` y del vínculo de revisión
- [x] 3.3 Actualizar `v3/ana-backend/README.md` (carga a pendientes, roster legible por supervisores) y verificar que los ejemplos coinciden con las rutas de `serverless.yml`

## 4. ANA Admin

- [x] 4.1 `enabled-agents` con `includeSupervisors` (responde `agents` y `supervisors`), `kind` en `server/backends/rosters.ts`, y verificación del plan con el mismo filtro; quitar `message`/`template` de la entrega; verificar con pruebas de route handler (filtro, 409 con supervisor deshabilitado, cuerpo v3 sin `message`, presign v4 sin `template`)
- [x] 4.2 Formulario: flota `v3` por defecto, sin mensaje/plantilla, código de país v4 en Archivo, componente `Toggle` "Incluir supervisores", etiqueta "Supervisor" en vista previa y selector; reasignación del detalle sin mensaje; verificar con pruebas de componente de los escenarios de `specs/admin-web/contact-upload/spec.md` y `npm run check:design`
- [x] 4.3 Insignia "Supervisor" en Agentes (listado con `kind` por flota); verificar con prueba de componente y de `buildListing`
- [x] 4.4 Actualizar `admin-web/README.md` (Contactos para supervisores, toggle, cargas v3 a "Mi asignación") y verificar contra la UI implementada

## 5. Integración

- [x] 5.1 Correr las suites completas (admin-web: test, typecheck, lint, check:design, build con `.env.test`; v3/ana-backend y v4/backend: test y typecheck; v4/desktop: test) y verificar que todas pasan

## Workflow follow-up

- Desplegar según el Migration Plan del design (v3 → ANA Admin → v4) junto con `add-agent-workspace`.
- Archivar después de `add-agent-roster-management`, `add-contact-upload-console` y `link-review-contacts-to-uploads`.
