# Design

## Context

- Contrato del canal: `add-realtime-gateway` (spec `v4/realtime-gateway`; D2 subprotocolo, D3 origen, D9 backoff). Las conexiones `admin` se suscriben a las campañas de su acceso v4; los eventos solo traen ids.
- ANA Admin: Next.js 15 en Amplify Hosting (SSR sobre Lambda), BFF en `src/app/api/*` que verifica el ID token (`aws-jwt-verify`). En el navegador Amplify guarda los tokens en `CookieStorage` del apex y `currentIdToken(forceRefresh)` (`src/lib/auth-client.ts`) los entrega; `api-client.ts` ya los manda al BFF como `Bearer`.
- Sin librería de datos (no hay SWR/React Query): cada vista carga con su propio `useEffect`/`load()`. Sin CSP en `next.config.ts` hoy (si se agrega, `connect-src` debe incluir el `wss://` del gateway).

## Goals / Non-Goals

**Goals:** ver cambios de otros (o de los clientes de envío) en segundos; no pisar el trabajo del usuario; cero carga extra en el BFF.

**Non-Goals:** colaboración en tiempo real (edición simultánea); notificaciones del sistema operativo.

## Decisions

- **D1. Navegador directo al gateway, no vía BFF.** El BFF corre en Lambda (Amplify SSR) y no puede mantener sockets; proxyar requeriría otro servicio con estado. El navegador ya tiene el ID token (Amplify) y el gateway ya valida token y origen, así que la conexión directa no amplía la superficie: el socket solo entrega avisos y toda lectura sigue por el BFF con su autorización. Alternativa: BFF emite un ticket de un solo uso: agrega estado sin beneficio, porque el token ya está expuesto a ese mismo JS.
- **D2. Un `RealtimeProvider` por pestaña** en `src/app/(console)/layout.tsx` (dentro de `ConsoleGate`), con un cliente de dependencias inyectadas (`WebSocket`, `currentIdToken`, temporizadores, `document.visibilityState`) igual al de desktop/CLI en comportamiento. Expone estado (`active|inactive|disabled`) y `subscribe(types, filter, handler)`. Una conexión por pestaña: con varias pestañas hay varias conexiones, aceptable para el volumen de usuarios de la consola.
- **D3. `useRealtimeRefresh({types, campaign, reload, isDirty})`.** Hook que cada vista usa con su `load()` existente: coalescencia 1 s, filtro por campaña (`campaignKey`), y si `isDirty()` es verdadero, en vez de `reload()` activa el aviso "Hay cambios nuevos · Actualizar". Mantiene las vistas sin lógica de socket y hace que cada sección declare qué la ensucia (`MyAssignmentView`: archivos cargados o selección; Configuración: diálogo abierto o valor editado; Contactos: carga en curso del wizard).
- **D4. Detección de token nuevo.** Cada 60 s (y antes de cada reconexión) el provider pide `currentIdToken()`; si cambió respecto al usado al conectar (Amplify renueva al acercarse `exp`), hace make-before-break. Así no depende de eventos internos de Amplify.
- **D5. Pestaña oculta.** Cerrar tras 10 min oculta evita sockets ociosos de pestañas olvidadas (cada una cuesta minutos de conexión y pings); al volver, reconexión + una recarga.
- **D6. Sin polling de respaldo.** Hoy la consola no hace polling; con el canal inactivo se agrega solo la recarga al recuperar el foco (máx. una por minuto), que cubre el caso común de "vuelvo a la pestaña" sin sumar tráfico constante.

## Risks / Trade-offs

- [Recargas frecuentes del detalle de carga mientras el desktop envía] → el gateway limita `uploads.changed` a uno por carga cada 10 s y la vista coalesce 1 s.
- [Evento de campaña que el usuario ya no puede ver] → la recarga por BFF responde 403 como hoy; la vista muestra su error habitual.
- [Varias pestañas = varias conexiones] → se acepta; `ActiveConnections{client=admin}` lo hace visible.

## Migration Plan

1. Desplegar en el entorno de pruebas de Amplify contra el gateway de dev (`NEXT_PUBLIC_REALTIME_URL` de dev; origen `http://localhost:3000` permitido en dev).
2. Desplegar en prod con `NEXT_PUBLIC_REALTIME_ENABLED=true` una vez que `add-realtime-gateway` esté en prod con el origen de ANA Admin permitido.
3. Rollback: `realtimeEnabled=false` en el servidor (inmediato) o redeploy con `NEXT_PUBLIC_REALTIME_ENABLED=false`.
