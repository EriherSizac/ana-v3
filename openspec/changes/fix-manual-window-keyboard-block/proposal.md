# Proposal

## Why

La ventana manual cancela toda combinación con Ctrl, Cmd o Alt salvo Ctrl+V (`whatsapp-manual.js:540–556`). En Windows la tecla AltGr llega al navegador como Ctrl+Alt, así que en teclados latinoamericanos y españoles el agente no puede escribir `@`, `#`, `\`, `~`, `€`, `[`, `]`, `{`, `}` ni `|` al responder (correos, referencias de pago, montos), y tampoco puede copiar, cortar, deshacer o seleccionar todo dentro de su propio mensaje.

## What Changes

- Se reemplaza el bloqueo total por una política de teclado explícita, en un único listener instalado antes de que cargue WhatsApp:
  - **Siempre bloqueado**: F1–F12 salvo F5; Ctrl/Cmd+Shift+I/J/C y Cmd+Alt+I/J/C (DevTools); Ctrl/Cmd+U (código fuente); Ctrl/Cmd+S, Ctrl/Cmd+P, Ctrl/Cmd+O; Alt+Flecha izquierda/derecha (navegación atrás/adelante).
  - **Permitido – escritura con AltGr**: combinaciones Ctrl+Alt (o con estado `AltGraph`) que producen un carácter imprimible distinto de la letra/dígito de la tecla, y teclas muertas con AltGr; el carácter se escribe pero el evento no llega a los atajos de WhatsApp.
  - **Permitido – edición dentro de campos editables** (cuadro de mensaje, búsqueda, inputs propios): Ctrl/Cmd+V, Shift+V, C, X, A, Z, Y, Shift+Z, Ctrl+flechas/Inicio/Fin y Ctrl+Retroceso/Supr.
  - **Permitido – códigos Alt** del teclado numérico (Alt+64 = `@`) y las pulsaciones de teclas modificadoras solas.
  - **Bloqueado por defecto**: cualquier otra combinación con Ctrl/Cmd/Alt (incluye los atajos de WhatsApp Web como nuevo chat, archivar o eliminar chat), conservando la intención de "solo responder".
- Se eliminan los listeners de teclado duplicados que se reinstalan tras la carga y en cada `load` (`whatsapp-manual.js:690`, `:765`).
- La política vive en un módulo puro con pruebas `node:test`.
- Release del CLI vía autoupdate.

## Capabilities

### New Capabilities

_(ninguna)_

### Modified Capabilities

- `v3/manual-chat-window`: "Bloqueo de teclado y menú contextual" pasa de bloqueo total a denegación por defecto con denylist explícita y excepciones; se agregan requisitos para escritura con AltGr, atajos de edición en campos editables y códigos Alt.

## Impact

- Código: `v3/cli-whatsapp/whatsapp-manual.js` (init script de protecciones y bloques post-carga), nuevo `v3/cli-whatsapp/manual-key-policy.js` + `v3/cli-whatsapp/test/manual-key-policy.test.js`, `package.json` (script `test` si no existe).
- Sin cambios en ventanas de automatización ni monitor (solo bloquean DevTools; no tienen el problema).
- Sin cambios de backend ni CRM.
- Distribución: release del CLI por autoupdate.
