# Tasks

## 1. Guard IPC

- [x] 1.1 Agregar `vitest` a `v4/desktop` si ningún cambio previo lo hizo; verificar con `npm test`
- [x] 1.2 Crear `electron/ipc/guard.ts` con validadores puros (emisor, JID, texto, media, filename, listas, token, campaña) según design D2; verificar con vitest de casos válidos e inválidos de cada validador (incluye `123@g.us`, `abc`, 40 MB, `text/html`)
- [x] 1.3 Envolver todos los `ipcMain.handle` de `main.ts` con el guard (incluidos los canales que agreguen otros cambios v4 ya aplicados); verificar con vitest de `guard()` usando un `event` falso (frame ajeno → rechazo sin llamar al handler) y con una búsqueda `git grep -n "ipcMain.handle(" -- v4/desktop/electron` donde cada ocurrencia pasa por el guard

## 2. Ventana, navegación y teclado

- [ ] 2.1 Fijar `sandbox: true` y `nodeIntegration: false` en `webPreferences`, agregar `will-navigate`/`will-redirect` y `setWindowOpenHandler` (design D3); verificar manualmente en dev que un enlace `https` de un mensaje abre el navegador del sistema y que `window.require` es `undefined` en la consola de dev
- [x] 2.2 Extraer la decisión del filtro de teclas a una función pura que ignora combinaciones con Alt (salvo F12) y usarla en `before-input-event`; verificar con vitest (Ctrl+Shift+I bloqueado; Ctrl+Alt+Q (`@`) permitido; Ctrl+Alt+Shift+I permitido; F12 bloqueado)

## 3. CSP y fuentes

- [x] 3.1 Empaquetar Inter y Jost (por ejemplo `@fontsource/inter`, `@fontsource/jost`) e importarlas en `src/index.css`; quitar los `<link>` de Google Fonts de `src/index.html`; verificar con `npm run build` que `dist/` contiene los archivos de fuente y que el HTML no referencia `googleapis`
- [ ] 3.2 Agregar la CSP de design D4 con un plugin de Vite que inyecta el origen de `VITE_API_BASE` (y el del servidor de dev en desarrollo); verificar en un build empaquetado el flujo completo (login con MFA, QR, chats con imagen, carga de CSV a S3, actualización) sin violaciones de CSP en la consola

## 4. WhatsApp

- [ ] 4.1 Quitar `--no-sandbox` y `--disable-setuid-sandbox` en `electron/whatsapp/client.ts`; verificar en dev (Windows) que WhatsApp conecta y, con el administrador de tareas o `wmic process where "name='chrome.exe'" get commandline`, que los procesos no llevan esos argumentos

## 5. Documentación

- [x] 5.1 Documentar en `v4/ARCHITECTURE.md` (sección de seguridad del desktop) el guard IPC, la CSP, la política de navegación y el sandbox; verificar que la lista de canales documentados coincide con `preload.ts`

## 6. Release del desktop

- [ ] 6.1 Generar el instalador con `npm run dist` e instalarlo en al menos dos PCs reales de agentes (con su antivirus habitual); verificar que WhatsApp conecta con sandbox, que AltGr escribe `@` en el campo de respuesta y que los envíos de campaña funcionan
- [ ] 6.2 Publicar: subir `version`, `npm run publish`, verificar `latest.yml` en `s3://ana-desktop-updates/updates/` y monitorear durante un día que no hay reportes de WhatsApp sin conectar

## Workflow follow-up

- Tras archivar, quitar de la nota de Purpose de `openspec/specs/v4/desktop-shell/spec.md` las menciones a IPC sin validar, falta de CSP, Google Fonts y ventanas sin manejador, y de `whatsapp-session` la de `--no-sandbox`.
