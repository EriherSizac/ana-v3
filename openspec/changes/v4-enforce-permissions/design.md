# Design

## Context

- `access.ts`: `ENFORCED = process.env.PERMISSIONS_ENFORCED === 'true'`; `can(access, perm)` devuelve `true` si no está aplicado. Hard checks: consola admin, presign de CSV, summary/reassign (`isAdmin`/`isLeader`), "ver como" (solo admin).
- `resolveViewTarget` permite otro operador solo a admin; `presignMediaGet` reutiliza esa función.
- El roster v4 (`ana-backend-agents-<stage>`) relaciona `campaign` con `operatorId` (heartbeat y, con `add-agent-roster-management`, excepciones).
- Desktop: `App.tsx` muestra pestañas por `isAdmin`/`isLeader`/`CONTACTS_UPLOAD`; `TeamViewer` muestra "Ver como" solo a admin; `AdminRolePerms.tsx` tiene un catálogo fijo de 7 permisos y guarda la lista completa que arma con sus casillas.

## Goals / Non-Goals

**Goals:** cada permiso del catálogo con al menos un punto de aplicación; activación sin cortar la operación; desktop coherente con el backend.

**Non-Goals:** cambiar la composición de permisos (defaults, deny, grant gana); permisos por campaña.

## Decisions

- **D1. Modo reporte.** `mode = 'off' | 'report' | 'enforce'` desde `PERMISSIONS_ENFORCED` (`true` → enforce, `report` → report, otro → off). En `report`, `can()` registra `{evt:"perm_would_deny", route, username, perm}` y devuelve `true`. Alternativa: activar directo; se descarta porque los roles de la API externa pueden no tener aún los grants.
- **D2. Mapa ruta → permiso** centralizado (`ROUTE_PERMISSIONS` en `permissions.ts`) para que el reporte y las pruebas recorran la misma tabla.
- **D3. "Ver como" de líder.** Hard check (no depende del flag, como hoy): admin, o usuario con `ana:chats:team:view` cuyo objetivo figura en el roster v4 de alguna de sus campañas (consulta por `campaign` + `operatorId` en la tabla de roster, o en la lista derivada de `add-agent-roster-management` si existe). Aplica a conversaciones, mensajes y media.
- **D4. Equipo.** `summary`: admin, o (`isLeader` o `ana:team:jobs:view`) con la campaña propia; `reassign` y la resolución de por revisar: admin, o (`isLeader` o `ana:team:jobs:manage`) con la campaña propia. Hard checks.
- **D5. Desktop.** El main consulta `GET /me` al recibir el token (y en cada renovación) y guarda los permisos; `wa:send-reply` y `wa:send-media` responden `{ok:false, error:"sin permiso para responder"}` sin `ana:chats:message:reply`. El renderer usa `access.permissions` para pestañas y paneles con la misma regla que el backend (admin = todo).
- **D6. Editor de roles.** Catálogo de 9 en `src/lib/permissions.ts`; al guardar, la lista enviada = casillas + valores leídos del rol que no están en el catálogo mostrado (grants y denies), para no borrar permisos administrados por otras vías.

- **D7. Superadmin por rol, no por permiso.** `isSuperadminRole(name)`: minúsculas, sin diacríticos y sin espacios, guiones ni guiones bajos, contiene `superadmin` (como `isLeaderRole`). Si algún rol coincide, el acceso resuelto es el del superadmin fijo (`campaigns: ["*"]`, todos los permisos, `isAdmin` e `isLeader`) conservando sus `roleIds`/`roleNames` reales. A diferencia del fijo, depende de la API de Roles y se cachea como cualquier acceso (L1/L2 con invalidación por rol), así que quitar el rol surte efecto en ≤ 15 min (o al invalidar). Alternativa descartada: permiso `ana:superadmin` en el catálogo, porque los permisos locales se editan desde el editor de roles con `ana:admin:console:manage` y cualquier admin podría elevarse a superadmin; el nombre del rol lo controla la API de Roles de Pernexium, fuera de ANA. El superadmin fijo `erick.silva` se conserva sin cambios (acceso aun con la API caída).

## Risks / Trade-offs

- [Pasar a `true` deja sin jobs a agentes cuyos roles no tienen "agente" en el nombre] → Revisión de `perm_would_deny` por usuario durante 5 días hábiles; grant explícito `ana:campaign:message:send` a esos roles antes de activar.
- [Latencia extra de la consulta al roster en "ver como"] → Un `GetItem` por solicitud de otro operador; caché del acceso ya existente.
- [Un rol "Superadmin" mal asignado en la API de Roles da acceso total] → Se registra `evt:"superadmin_role"` con username y rol cada vez que se resuelve un acceso de superadmin por rol (no en aciertos de caché); la asignación de ese rol queda bajo control de quien administra la API de Roles.

## Migration Plan

1. Deploy del backend con `permissionsEnforced: report` (dev y prod). 2. Release del desktop. 3. Revisión de registros y ajuste de roles. 4. Redeploy con `permissionsEnforced: true` en dev, prueba con usuarios de cada rol, luego prod. Rollback: redeploy con `report`.

