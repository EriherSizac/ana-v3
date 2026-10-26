# Proposal

## Why

Todas las interacciones que el CLI v3 registra en el CRM calculan `contact_date` con `new Date().toISOString().slice(0, 10)` (fecha UTC) mientras `contact_time` y `range_time` usan la hora local del equipo (`getHours()`): `index.js:492`, `whatsapp-manual.js:327` (modal sin WhatsApp), `whatsapp-manual.js:2287` (Gestión) y `whatsapp-monitor.js:534`. En Ciudad de México (UTC-6, sin horario de verano desde 2022), toda gestión entre las 18:00 y las 23:59 queda registrada con la fecha del día siguiente, lo que desplaza en los reportes del CRM los envíos y respuestas de la tarde-noche, justo el turno de mayor actividad de cobranza. Además, si el reloj o la zona del equipo del agente están mal configurados, la hora tampoco es confiable.

## What Changes

- Un único cálculo de fecha/hora para las interacciones, que produce `contact_date` (`YYYY-MM-DD`), `contact_time` (`HH:MM`) y `range_time` (`HH:00 - HH+1:00`) **en la zona `America/Mexico_City`**, independientemente de la zona configurada en el equipo.
- Lo usan los cuatro lugares que hoy construyen interacciones: envío automático, Gestión manual, monitor de no leídos y modal de números sin WhatsApp.
- Pruebas unitarias `node:test` con instantes fijos (incluida la franja 18:00–23:59 y medianoche) y con distintas zonas del proceso.
- Release del CLI.

Fuera de alcance: corregir interacciones ya registradas con fecha errónea (se documenta el criterio para identificarlas), `sent_at` de `resultados.csv` (sigue en ISO UTC, que es inequívoco), la app web y el backend.

## Capabilities

### New Capabilities

_Ninguna._

### Modified Capabilities

- `v3/crm-interactions`: "Campos de la interacción automática" usa fecha y hora de Ciudad de México; se agrega un requisito transversal de fecha/hora para toda interacción que registra el CLI.
- `v3/manual-gestion`: "Envío de la gestión" usa la misma fecha/hora de Ciudad de México.
- `v3/unread-monitor`: "Registro automático de interacción por respuesta" usa la misma fecha/hora de Ciudad de México.

## Impact

- Código: `v3/cli-whatsapp/index.js`, `whatsapp-manual.js` (dos funciones expuestas), `whatsapp-monitor.js`; nuevo módulo `interaction-time.js` y pruebas; `build-portable.ps1`.
- Datos: las interacciones nuevas registradas entre 18:00 y 23:59 hora de México pasan a tener la fecha correcta (cambio visible en reportes del CRM a partir del release).
- Flota: release del CLI; payload al CRM sin cambios de forma.
- Coordinación: el cambio en curso `fix-no-whatsapp-modal-duplicates` reescribe el registro del modal sin WhatsApp; ambos deben usar el mismo helper.
