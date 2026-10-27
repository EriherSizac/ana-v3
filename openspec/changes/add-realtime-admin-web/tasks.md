# Tasks

## 1. Cliente y provider

- [x] 1.1 Crear `src/lib/realtime/client.ts` (subprotocolo `ana.v1, <token>`, `client=admin&v=<versión>`, `ping` al abrir y cada 5 min, activo tras el primer `pong`, backoff 1 s→5 min con jitter y 15 min tras 403 o 5 fallos, reconexión a los 110 min o con token nuevo (chequeo cada 60 s) con make-before-break, cierre tras 10 min oculta y reconexión al volver, `session.refresh` → cierre 4001 + `onRefresh` + reconexión tras 0–10 s sin crecer el backoff, sin token en `console`); verificar con vitest y `WebSocket`/temporizadores/`visibilityState` falsos cada escenario de "Conexión directa desde el navegador", "Mantenimiento de la conexión de la consola", "Pestaña oculta" y la parte de conexión de "Actualización de acceso forzada en la consola"
- [x] 1.2 Crear `RealtimeProvider` y montarlo dentro de `ConsoleGate` (envuelve el encabezado y la sección de `src/app/(console)/layout.tsx`), con cierre en `logout()`; leer `NEXT_PUBLIC_REALTIME_URL` y `NEXT_PUBLIC_REALTIME_ENABLED` en un módulo de configuración del cliente (no en `src/server/env.ts`, que es solo del servidor; sin URL → deshabilitado); verificar con pruebas de componente (una sola conexión al navegar entre secciones; ninguna con `NEXT_PUBLIC_REALTIME_ENABLED=false` o sin URL) y con `npm run check:bundle` (no se cuelan secretos)
- [x] 1.3 Indicador "En vivo"/"Sin actualizaciones en vivo" en `AppHeader.tsx` con los componentes del sistema de diseño (`Badge`); verificar con prueba de componente por estado y `npm run check:design`
- [x] 1.4 Exponer desde `ConsoleGate` un `refreshAccess()` (relee `GET /api/me` sin desmontar) y llamarlo desde el provider ante `session.refresh`; verificar con pruebas de componente el escenario "Permiso retirado con la consola abierta"

## 2. Recarga por sección

- [x] 2.1 Crear `useRealtimeRefresh({types, campaign, reload, isDirty})` (coalescencia 1 s, filtro de campaña, aviso "Hay cambios nuevos · Actualizar" si `isDirty`, recarga al reconectar y tras `session.refresh`, recarga al foco con canal inactivo máx. 1/min); verificar con vitest los escenarios de "Trabajo sin guardar protegido", "Lectura al reconectar en la consola", "Canal inactivo en la consola" y "Agente con trabajo sin guardar"
- [x] 2.2 Usar el hook en `UploadHistoryView`, `UploadDetailView` y `ContactsUploadView` (`uploads.changed`, `review.changed`) y en `V4ReviewView` (`review.changed`); verificar con pruebas de componente: evento de la campaña → `load()` una vez; evento de otra campaña → nada; wizard de carga en curso → aviso en lugar de recarga
- [x] 2.3 Usar el hook en `AgentsView` (`roster.changed`, sucio con acción masiva en curso) y en la página de Configuración (`settings.changed`, sucio con diálogo abierto o valor editado); verificar con pruebas de componente los escenarios correspondientes
- [x] 2.4 Usar el hook en `MyAssignmentView` (`assignment.pending` → pendientes, `publications.changed` → historial; sucio con archivos cargados o filas seleccionadas); verificar con pruebas de componente "Reparto a un agente con Mi asignación abierta" y "Agente con contactos seleccionados"
- [x] 2.5 Documentar en `admin-web/README.md` el canal, las variables, qué evento recarga cada sección, la regla de "trabajo sin guardar" y el botón "Forzar actualización"; verificar que la tabla documentada coincide con los `types` usados en el código

## 3. Forzar actualización

- [x] 3.1 Crear la ruta BFF `src/app/api/realtime/refresh/route.ts` (`withAccess` con requisito `a => a.isAdmin`, validación de `scope`/`username`/`campaign`, reenvío a v4 `POST /admin/realtime/refresh` con el token del usuario, log `realtime_force`); verificar con vitest: admin → 202 reenviado; sin `isAdmin` → 403 sin llamar a v4; cuerpo inválido → 400
- [x] 3.2 Agregar a `AgentsView` el botón "Forzar actualización" (solo `isAdmin`) y su diálogo (usuario / campaña / todos, confirmación, `Toast` de resultado) con los componentes de `docs/design-system.md`; verificar con pruebas de componente los escenarios de "Forzar actualización desde la consola" y `npm run check:design`

## 4. Despliegue

- [ ] 4.1 Configurar en Amplify `NEXT_PUBLIC_REALTIME_URL` (dev y prod, URL execute-api) y `NEXT_PUBLIC_REALTIME_ENABLED=true`; desplegar el entorno de pruebas contra el gateway de dev y verificar de punta a punta: repartir desde Contactos actualiza "Mi asignación" de otro usuario en < 3 s, el detalle de carga avanza mientras un desktop de dev envía y "Forzar actualización" a un usuario cierra solo sus conexiones
- [ ] 4.2 Desplegar a prod tras `add-realtime-gateway` en prod; verificar `ActiveConnections{client=admin}` ≥ 1, el indicador "En vivo" en `https://ana-admin.pernexium.com.mx` y que con `realtimeEnabled=false` en el servidor el indicador cambia a "Sin actualizaciones en vivo" sin errores en la consola

## Workflow follow-up

- Rollout: después de `add-realtime-gateway` en prod; rollback inmediato con `realtimeEnabled=false` o redeploy con `NEXT_PUBLIC_REALTIME_ENABLED=false`.
- Archivar después de `add-realtime-gateway` y de los cambios que crean las secciones afectadas (`add-admin-web-foundation`, `add-contact-upload-console`, `link-review-contacts-to-uploads`, `v4-review-interrupted-sends`, `add-agent-roster-management`, `add-agent-workspace`, `add-cli-remote-settings`, `v4-add-desktop-remote-settings`).
