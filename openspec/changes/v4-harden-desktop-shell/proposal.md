# Proposal

## Why

El desktop v4 envía mensajes de WhatsApp desde el proceso main a pedido del renderer, sin defensas en profundidad: el puente IPC no valida el emisor ni los argumentos (JID, cuerpo, base64 de media), así que cualquier código que llegue a ejecutarse en el renderer (una dependencia comprometida, un enlace que abre contenido externo en una ventana de Electron) puede enviar mensajes arbitrarios, reemplazar el token del main o borrar la sesión. El HTML no declara Content-Security-Policy y carga fuentes de Google por red, los enlaces `target="_blank"` abren ventanas de Electron sin manejador, el renderer no corre en sandbox y el Chromium de whatsapp-web.js se lanza con `--no-sandbox`. Además, el filtro de teclas del build instalado descarta combinaciones con AltGr (Ctrl+Alt) en Windows, el mismo defecto de clase que `fix-manual-window-keyboard-block` corrige en la ventana manual del CLI v3.

## What Changes

- Validación en el main de cada llamada IPC: el emisor debe ser el frame principal de la app (origen del paquete o del servidor de desarrollo) y los argumentos deben cumplir tipos y límites (JID de contacto, texto ≤ 4096 caracteres, media ≤ 16 MB con tipos permitidos, nombre de archivo saneado, listas acotadas, token con forma de JWT o nulo).
- Renderer con `sandbox: true` y `nodeIntegration: false` explícitos; navegación fuera de la app bloqueada; `window.open`/`target="_blank"` denegados y los enlaces `https` abiertos en el navegador del sistema.
- Content-Security-Policy estricta en el renderer y fuentes empaquetadas en la app (sin Google Fonts).
- Chromium de WhatsApp con su sandbox activo (sin `--no-sandbox` ni `--disable-setuid-sandbox`).
- Filtro de teclas del build instalado: los atajos de DevTools y código fuente solo se descartan sin Alt; AltGr escribe normalmente.
- Release del desktop.

Fuera de alcance: mover los tokens de Amplify de `localStorage` a almacenamiento cifrado del sistema (se evalúa aparte; con CSP y sandbox el riesgo de exfiltración baja), firma de código del instalador, XSS (los textos ya se renderizan escapados por React, a diferencia de v3; no hace falta un equivalente de `fix-historial-xss`).

## Capabilities

### New Capabilities

_Ninguna._

### Modified Capabilities

- `v4/desktop-shell`: "Ventana principal" con sandbox; "Endurecimiento en build instalado" respeta AltGr; se agregan navegación y ventanas nuevas, CSP y validación del emisor y argumentos IPC.
- `v4/whatsapp-session`: se agrega el sandbox del navegador de WhatsApp.

## Impact

- Desktop: `electron/main.ts` (webPreferences, navegación, filtro de teclas), nuevo `electron/ipc/guard.ts` (validación pura de emisor y argumentos), `electron/preload.ts` (sin cambios de API), `src/index.html` (CSP), `src/index.css` y `package.json` (fuentes locales, p. ej. `@fontsource/inter` y `@fontsource/jost`), `electron/whatsapp/client.ts` (args de Puppeteer).
- Requiere verificar en Windows que el Chromium empaquetado arranca con sandbox (pruebas en la PC piloto antes del release).
- Pruebas: vitest del guard IPC y del filtro de teclas.
