# Design

## Context

- Contrato del canal: `add-realtime-gateway` (spec `v4/realtime-gateway`; D2 subprotocolo y URL execute-api, D3 origen, D9 backoff, D12 actualización forzada). Las conexiones `admin` se suscriben a las campañas de su acceso v4; los eventos solo traen ids.
- ANA Admin: Next.js 15 en Amplify Hosting (SSR sobre Lambda), BFF en `src/app/api/*` que verifica el ID token (`aws-jwt-verify`) y resuelve el acceso con v4 `/me` (`withAccess`). En el navegador Amplify guarda los tokens en `CookieStorage` del apex y `currentIdToken(forceRefresh)` (`src/lib/auth-client.ts`) los entrega; `api-client.ts` ya los manda al BFF como `Bearer`. `ConsoleGate` lee `GET /api/me` al montar y publica el acceso en `AccessContext`.
- Sin librería de datos (no hay SWR/React Query): cada vista carga con su propio `useEffect`/`load()`. Sin CSP en `next.config.ts` hoy (si se agrega, `connect-src` debe incluir el `wss://` del gateway).
- Diseño visual: `docs/design-system.md` (componentes de `src/components/ui`, tokens; `npm run check:design`).

## Goals / Non-Goals

**Goals:** ver cambios de otros (o de los clientes de envío) en segundos; no pisar el trabajo del usuario; aplicar cambios de acceso forzados sin recargar la página; que un admin pueda forzar la actualización de un usuario, una campaña o todos; cero carga extra en el BFF fuera de la ruta de forzado.

**Non-Goals:** colaboración en tiempo real (edición simultánea); notificaciones del sistema operativo.

## Decisions

- **D1. Navegador directo al gateway, no vía BFF.** El BFF corre en Lambda (Amplify SSR) y no puede mantener sockets; proxyar requeriría otro servicio con estado. El navegador ya tiene el ID token (Amplify) y el gateway ya valida token y origen, así que la conexión directa no amplía la superficie: el socket solo entrega avisos y toda lectura sigue por el BFF con su autorización. Alternativa: BFF emite un ticket de un solo uso: agrega estado sin beneficio, porque el token ya está expuesto a ese mismo JS.
- **D2. Un `RealtimeProvider` por pestaña** en `src/app/(console)/layout.tsx` (dentro de `ConsoleGate`), con un cliente de dependencias inyectadas (`WebSocket`, `currentIdToken`, temporizadores, `document.visibilityState`, aleatorio) igual al de desktop/CLI en comportamiento. Expone estado (`active|inactive|disabled`) y `subscribe(types, handler)`. Una conexión por pestaña: con varias pestañas hay varias conexiones, aceptable para el volumen de usuarios de la consola.
- **D3. `useRealtimeRefresh({types, campaign, reload, isDirty})`.** Hook que cada vista usa con su `load()` existente: coalescencia 1 s, filtro por campaña (`campaignKey`), y si `isDirty()` es verdadero, en vez de `reload()` activa el aviso "Hay cambios nuevos · Actualizar". Mantiene las vistas sin lógica de socket y hace que cada sección declare qué la ensucia (`MyAssignmentView`: archivos cargados o selección; Configuración: diálogo abierto o valor editado; Contactos: carga en curso del wizard).
- **D4. Detección de token nuevo.** Cada 60 s (y antes de cada reconexión) el provider pide `currentIdToken()`; si cambió respecto al usado al conectar (Amplify renueva al acercarse `exp`), hace make-before-break. Así no depende de eventos internos de Amplify.
- **D5. Pestaña oculta.** Cerrar tras 10 min oculta evita sockets ociosos de pestañas olvidadas (cada una cuesta minutos de conexión y pings); al volver, reconexión + una recarga.
- **D6. Sin polling de respaldo.** Hoy la consola no hace polling; con el canal inactivo se agrega solo la recarga al recuperar el foco (máx. una por minuto), que cubre el caso común de "vuelvo a la pestaña" sin sumar tráfico constante.
- **D7. Actualización forzada recibida.** Ante `session.refresh`, el cliente cierra con 4001 y agenda la reconexión con 0–10 s; el provider llama `refreshAccess()` que `ConsoleGate` expone por contexto (vuelve a leer `GET /api/me` sin desmontar la vista; si el acceso ya no permite la sección, se muestra "Sin acceso" como hoy) y emite a los hooks una recarga de la sección visible con la misma protección del trabajo sin guardar. Sin cambios en el BFF: `/api/me` ya consulta v4 `/me`, cuya caché de acceso invalida `PUT /admin/role-permissions/{roleId}`.
- **D8. Botón "Forzar actualización" en Agentes.** Solo visible con `access.isAdmin` (en v4, `isAdmin` = `ana:admin:console:manage` o superadmin). Diálogo (`Dialog` del sistema de diseño) con tres opciones: "Un usuario" (username), "Una campaña" (la campaña seleccionada en la vista por defecto) y "Todos los usuarios", y un paso de confirmación que describe el alcance ("Se cerrarán todas las sesiones de jperez…"). Llama `POST /api/realtime/refresh` (`withAccess` con requisito `a => a.isAdmin`, valida el cuerpo y reenvía a v4 `POST /admin/realtime/refresh` con el token del usuario); muestra `Toast` de éxito o error. Se elige Agentes porque es la sección donde un admin gestiona usuarios y campañas; Configuración es solo de Developer.

## Risks / Trade-offs

- [Recargas frecuentes del detalle de carga mientras el desktop envía] → el gateway limita `uploads.changed` a uno por carga cada 10 s y la vista coalesce 1 s.
- [Evento de campaña que el usuario ya no puede ver] → la recarga por BFF responde 403 como hoy; la vista muestra su error habitual.
- [Varias pestañas = varias conexiones] → se acepta; `ActiveConnections{client=admin}` lo hace visible.
- ["Forzar actualización" a todos en horario de envío] → solo reconexiones y relecturas (sin pérdida de trabajo: el desktop termina su lote, el CLI no interrumpe ciclos); el diálogo pide confirmación explícita.

## Migration Plan

1. Desplegar en el entorno de pruebas de Amplify contra el gateway de dev (`NEXT_PUBLIC_REALTIME_URL` de dev; origen `http://localhost:3000` permitido en dev).
2. Desplegar en prod con `NEXT_PUBLIC_REALTIME_ENABLED=true` y `NEXT_PUBLIC_REALTIME_URL=<RealtimeWsUrl prod>` una vez que `add-realtime-gateway` esté en prod con el origen de ANA Admin permitido.
3. Rollback: `realtimeEnabled=false` en el servidor (inmediato) o redeploy con `NEXT_PUBLIC_REALTIME_ENABLED=false`.
