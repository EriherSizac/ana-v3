# Tasks

## 1. Backend: modos y mapa de permisos

- [x] 1.1 Agregar `vitest` y `aws-sdk-client-mock` a `v4/backend` si ningún cambio previo lo hizo; verificar con `npm test`
- [x] 1.2 Implementar los modos `off`/`report`/`enforce` en `access.ts` (`can()` con contexto de ruta y log `perm_would_deny`) y agregar `CAMPAIGN_SEND` al conjunto del líder; verificar con vitest de los escenarios de `specs/v4/access-control/spec.md`
- [x] 1.3 Crear `ROUTE_PERMISSIONS` en `permissions.ts` y aplicarlo en `jobsPoll.ts` (poll, ack, claim si existe), `interactions.ts` (report → send; open/manual → reply) y `api.ts`; verificar con una prueba vitest que recorre la tabla y comprueba 403 con `enforce` y 200 + log con `report` para cada ruta

- [x] 1.4 Agregar `isSuperadminRole` a `permissions.ts` y aplicarlo en `resolveUserAccess` con el acceso total del superadmin fijo, `roleIds`/`roleNames` reales, caché normal y log `superadmin_role` (design D7); verificar con vitest de los cuatro escenarios de "Superadmin por rol" (incluye invalidación por rol con tombstone y que `erick.silva` sigue sin consultar la API)

## 2. Backend: equipo

- [x] 2.1 Extender `resolveViewTarget` (conversaciones, mensajes y media) con `ana:chats:team:view` + pertenencia del objetivo al roster de una campaña propia (design D3); verificar con vitest de los cuatro escenarios de `specs/v4/conversations/spec.md`
- [x] 2.2 Cambiar la autorización de `summary`/`reassign` (y de la consulta/resolución de por revisar si existen) a design D4; verificar con vitest de los escenarios de `specs/v4/team-jobs/spec.md`
- [x] 2.3 Exigir líder o permisos de equipo en `GET /agents` (`agents.ts`); verificar con vitest (agente sin permisos → 403; líder → roster)
- [x] 2.4 Agregar el parámetro de despliegue `permissionsEnforced` con valores documentados en `serverless.yml`; verificar con `npx serverless package --stage dev --param="permissionsEnforced=report"` que la variable queda en la plantilla

## 3. Desktop

- [x] 3.1 Agregar `vitest` a `v4/desktop` si ningún cambio previo lo hizo; crear en `src/lib/permissions.ts` el catálogo de 9 y funciones puras de visibilidad (pestañas, panel de equipo, "Ver como", "Mover") y de armado de la lista a guardar (D6); verificar con vitest de cada escenario de `desktop-shell`, `team-viewer` y `role-admin-ui`
- [ ] 3.2 Usar esas funciones en `App.tsx`, `TeamViewer.tsx` (incluye "Ver como" para líderes con campañas propias) y `AdminRolePerms.tsx`; verificar con `npm run build` y manualmente en dev con usuarios de prueba admin, líder, agente y supervisor de solo lectura
- [ ] 3.3 En `electron/main.ts`, consultar `GET /me` al fijar o renovar el token y rechazar `wa:send-reply`/`wa:send-media` sin `ana:chats:message:reply`; ocultar campo, adjunto y "Registrar gestión" en `Chats.tsx`; verificar con vitest de la función de decisión del IPC y en dev con un rol con `-ana:chats:message:reply`

## 4. Documentación

- [x] 4.1 Actualizar `v4/Implementar_roles_locales.md` y `v4/ARCHITECTURE.md` con el mapa ruta → permiso, los modos del flag, el superadmin por rol (quién lo asigna y cómo se retira) y el procedimiento de activación; verificar que la tabla documentada coincide con `ROUTE_PERMISSIONS`

## 5. Despliegue, activación y release

- [ ] 5.1 Confirmar que la tarea 1.1 de `add-agent-roster-management` (permiso de envío por defecto para roles "Agente …") está desplegada en el backend v4; si no, detener la activación (paso 5.4) hasta que lo esté
- [ ] 5.2 Desplegar el backend en dev y prod con `permissionsEnforced=report` (`npx serverless deploy --stage dev|prod --param="permissionsEnforced=report"`); verificar en CloudWatch que aparecen eventos `perm_would_deny` solo para los casos esperados
- [ ] 5.3 Release del desktop: subir `version`, `npm run publish`, verificar `latest.yml` en `s3://ana-desktop-updates/updates/` y en la PC piloto que un líder ve "Ver como" con sus agentes
- [ ] 5.4 Tras 5 días hábiles en `report` y con los roles ajustados (grants explícitos para los usuarios que aparecían en `perm_would_deny` y deben operar), desplegar dev con `true`, probar con un usuario de cada tipo, y luego prod; verificar que en las 24 h siguientes no hay 403 inesperados en `jobsPoll`/`interactions`

## Workflow follow-up

- Tras archivar, quitar de la nota de Purpose de `openspec/specs/v4/access-control/spec.md` la lista de permisos no verificados y de `conversations`, `desktop-shell` y `team-viewer` las notas sobre `ana:chats:team:view` no evaluado.
