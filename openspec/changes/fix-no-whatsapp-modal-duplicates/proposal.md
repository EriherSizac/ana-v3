# Proposal

## Why

Cada vez que el agente abre el modal "ℹ️ Números sin WhatsApp", la ventana manual envía a `POST /interactions` una interacción "Consulta No Whatsapp" por cada número listado (hasta 200) (`whatsapp-manual.js:431`): abrirlo tres veces triplica los registros en el CRM. Negocio confirmó que ese subdictamen no se usa, así que hoy esos registros son solo ruido. Además, `resultados.csv` se lee separando por comas, así que una respuesta del deudor con comas o saltos de línea (campo `response`) o un nombre/producto con comas desalinea columnas y puede producir teléfonos o estados falsos que también terminan en el CRM.

## What Changes

- **BREAKING (comportamiento)**: abrir el modal pasa a ser de solo lectura; por defecto la ventana manual ya no envía ninguna interacción "Consulta No Whatsapp".
- El registro queda detrás del ajuste remoto del CLI `noWhatsappConsultRegistration` (definido por el cambio paralelo `add-cli-remote-settings`, capacidad `v3/cli-remote-settings`; por defecto `false`, también cuando no se puede obtener). Solo con el ajuste en `true` el modal muestra un botón explícito "Registrar consulta (N)" que registra la interacción para los números aún no registrados por ese agente, en esa campaña y ese día; tras un registro exitoso, los números quedan marcados en un archivo local del directorio de datos del CLI y no se vuelven a enviar.
- Con el ajuste activo, el payload de la interacción no cambia (mismo subdictamen, campos y endpoint); cambia solo el comentario a `no_whatsapp_info_registered` para distinguir los registros nuevos de los generados al abrir.
- `resultados.csv` se lee con un parser CSV real (comillas, comas y saltos de línea dentro de campos, BOM), usando la dependencia `csv-parser` ya incluida.
- Lógica pura (extracción de teléfonos, cálculo de pendientes, almacén de registrados) en un módulo con pruebas `node:test`.
- Release del CLI vía autoupdate.

## Capabilities

### New Capabilities

_(ninguna)_

### Modified Capabilities

- `v3/manual-chat-window`: el requisito "Botón de números sin WhatsApp" deja de registrar interacciones al abrir y define la lectura CSV correcta; se agregan los requisitos de registro explícito y deduplicado, condicionados al ajuste remoto `noWhatsappConsultRegistration`.

Dependencia: `v3/cli-remote-settings` (cambio `add-cli-remote-settings`) define cómo se edita, almacena y obtiene el ajuste; este cambio solo consume su valor booleano.

## Impact

- Código: `v3/cli-whatsapp/whatsapp-manual.js` (`injectNoWhatsappInfoButton`), nuevo `v3/cli-whatsapp/no-whatsapp-registry.js` + `v3/cli-whatsapp/test/no-whatsapp-registry.test.js`, `package.json` (script `test`, si no lo agregó antes `fix-historial-xss`).
- Dependencia: cambio `add-cli-remote-settings`. Si este cambio se despliega antes, el ajuste no está disponible, vale `false` y el registro queda desactivado, que es el comportamiento deseado.
- Archivo local nuevo (solo con el ajuste activo): `<directorio de datos ANA>/no-whatsapp-consultas.json` (p. ej. `%APPDATA%\ANA\no-whatsapp-consultas.json`).
- CRM/API de interacciones: mismo contrato. Con el ajuste en `false` (por defecto) no se envía ninguna "Consulta No Whatsapp"; con `true`, como máximo una por número/campaña/día desde un mismo equipo. Los duplicados ya creados no se limpian en este cambio.
- El volumen de "Consulta No Whatsapp" cae a cero al desplegar; negocio confirmó que no se usa.
- Distribución: requiere release del CLI por autoupdate; las versiones viejas siguen duplicando hasta actualizarse.
