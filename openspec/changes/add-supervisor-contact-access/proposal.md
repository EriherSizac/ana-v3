# Proposal

## Why

Los usuarios con rol "Supervisor <Campaña>" son quienes reparten contactos en la operación, pero hoy no entran a la sección Contactos de ANA Admin: v4 `resolveUserAccess` solo da carga y reparto a líderes, y la lectura de agentes habilitados que usa el formulario exige `ana:admin:agents:manage`. Además la carga obliga a escribir el mensaje (v3) o la plantilla (v4), cuando quien conoce el mensaje es el agente, y la carga v3 escribe directo en `agents/` (lo que el CLI consume) sin que el agente pueda revisar ni elegir. Por último, los supervisores también trabajan contactos y no hay forma de entregarles una parte.

## What Changes

- **Rol de supervisor (v4)**: un rol cuyo nombre contiene "líder" o "supervisor" (sin acentos ni mayúsculas; en Pernexium el supervisor es el rol "Líder <Campaña>") otorga `ana:contacts:list:upload`, `ana:contacts:list:distribute` y `ana:campaign:message:send` (este último salvo deny del rol), sin `ana:admin:agents:manage`; su alcance son las campañas de sus roles.
- **Supervisores como destinatarios**: la sincronización v4 incluye en `campaign-agents/{c}.json` (v3) y en el roster v4 a los supervisores de cada campaña con `kind:"supervisor"` (los agentes llevan `kind:"agent"`; sin `kind` = agente). La regla de habilitación y las excepciones aplican igual a ambos, así que el CLI v3, "Mi asignación" y el desktop v4 aceptan a un supervisor habilitado. El reparto automático de v4 (sin `assignments`) sigue usando solo agentes.
- **Lectura del roster para quien reparte**: `GET /admin/campaigns/{c}/roster` (v3) y `GET /admin/agent-roster` (v4) aceptan `ana:admin:agents:manage` **o** (`upload` **y** `distribute`) para leer; las escrituras siguen exigiendo `ana:admin:agents:manage`. Ambas respuestas exponen `kind`.
- **Formulario de carga (ANA Admin)**: flota preseleccionada en v3; se quitan el mensaje (v3) y la plantilla (v4); toggle "Incluir supervisores" (apagado por defecto) que agrega a los supervisores habilitados al reparto y al selector de "Asignar a un agente", con etiqueta "Supervisor" en la vista previa. El BFF verifica el plan con el mismo filtro. Agentes muestra la insignia "Supervisor".
- **BREAKING (contrato interno ANA Admin ↔ v3)**: `POST /admin/campaigns/{c}/contacts` deja de exigir y de usar `message` (se ignora si llega) y escribe en `assignments/agents/{c}/{agent}-contacts-{ts}.csv` (pendientes del agente) + `historic/`, ya no en `agents/`; el manifiesto declara `destination:"assignments"`. Se conserva `ana_upload_id` como última columna. El agente publica desde "Mi asignación" (`add-agent-workspace`).
- **v4 sin plantilla**: ANA Admin pide el presign sin `template` (v4 usa `{mensaje}` por defecto); el desktop muestra vacía esa plantilla por defecto cuando el archivo no tiene columna `mensaje`/`message`, para que el agente escriba el mensaje.

Fuera de alcance: `POST /supervisors/...` con `X-Admin-Key` (sin cambios), reparto automático v4 con supervisores, cambios al CLI.

## Capabilities

### New Capabilities

_Ninguna._

### Modified Capabilities

- `v4/access-control`: rol de supervisor por nombre.
- `v4/agent-roster` (de `add-agent-roster-management`): supervisores en la lista derivada con `kind`, lectura del roster con permisos de contactos, reparto automático solo con agentes.
- `v3/agent-roster` (de `add-agent-roster-management`): `kind` en la lista derivada, supervisores habilitables, lectura del roster con permisos de contactos.
- `v3/agent-assignments`: la carga de administración escribe en pendientes y deja de usar `message`.
- `admin-web/contact-upload` (de `add-contact-upload-console`): flota por defecto, sin mensaje/plantilla, toggle de supervisores.
- `admin-web/agent-management` (de `add-agent-roster-management`): insignia "Supervisor".
- `v4/job-processing`: plantilla por defecto vacía para cargas sin plantilla.

## Impact

- v4 backend: `src/lib/permissions.ts`, `access.ts`, `campaignAgents.ts`, `campaignAgentsList.ts`, `agents.ts`, `agentRoster.ts`, `distribution.ts`, `handlers/agents.ts` + pruebas.
- v4 desktop: plantilla por defecto en "Mi asignación" + prueba.
- v3 backend: `src/lib/roster.ts`, `handlers/adminRoster.ts`, `handlers/adminContacts.ts` + pruebas.
- admin-web: `ContactsUploadView`, ruta `enabled-agents`, `server/contacts/delivery.ts`, `server/backends/rosters.ts`, listado y vista de Agentes, componente `Toggle`, reasignación del detalle de carga + pruebas.
- Despliegue coordinado con `add-agent-workspace` (sin "Mi asignación" las cargas v3 quedarían en pendientes); orden: v3 → v4 → ANA Admin.
