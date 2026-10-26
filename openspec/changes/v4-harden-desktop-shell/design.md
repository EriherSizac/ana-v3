# Design

## Context

- `main.ts` crea la ventana con `contextIsolation: true` y preload; no fija `sandbox` (en Electron 38 el renderer con preload corre en sandbox por defecto salvo `nodeIntegration`, pero no está explícito) ni maneja `will-navigate`/`setWindowOpenHandler`.
- Los `ipcMain.handle` reciben argumentos sin validar (`wa:send-reply(jid, body)`, `wa:send-media(jid, {dataBase64,...})`, `auth:set-token(token)`, `jobs:approve(ids, template)`).
- `index.html` carga Google Fonts y no tiene CSP. Las URLs que usa el renderer: API (`VITE_API_BASE`), Cognito (`cognito-idp.us-east-2.amazonaws.com`), S3 prefirmado (CSV y media, `*.s3.us-east-2.amazonaws.com` o `s3.us-east-2.amazonaws.com`), imágenes `data:` del QR.
- `client.ts` lanza Puppeteer con `--no-sandbox --disable-setuid-sandbox --disable-dev-shm-usage --disable-gpu`; en Windows el sandbox de Chromium no requiere privilegios especiales.
- El filtro de teclas usa `input.control || input.meta` sin mirar `input.alt`.

## Goals / Non-Goals

**Goals:** que un compromiso del renderer no se traduzca en envíos de WhatsApp arbitrarios sin validación; superficie de red del renderer acotada; teclado usable en layouts latinoamericanos.

**Non-Goals:** aislar el renderer del token (el renderer ya maneja Amplify); autenticar cada IPC con secreto (el emisor válido ya es el único frame).

## Decisions

- **D1. Guard IPC.** `guard(channel, handler, schema)` envuelve cada `ipcMain.handle`: verifica `event.senderFrame` = frame principal de `mainWindow.webContents` y su URL (`file://…/dist/index.html` empaquetado o el origen de `VITE_DEV_SERVER_URL` en dev); valida argumentos con funciones puras (sin dependencia nueva). Inválido → `{ok:false, error:"solicitud inválida"}` y log sin datos personales.
- **D2. Límites.** JID `^\d{8,15}@c\.us$` (solo contactos individuales); texto 1–4096; media: base64 decodificado ≤ 16 MB, `mimetype` en `image/*`, `audio/*`, `video/*`, `application/pdf`, filename `[^\w.\- ]` → `_` y ≤ 120; `jobIds` ≤ 5000 strings ≤ 200; plantillas ≤ 4096; token `null` o tres segmentos base64url; campaña ≤ 100.
- **D3. Navegación.** `will-navigate` y `will-redirect`: se permite solo el mismo origen de la app; `setWindowOpenHandler`: `deny` siempre y, si la URL es `https:`, `shell.openExternal`.
- **D4. CSP** por `<meta http-equiv>` en `index.html` (funciona con `file://`): `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://*.amazonaws.com; font-src 'self'; connect-src 'self' <API> https://cognito-idp.us-east-2.amazonaws.com https://*.amazonaws.com; object-src 'none'; base-uri 'none'; frame-ancestors 'none'`. `<API>` se inyecta en build desde `VITE_API_BASE` con un plugin de Vite. `'unsafe-inline'` en estilos por los estilos que inyecta Vite/Tailwind en desarrollo; se intenta quitar en build si las pruebas lo permiten. En dev se agrega el origen del servidor de Vite y `ws:`.
- **D5. Sandbox de Chromium de WhatsApp.** Se quitan `--no-sandbox` y `--disable-setuid-sandbox`; se conservan `--disable-dev-shm-usage` y `--disable-gpu`. Si en la PC piloto el navegador no arranca, el release se detiene y se investiga (no se agrega un interruptor para desactivarlo en producción).
- **D6. Teclas.** Se descarta solo si `!input.alt` (F12 siempre). AltGr en Windows llega como `control && alt`, por lo que deja de coincidir.

## Risks / Trade-offs

- [CSP rompe alguna llamada no inventariada (p. ej. otra región de S3)] → Inventario con la pestaña de red en dev; violaciones visibles en consola; prueba completa del flujo (login, QR, chats, media, carga de CSV) antes del release.
- [Sandbox de Chromium falla en algunos equipos (políticas de antivirus)] → Piloto en equipos reales de agentes; ver D5.
- [Fuentes locales aumentan el instalador] → Unos cientos de KB.

## Migration Plan

Release del desktop por el feed; rollback publicando la versión anterior con número mayor.
