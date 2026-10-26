# Tasks

## 1. Backend

- [ ] 1.1 Agregar `vitest` y `aws-sdk-client-mock` a `v4/backend` si ningún cambio previo lo hizo; verificar con `npm test`
- [ ] 1.2 Crear `src/lib/desktopSettings.ts` (catálogo, validación, merge efectivo) según design D2; verificar con vitest: sin configuración → defaults; valor guardado fuera de límites → default; llave desconocida → error; límites exactos (60 y 600 válidos, 59 inválido)
- [ ] 1.3 Agregar `isDeveloper` a `resolveUserAccess` (`access.ts`) y a `GET /me`; verificar con vitest (`"Developer"`, `"developer backend"`, `"Desarrollador"` → solo los dos primeros; no agrega permisos `ana:*`)
- [ ] 1.4 Crear `src/handlers/settings.ts` con `GET /admin/desktop-settings`, `PUT /admin/desktop-settings` (versión condicional, auditoría por llave) y `GET /settings`, y registrarlas en `serverless.yml` con `cognitoJwt`; verificar con vitest + aws-sdk-client-mock de cada escenario de `specs/v4/desktop-remote-settings/spec.md` (403 sin Developer, 409 por versión, 400 por límites)

## 2. Desktop

- [ ] 2.1 Agregar `vitest` a `v4/desktop` si ningún cambio previo lo hizo; crear `electron/settings/remoteSettings.ts` (lectura tras token y cada 5 min, último valor, defaults); verificar con vitest con timers y `fetch` falsos (falla inicial → defaults; falla posterior → conserva último)
- [ ] 2.2 Parametrizar el ritmo en `JobPoller` leyendo la configuración en cada cálculo de espera; verificar con vitest (gap 180 s → no envía antes; máximo 5 por ventana → el sexto espera)
- [ ] 2.3 Exponer `getSettings()`/`onSettings()` en `preload.ts` (con el guard IPC si `v4-harden-desktop-shell` ya está aplicado) y condicionar `POST /interactions/open` en `Chats.tsx` a `openChatInteraction`; verificar con `npm run build` y manualmente en dev cambiando el valor en dev (sin llamada a `/interactions/open` con `false`)

## 3. ANA Admin

- [ ] 3.1 Agregar rutas BFF `/api/v4/desktop-settings` (GET/PUT, solo `isDeveloper`, token del usuario hacia v4); verificar con pruebas vitest del BFF (no Developer → 403 sin llamar a v4)
- [ ] 3.2 Agregar la sección "Desktop v4" a `/configuracion` con controles por tipo, límites, `ConfirmDialog` y manejo de 409; verificar con pruebas de componente de cada escenario de `specs/admin-web/cli-settings/spec.md` de este cambio y con el lint del sistema de diseño

## 4. Documentación

- [ ] 4.1 Documentar en `v4/ARCHITECTURE.md` el catálogo, las rutas, la propagación (≤ 5 min) y quién puede editar; verificar que los límites documentados coinciden con las pruebas 1.2

## 5. Despliegue y release

- [ ] 5.1 Desplegar el backend en dev y prod (`npx serverless deploy --stage dev|prod`); verificar con `curl` que `GET /settings` devuelve los defaults y que un usuario sin Developer recibe 403 en `PUT /admin/desktop-settings`
- [ ] 5.2 Release del desktop: subir `version`, `npm run publish`, verificar `latest.yml` en `s3://ana-desktop-updates/updates/` y en la PC piloto que el ritmo por defecto no cambió
- [ ] 5.3 Desplegar ANA Admin y, en prod, verificar con un Developer que la sección carga; probar un cambio reversible (`sendMinGapSeconds` 120 → 150 → 120) y confirmar en la PC piloto la cuenta regresiva correspondiente

## Workflow follow-up

- Archivar después de `add-cli-remote-settings` (este cambio agrega requisitos a `admin-web/cli-settings`, que ese cambio crea).
