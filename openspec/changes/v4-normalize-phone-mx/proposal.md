# Proposal

## Why

La normalización de teléfonos del desktop v4 (`electron/whatsapp/phone.ts`) decide la lada por prefijo de texto y no reconoce los prefijos nacionales mexicanos: `0445512345678` se convierte en `520445512345678`, WhatsApp no lo resuelve y el contacto se reporta al CRM como "No tiene Whatsapp" **y se marca el teléfono sin WhatsApp** (`PATCH /phone`), un dato falso que contamina la base de cobranza. Tampoco maneja el `1` de celular sin lada (`15512345678`), el `01` de larga distancia ni un número de 10 dígitos que empieza con `52`, y un número de otro país escrito con `+` recibe la lada `52` igual. Un teléfono que no se puede normalizar también termina como "sin WhatsApp". El backend tiene su propia copia (`toE164Mx`) con reglas distintas para la búsqueda del `credit_id`. Es el equivalente v4 de `normalize-whatsapp-phone-country-code` en v3, extendido a los prefijos `044`/`045` que v3 dejó fuera.

## What Changes

- Reglas únicas para lada `52`, decididas por longitud y no por prefijo de texto: 10 dígitos → `52` + 10; `52` + 10 → igual; `521` + 10 → `52` + 10; `044`/`045` + 10 → `52` + 10; `01` + 10 → `52` + 10; `1` + 10 → `52` + 10; prefijo internacional `00` o `+` seguido de otra lada → se respeta el número extranjero.
- Para otras ladas se conserva la regla genérica actual (quitar `00`, anteponer la lada si falta).
- Un teléfono que no se puede normalizar deja el job en `error` con "Teléfono inválido": no se consulta WhatsApp, no se reporta "No tiene Whatsapp" y no se marca el teléfono en el CRM.
- El backend usa las mismas reglas para la búsqueda del `credit_id` en el CRM (`+52` + 10 dígitos).
- Una tabla de vectores de prueba compartida por las pruebas del desktop y del backend.
- Release del desktop y despliegue del backend.

Fuera de alcance: validar teléfonos en la carga del CSV (se agrega en ANA Admin por `add-contact-upload-console`), cambiar el formato de `phone_number` de las interacciones (sigue siendo los últimos 10 dígitos), corregir teléfonos ya marcados sin WhatsApp por error (se documenta cómo identificarlos).

## Capabilities

### New Capabilities

_Ninguna._

### Modified Capabilities

- `v4/template-interpolation`: "Normalización de teléfono" con reglas mexicanas por longitud, prefijos nacionales y números extranjeros con `+`.
- `v4/job-processing`: "Envío de un job" distingue teléfono inválido de número sin WhatsApp.
- `v4/crm-interactions`: "Resolución de credit_id" busca con el teléfono normalizado por las mismas reglas.

## Impact

- Desktop: `electron/whatsapp/phone.ts` (reescrito), `electron/whatsapp/client.ts` (`resolveJid` distingue inválido), `electron/main.ts` (`runJob`), pruebas vitest.
- Backend: nuevo `v4/backend/src/lib/phone.ts` (mismas reglas), `src/lib/interactions.ts` (`toE164Mx` delega), `src/handlers/interactions.ts`, pruebas vitest.
- Datos compartidos: `v4/shared/phone-mx-vectors.json` (vectores de entrada/salida usados por ambas suites).
- CRM: dejan de generarse marcados falsos "sin WhatsApp" por números con `044`/`045`/`01`/`1`.
