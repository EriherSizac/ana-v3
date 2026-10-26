# Proposal

## Why

La ventana manual inserta como HTML sin escapar el texto de los mensajes respaldados y la vista previa del "📜 Ver Historial" (`whatsapp-manual.js:3240`, `whatsapp-manual.js:2892`). Ese texto lo escribe el deudor en WhatsApp (o cualquiera que llame a `POST /backups/chat`, ruta pública sin autenticación), así que un mensaje como `<img src=x onerror=...>` se ejecuta en una página que expone funciones de Node (`submitGestionInteraction`, `saveChatBackupToBackend`, `submitNoWhatsappInfoInteraction`, `getGestionDataFromBackend`): XSS almacenado capaz de registrar gestiones falsas en el CRM, sobrescribir respaldos o leer datos del cliente.

## What Changes

- El Historial (lista y burbuja de conversación) SHALL renderizar como texto plano todo dato que venga del backend o de WhatsApp: cuerpo del mensaje, vista previa, nombre del contacto, teléfono, marca de tiempo, tipo, fecha de actualización y total de mensajes.
- El modal "⬆️ Subir gestión" SHALL renderizar como texto plano los datos del CRM (nombre del cliente, `credit_id`, producto, dictamen/subdictamen del catálogo) y los mensajes de error.
- El overlay "Respaldando Chats" y las notificaciones del respaldo automático SHALL renderizar como texto el título del chat y los mensajes de estado/error.
- Los teléfonos usados para construir la URL `https://web.whatsapp.com/send?phone=52…` SHALL reducirse a dígitos antes de navegar.
- Se agrega un módulo pequeño de utilidades puras (`escapeHtml`, `digitsOnly`) con pruebas `node:test`, inyectado en la página; los overlays de login muertos de manual y monitor también se escapan por higiene.
- Se documenta en `design.md` la auditoría de todos los `innerHTML` de las ventanas manual, monitor y del módulo de respaldo.
- Release del CLI vía autoupdate (bump de versión, build y subida a S3).

Sin cambios de contrato con el backend ni con el CRM; no es **BREAKING**.

## Capabilities

### New Capabilities

_(ninguna)_

### Modified Capabilities

- `v3/manual-gestion`: "Lista de historial de chats respaldados" y "Ver conversación respaldada" pasan a exigir renderizado como texto plano; se agrega un requisito de renderizado seguro de datos externos en el modal de gestión y en la navegación "Abrir chat".
- `v3/chat-backup-sync`: se agrega un requisito de renderizado como texto del overlay "Respaldando Chats" y de las notificaciones del respaldo automático.

## Impact

- Código: `v3/cli-whatsapp/whatsapp-manual.js` (Historial, gestión, notificaciones de respaldo, overlay de login muerto), `v3/cli-whatsapp/chat-backup.js` (`updateBackupProgress`), `v3/cli-whatsapp/whatsapp-monitor.js` (overlay de login muerto), nuevo `v3/cli-whatsapp/dom-safety.js` + `v3/cli-whatsapp/test/dom-safety.test.js`, `package.json` (script `test`).
- Sin cambios en `v3/ana-backend` ni en la API de interacciones.
- Distribución: requiere publicar una versión nueva del CLI (`npm run build` → `latest.json` en S3) para que la flota instalada reciba el arreglo por autoupdate.
- Fuera de alcance: autenticar `POST /backups/chat` (debe tratarse en el plan de seguridad del backend).
