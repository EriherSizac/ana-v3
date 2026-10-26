# Proposal

## Why

El CLI v3 solo informa progreso al backend al final de un ciclo completo (`POST /contacts/pending` con `contacts: []`, `index.js:651`), y no guarda localmente qué contactos de la asignación ya procesó. Revisando el backend, el problema real de un cierre a mitad de ciclo es distinto del que describe la spec actual:

- `GET /get/chats` **borra** el archivo de la asignación al entregarlo (`chats.ts`, consumo único), y `POST /contacts/pending` escribe `chats/{agent_id}-{campaign}.csv`, que **ningún código del repositorio lee**. Por lo tanto, si el agente cierra el CLI tras enviar 5 de 10 contactos, los 5 restantes **se pierden**: no vuelven en el siguiente arranque y el supervisor no tiene dónde verlos.
- La única forma de recuperarlos hoy es que el supervisor vuelva a subir la asignación completa, lo que **reenvía los 5 mensajes ya enviados** (duplicados al deudor).
- La spec `v3/automated-sending` afirma lo contrario ("los 10 contactos se reciben en el siguiente arranque"), lo cual no corresponde al código.

Para una cobranza esto es doble riesgo: deudores no contactados y deudores contactados dos veces.

## What Changes

- **Registro local de la asignación en curso**: al recibir una asignación, antes del primer envío, el CLI la guarda en el directorio de datos junto con el estado de cada contacto (`pendiente`, `en curso`, `procesado`), y actualiza el estado antes y después de cada envío.
- **Reanudación**: al arrancar, antes de consultar el servidor, el CLI retoma la asignación registrada para el mismo agente y campaña, procesando solo los contactos pendientes. Un contacto que quedó `en curso` (cierre durante el envío) **no se reenvía**: se registra como interrumpido para no duplicar.
- **Reporte de pendientes tras cada contacto**: después de cada contacto procesado, el CLI envía a `POST /contacts/pending` las filas originales de los contactos que faltan (antes solo enviaba `[]` al final). Así `chats/{agent_id}-{campaign}.csv` refleja los pendientes reales y permite recuperarlos si el equipo del agente se pierde. Al terminar sigue enviando `[]`.
- Pruebas unitarias `node:test` del registro (escritura atómica, reanudación, cálculo de pendientes).
- Corrección de la spec para describir el comportamiento real.
- Release del CLI.

Sin cambios en el backend ni en su contrato: se usa `POST /contacts/pending` tal como existe, compatible con la flota instalada.

Fuera de alcance: deduplicar entre asignaciones distintas (una asignación nueva con los mismos contactos se envía completa, a propósito), reasignar pendientes a otro agente, corregir el escape de comillas del CSV que escribe `contacts.ts` y autenticar `/contacts/pending`.

## Capabilities

### New Capabilities

_Ninguna._

### Modified Capabilities

- `v3/automated-sending`: "Consumo de la lista de pendientes" pasa a reportar pendientes tras cada contacto y corrige el escenario de cierre a mitad de ciclo; se agregan requisitos de registro local, reanudación y limpieza del registro.

## Impact

- Código: `v3/cli-whatsapp/index.js` (bucle principal), `agent-config.js` (`fetchAssignedChats` devuelve también el CSV crudo; `updatePendingContacts`), nuevo módulo `assignment-journal.js` y pruebas; `build-portable.ps1`.
- Datos locales: nuevo archivo por agente y campaña en `%APPDATA%\ANA` (contiene datos de contactos, igual que `resultados.csv`).
- Red: una llamada adicional a `/contacts/pending` por contacto (~1 cada 70 s), con los datos de los contactos pendientes.
- Coordinación: `secure-assignment-consumption` también modifica `fetchAssignedChats` (token en el polling); ambos cambios deben integrarse sobre la misma función. `fix-cli-double-brace-templates` mueve el parser a `assignment-csv.js`, que este cambio reutiliza para re-parsear en la reanudación.
