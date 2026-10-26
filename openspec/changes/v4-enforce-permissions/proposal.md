# Proposal

## Why

v4 tiene un catálogo de permisos `ana:*` administrable por rol, pero en producción casi no se aplica: con `PERMISSIONS_ENFORCED` en `false` (valor por defecto) todo chequeo normal permite la operación, y cinco permisos del catálogo (`ana:chats:message:reply`, `ana:campaign:message:send`, `ana:chats:team:view`, `ana:team:jobs:view`, `ana:team:jobs:manage`) no los verifica ninguna ruta. El resultado: cualquier usuario autenticado del pool puede descargar y enviar jobs, registrar gestiones y ver el roster de sus campañas; un líder no puede "ver como" a sus agentes (contrario a `ARCHITECTURE.md`); un usuario con `ana:team:jobs:view` explícito recibe 403 porque las rutas solo miran `isLeader`; y el editor de roles del desktop solo muestra 7 de los 9 permisos (y al guardar borraría los que no muestra). Para comparar v4 con v3 —que con `add-agent-roster-management` y `migrate-cli-to-cognito-login` exige rol de agente habilitado— v4 debe aplicar sus propios permisos.

## What Changes

- `PERMISSIONS_ENFORCED` con tres modos: `false` (permite), `report` (permite y registra `evt:"perm_would_deny"`) y `true` (aplica). Despliegue en `report` en producción y paso a `true` tras revisar los registros.
- Permisos verificados por ruta:
  - `ana:campaign:message:send`: `GET /jobs/poll`, `POST /jobs/ack`, la reserva de jobs y `POST /interactions/report`.
  - `ana:chats:message:reply`: `POST /interactions/open` y `/interactions/manual`; el desktop oculta el campo de respuesta y el main rechaza envíos manuales sin él.
  - `ana:chats:team:view`: "ver como" (conversaciones y media) de agentes del roster de las campañas propias, además de admin; chequeo independiente del flag.
  - `ana:team:jobs:view` / `ana:team:jobs:manage`: `GET /jobs/summary` y `POST /jobs/reassign` (además de líder y admin), por campaña propia.
  - `GET /agents`: solo admin, líder o con permisos de equipo.
- **Superadmin por rol**: además del superadmin fijo `erick.silva` (se conserva), cualquier usuario con un rol cuyo nombre contenga "superadmin" (sin distinguir mayúsculas, acentos, espacios ni guiones) recibe el mismo acceso total. ANA Admin lo hereda vía v4 `GET /me` (`isAdmin: true`), sin cambios en `add-admin-web-foundation`.
- Los líderes reciben también `ana:campaign:message:send` (suben y envían sus propios CSV).
- Desktop: pestañas y paneles según permisos (no solo `isAdmin`/`isLeader`); "Ver como" para líderes con `ana:chats:team:view`; el editor de roles muestra los 9 permisos y conserva al guardar los que no muestra.
- **BREAKING** (al pasar a `true`): usuarios sin `ana:campaign:message:send` dejan de recibir jobs y sin `ana:chats:message:reply` no pueden responder.

Fuera de alcance: permisos por campaña distintos por rol (siguen globales al usuario), `ana:admin:agents:manage` (lo define `add-agent-roster-management`).

## Capabilities

### New Capabilities

_Ninguna._

### Modified Capabilities

- `v4/access-control`: flag con modo reporte; líderes con permiso de envío; se agrega el superadmin por rol.
- `v4/send-jobs`: se agrega el permiso de envío en la cola del agente.
- `v4/crm-interactions`: se agregan los permisos de registro.
- `v4/conversations`: "ver como" para líderes con `ana:chats:team:view` sobre agentes de sus campañas.
- `v4/team-jobs`: autorización por `ana:team:jobs:view`/`manage`.
- `v4/agent-presence`: el roster solo para admin, líder o permisos de equipo.
- `v4/desktop-shell`: navegación según permisos.
- `v4/desktop-chats`: se agrega la respuesta condicionada al permiso.
- `v4/team-viewer`: visibilidad por permisos; "Ver como" también para líderes.
- `v4/role-admin-ui`: catálogo de 9 permisos; se agrega la conservación de permisos no mostrados.

## Impact

- Depende de `add-agent-roster-management` (tarea 1.1: los roles "Agente <Campaña>" reciben `ana:campaign:message:send` por defecto); sin eso, pasar a `true` dejaría sin jobs a todos los agentes. Se recomienda después de `v4-canonical-identity-keys` (comparaciones de campaña y roster canónicos) y de `v4-review-interrupted-sends` (ruta de reserva).
- Backend: `src/lib/access.ts` (modos, líder), `src/lib/permissions.ts`, `src/handlers/{api,jobsPoll,jobsAdmin,interactions,agents}.ts`, `serverless.yml` (parámetro `permissionsEnforced`).
- Desktop: `electron/main.ts` (consulta `/me` y verifica `reply` en IPC), `src/App.tsx`, `src/lib/permissions.ts`, `src/routes/{Chats,TeamViewer,AdminRolePerms}.tsx`.
- Operación: revisión de `perm_would_deny` en CloudWatch y asignación de permisos a roles antes de activar.
