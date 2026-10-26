# Proposal

## Why

El envío automático abre `https://web.whatsapp.com/send?phone=<dígitos crudos>` (`whatsapp.js:1268`): cuando el CSV trae el teléfono a 10 dígitos (formato nacional MX), WhatsApp Web recibe `5512345678` sin código de país, lo interpreta como un número de otro país y el contacto termina como `no_whatsapp` o en un chat equivocado. Además, cada función del CLI normaliza el teléfono con su propia copia del código (seis implementaciones entre `agent-config.js`, `whatsapp-manual.js` y `whatsapp-monitor.js`), con reglas que difieren en casos límite y un comentario engañoso (`whatsapp-manual.js:1927` dice "521 -> 52" y hace lo contrario), lo que hace fácil romper un formato al tocar otro.

## What Changes

- El chat del flujo automático se abre siempre con un teléfono MX canónico `52` + 10 dígitos cuando el número es mexicano (10 dígitos, `52`+10, `521`+10, con `+`, espacios, guiones o paréntesis). Los números no mexicanos se usan con sus dígitos, como hoy.
- Un único módulo de normalización con una salida explícita por consumidor:
  - URL de WhatsApp: `52` + 10 dígitos.
  - Búsqueda en el CRM (`/client-info`): `+52` + 10 dígitos (sin cambio de comportamiento para el flujo automático y el monitor).
  - Teléfono de la interacción: el formato que hoy envía cada flujo (10 dígitos en automático/monitor/modal sin WhatsApp; `+52` + 10 en Gestión) — sin cambio.
  - Llave de respaldo de chats: `521` + 10 dígitos, **sin cambio**, para no dejar huérfanos los respaldos existentes en `backups/{campaign}/{agent}/{contact_phone}/`.
- La normalización de Gestión pasa a usar las mismas longitudes exactas que el resto (`521` solo con 13 dígitos).
- El código inyectado en el navegador (respaldo, historial) usa la misma fuente que Node, inyectada en la página, en lugar de copias.
- Pruebas unitarias `node:test` de todos los formatos.
- Release del CLI.

Fuera de alcance: cambiar el formato de `phone_number` de las interacciones o de las llaves de respaldo; números con prefijos antiguos `044`/`045`; la app web.

## Capabilities

### New Capabilities

_Ninguna._

### Modified Capabilities

- `v3/automated-sending`: "Apertura del chat del contacto" agrega el código de país `52` a números MX.
- `v3/manual-gestion`: "Normalización de teléfono para el CRM" usa longitudes exactas compartidas con el resto del CLI.
- `v3/chat-backup-sync`: "Sincronización con el backend" fija como contrato estable el formato `521` + 10 de la llave del respaldo y corrige la nota del comentario engañoso.

## Impact

- Código: `v3/cli-whatsapp/whatsapp.js` (`sendMessage`), `agent-config.js` (`normalizePhoneForBackend`), `whatsapp-manual.js` (respaldo automático, historial, Gestión, modal sin WhatsApp), `whatsapp-monitor.js`, `index.js` (cálculo de `phone10`); nuevo módulo `phone-utils.js` y pruebas; `build-portable.ps1`.
- Datos: sin migración; las llaves de respaldo y los payloads al CRM conservan su formato.
- Flota: requiere release del CLI; sin cambio de contrato con backend ni CRM.
