# Proposal

## Why

ANA Admin no se actualiza sola: un supervisor que reparte contactos no ve avanzar la carga ni aparecer contactos por revisar sin recargar, el roster de Agentes queda viejo si otro admin lo cambia, y un agente en "Mi asignación" no se entera de que le repartieron contactos. Tampoco hay forma de que un admin haga que las sesiones abiertas (consola, desktop, CLI) vuelvan a leer su acceso tras un cambio. Con el canal de `add-realtime-gateway`, la consola puede recargar solo la sección afectada cuando algo cambia, releer el acceso cuando el servidor lo fuerza y ofrecer a los admins un botón para forzarlo.

## What Changes

- El navegador abre, tras el login, una sola conexión WebSocket directa al gateway (`client=admin`, origen `https://ana-admin.pernexium.com.mx`) con el ID token de Amplify como subprotocolo, con latido, backoff, reconexión planeada (110 min o token renovado) y cierre al cerrar sesión. El BFF no interviene.
- Las secciones se recargan por REST (BFF existente) ante su evento: Contactos (historial y detalle de cargas: `uploads.changed`, `review.changed`), revisión v4 (`review.changed`), Agentes (`roster.changed`), Mi asignación (`assignment.pending`, `publications.changed`) y Configuración (`settings.changed`).
- Si el usuario tiene trabajo sin guardar en la vista (filas cargadas y seleccionadas, un diálogo abierto, un formulario editado), se muestra un aviso "Hay cambios nuevos · Actualizar" en lugar de recargar.
- `session.refresh` (actualización forzada): la consola vuelve a leer `GET /api/me` (navegación y permisos), recarga la sección visible con la misma protección del trabajo sin guardar y reconecta tras 0–10 s.
- Botón "Forzar actualización" (solo `ana:admin:console:manage` o superadmin) en la sección Agentes: diálogo para elegir un usuario, una campaña o todos, confirmación y llamada a la ruta nueva del BFF `POST /api/realtime/refresh` → v4 `POST /admin/realtime/refresh`.
- Indicador "En vivo"/"Sin actualizaciones en vivo" en el encabezado; con el canal inactivo la consola recarga la sección al volver el foco a la pestaña (no hay polling periódico, como hoy).
- Con la pestaña oculta más de 10 minutos se cierra la conexión; al volver se reconecta y se recarga la sección visible.
- Flag de build `NEXT_PUBLIC_REALTIME_ENABLED` y URL `NEXT_PUBLIC_REALTIME_URL` (la URL execute-api `RealtimeWsUrl`, sin dominio propio; sin URL no hay conexión); el interruptor del servidor apaga el canal sin redeploy.
- Despliegue de ANA Admin en Amplify.

Fuera de alcance: pasar el socket por el BFF/SSR, notificaciones del navegador, sonido, actualizar datos desde el payload del evento.

## Capabilities

### New Capabilities

- `admin-web/realtime-updates`: conexión de la consola al canal realtime, recarga por sección, protección del trabajo sin guardar, actualización forzada (recepción y botón de admin), indicador y flags.

### Modified Capabilities

(ninguna; las capacidades `admin-web/*` afectadas viven aún en cambios pendientes, por lo que el comportamiento nuevo se declara completo en `admin-web/realtime-updates`)

## Impact

- Depende de `add-realtime-gateway` (prod, con el origen de ANA Admin en la lista, `session.refresh` y `POST /admin/realtime/refresh`) y de las secciones de `add-admin-web-foundation`, `add-contact-upload-console`, `link-review-contacts-to-uploads`, `v4-review-interrupted-sends`, `add-agent-roster-management`, `add-agent-workspace`, `add-cli-remote-settings` y `v4-add-desktop-remote-settings`.
- admin-web: nuevo `src/lib/realtime/` (cliente, configuración, `RealtimeProvider`, `useRealtimeRefresh`), `src/app/(console)/layout.tsx` (provider), `ConsoleGate.tsx` (relectura de `/api/me`), `AppHeader.tsx` (indicador), vistas `ContactsUploadView`, `UploadHistoryView`, `UploadDetailView`, `V4ReviewView`, `AgentsView` (más el diálogo "Forzar actualización"), `MyAssignmentView` y la página de Configuración; ruta BFF `src/app/api/realtime/refresh/route.ts`; variables en Amplify.
- Sin dependencias nuevas (`WebSocket` del navegador). Sin cambios en los backends fuera de `add-realtime-gateway`.
