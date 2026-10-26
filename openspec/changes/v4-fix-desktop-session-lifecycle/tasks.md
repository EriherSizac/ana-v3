# Tasks

## 1. Preparación de pruebas

- [ ] 1.1 Agregar `vitest` como devDependency de `v4/desktop` con script `test` y config de entorno `node` limitada a `electron/**/*.test.ts` y `src/lib/**/*.test.ts` (solo si ningún cambio previo lo hizo); verificar con `npm test` en verde

## 2. Renovación del token

- [ ] 2.1 Crear `electron/auth/tokenBroker.ts` (puro: lectura de `exp`, umbral de 2 min, una solicitud en vuelo, timeout 10 s, `invalidate()`); verificar con vitest: token vigente sin solicitud, token por vencer pide uno, solicitudes concurrentes comparten la misma promesa, timeout devuelve el token anterior
- [ ] 2.2 Exponer en `preload.ts` `onTokenRequest(cb)` y `provideToken(token)`, cablear `auth:token-request`/`auth:provide-token` en `main.ts` y hacer que `auth:set-token` con el mismo operador solo reemplace el token; verificar con vitest de la función de decisión (mismo operador → no reinicia; otro → flujo de cambio de usuario) y actualizando `src/types/ana.d.ts` (`npm run build` sin errores de tipos)
- [ ] 2.3 Usar `getFreshToken()` y reintento único ante 401 en `backend.ts`, `jobs/poller.ts` y `whatsapp/s3Store.ts`; verificar con vitest de un `fetchWithAuth` puro (401 → invalidate + 1 reintento; segundo 401 → error)
- [ ] 2.4 En `src/lib/auth.ts`, programar la renovación (`fetchAuthSession({ forceRefresh: true })`) 5 min antes de `exp`, responder `onTokenRequest` y, si falla, llamar `setAuthToken(null, { reason: 'expired' })` y mostrar el login con "Tu sesión expiró. Vuelve a iniciar sesión."; verificar con vitest del cálculo del momento de renovación y manualmente en dev con un usuario de prueba cuyo ID token dura 5 min (configuración del app client de dev) que la app sigue operando tras 15 min
- [ ] 2.5 En el main, `reason: 'expired'` detiene poller y heartbeat sin `wa.logoutLocal()`; verificar manualmente en dev revocando la sesión (`aws cognito-idp admin-user-global-sign-out`) que aparece el aviso y que al volver a entrar el mismo usuario no pide QR

## 3. Poller y heartbeat

- [ ] 3.1 Cambiar `JobPoller.fetchJobs` para que 401/no-2xx/red no publiquen `[]` (conserva `lastAssignment`) y 401 invalide el token; verificar con vitest de `JobPoller` con `fetch` falso (401 y 500 no emiten `onAssignment([])`)
- [ ] 3.2 Condicionar el heartbeat a `wa.getState().status === 'connected'` en `agent:register`, intervalo y transición; verificar con vitest de la función `shouldHeartbeat(state, campaign)` y en dev que con QR visible no sale `POST /agents/heartbeat` (pestaña de red del backend o logs)

## 4. Updater

- [ ] 4.1 Hacer `setupUpdater` idempotente (flag de módulo, último estado re-emitido); verificar con vitest usando un `autoUpdater` falso que tres llamadas registran un solo listener por evento y un solo intervalo
- [ ] 4.2 Quitar "Continuar sin actualizar" de `UpdateGate.tsx` en build instalado, agregar "Reintentar" y reintento automático cada 60 s (`update:retry` IPC); verificar con `npm run build` y manualmente con un build instalado sin red (pantalla sin bypass, reintenta sola al volver la red)
- [ ] 4.3 Agregar `pauseNewJobs()` y `waitIdle(ms)` a `JobPoller` y usarlos en `update-downloaded` (overlay "Terminando el envío en curso…"); verificar con vitest de `JobPoller` (con un job en curso, `waitIdle` resuelve al terminar; sin job, resuelve de inmediato; tras `pauseNewJobs` no arranca otro job)

## 5. Documentación

- [ ] 5.1 Actualizar `v4/ARCHITECTURE.md` (renovación del token, heartbeat, actualización sin bypass) y `v4/README.md` si menciona "Continuar sin actualizar"; verificar con `git grep -n "Continuar sin actualizar" -- v4` solo en código de dev/tests

## 6. Release del desktop

- [ ] 6.1 Subir `version` en `v4/desktop/package.json` (minor) y generar el instalador con `npm run dist`; verificar instalando el `.exe` de `release/` en una PC de prueba con una versión anterior instalada
- [ ] 6.2 Publicar con `npm run publish` (perfil AWS con `s3:PutObject` en `ana-desktop-updates`); verificar con `aws s3 cp s3://ana-desktop-updates/updates/latest.yml -` que trae la versión nueva
- [ ] 6.3 Piloto: en una PC de agente con la versión anterior, confirmar que en ≤ 30 min se actualiza sola, que tras 2 h de uso "Mi asignación" sigue cargando y que el agente con QR pendiente aparece inactivo en `GET /agents`; registrar evidencia en el PR

## Workflow follow-up

- Tras archivar, quitar de la nota de Purpose de `openspec/specs/v4/desktop-auth/spec.md` y `openspec/specs/v4/desktop-update/spec.md` las menciones al token no renovado, al bypass y a los listeners duplicados, y la nota del token vencido en "Consulta periódica de jobs" ya no aplica.
