# Design

## Context

Flujo actual (ver proposal.md - Why):

1. `fetchAssignedChats` (`agent-config.js:424`) hace `GET /get/chats/{agent}/{campaign}`; el backend (`ana-backend/src/handlers/chats.ts`) entrega el archivo más antiguo de `agents/{campaign}/{agent}-contacts*.csv` y lo **elimina** antes de responder. El CLI parsea el CSV en memoria.
2. `index.js:463-646` recorre los contactos: `sendMessage` → interacción CRM → retraso 30–120 s → pausa de 30 min cada 20.
3. Solo al terminar el ciclo: `updatePendingContacts([])` (`index.js:651`). `contacts.ts` sobrescribe `chats/{agent_id}-{campaign}.csv`; no hay lector de ese prefijo en `v3/` ni `v4/` (búsqueda en el repo) y se confirmó que ningún proceso fuera del repo lo lee ni republica asignaciones desde él; el bucket prod sí contiene `chats/` (PLAN_SEGURIDAD_Y_DEUDA.md, 2026-10-08).

Consecuencia: un cierre a mitad de ciclo (Ctrl+C, cierre de ventana, reinicio de Windows, autoupdate al siguiente arranque) pierde los contactos restantes; la remediación manual (re-subir la asignación) duplica los ya enviados. Un ciclo de 20 contactos dura ~25 min más una pausa de 30 min, así que la ventana de exposición es grande.

Restricciones: el contrato del backend solo puede crecer de forma compatible (flota instalada); el único cambio es el campo opcional `review` de D6; el cambio en curso `secure-assignment-consumption` agrega token a `fetchAssignedChats` y no toca `/contacts/pending`.

## Goals / Non-Goals

**Goals:**
- Ningún contacto de una asignación recibida se pierde por un cierre del CLI.
- Ningún contacto de una asignación recibe dos mensajes por un reinicio del CLI.
- El backend refleja los pendientes reales de cada agente después de cada contacto.

**Non-Goals:**
- Deduplicar entre asignaciones (ver D4).
- Recuperación automática en otro equipo (el registro es local; el respaldo del lado servidor es `chats/`, de recuperación manual).
- Corregir el serializador CSV de `contacts.ts` (no escapa comillas internas ni saltos de línea; queda como seguimiento). `contacts.ts` solo crece con el campo opcional `review` (D6).

## Decisions

### D1. Las dos medidas, con roles distintos
- **Registro local (journal)** = mecanismo de corrección. Es lo único que puede evitar pérdida y duplicado sin cambiar el backend, porque el servidor ya borró la asignación y no tiene forma de devolverla.
- **Reporte por contacto a `/contacts/pending`** = visibilidad y red de seguridad fuera del equipo. Si el equipo del agente se pierde (formateo, robo, reinstalación con `%APPDATA%` borrado), `chats/{agent}-{campaign}.csv` contiene las filas pendientes listas para re-subir. Es el comportamiento que `LIMITE-MENSAJES.md` ya documentaba y usa el contrato existente.
- Alternativa: solo reporte al backend. Descartada como mecanismo principal: nada lee `chats/`, así que no evita la pérdida en el siguiente arranque; requeriría cambiar `GET /get/chats` para devolver `chats/` primero, lo que cambia el contrato y choca con CLIs viejos que siguen enviando `[]` solo al final.
- Alternativa: solo journal. Válida, pero deja al supervisor sin visibilidad si el equipo muere; el costo del reporte es una llamada cada ~70 s.

### D2. Formato y ubicación del journal
`%APPDATA%\ANA\assignment-journal-<agent>-<campaign>.json` (nombre saneado a `[A-Za-z0-9_-]`):

```json
{ "version": 1, "agent_id": "...", "campaign": "...", "received_at": "ISO",
  "csv_sha256": "...", "assignment_id": "20261026T1530-ab12cd34", "csv": "<CSV crudo recibido>",
  "rows": [ { "index": 0, "phone": "5215512345678", "state": "pending" } ] }
```

Estados: `pending`, `in_flight`, `done`, `por_revisar` (D6).

- Se guarda el **CSV crudo** y no los contactos parseados: en la reanudación se re-parsea con el mismo parser (`assignment-csv.js` de `fix-cli-double-brace-templates`, o el `parseCSV` actual si ese cambio no se ha aplicado). Si el CLI se autoactualizó entre cierre y arranque, la versión nueva re-renderiza con sus reglas corregidas.
- Integridad: al reanudar se verifica `sha256(csv) == csv_sha256`, que el número de filas parseadas coincida y que `phone` de cada fila coincida; si algo falla, el archivo se renombra a `*.invalid-<timestamp>.json` y no se envía nada de él (requisito "Registro ilegible").
- Escritura atómica: escribir `*.tmp` y `fs.renameSync` sobre el destino (en Windows Node usa `MoveFileEx` con reemplazo). El journal se reescribe completo en cada cambio de estado; con asignaciones de decenas a cientos de filas es trivial.
- `fetchAssignedChats` pasa a devolver `{ csvText, contacts }` (o el CLI parsea fuera) para poder guardar el CSV crudo; `parseCSV` debe exponer, por contacto, su fila original (`rawValues`) y su índice, que se usan también para el reporte.

### D3. Orden de operaciones por contacto
1. `state = in_flight` → escribir journal.
2. `sendMessage` → resultado.
3. `state = done` → escribir journal.
4. Interacción CRM (como hoy).
5. `POST /contacts/pending` con las filas `pending` restantes (filas originales, en orden).
6. Retraso / pausa (como hoy).

Marcar `done` antes del CRM prioriza no duplicar mensajes sobre no perder una interacción: si el cierre ocurre entre 3 y 4, el mensaje se envió pero falta la interacción (mismo riesgo que hoy ante un fallo del CRM, que ya se tolera). `in_flight` al reanudar → no se reenvía y pasa a `por_revisar` (requisito "Contacto interrumpido"): en cobranza es preferible un posible no-envío visible para el supervisor que un mensaje duplicado al deudor.

### D4. Alcance de la deduplicación: una asignación
El journal no persiste más allá de la asignación (se elimina al terminar). No se deduplica entre asignaciones porque un supervisor puede reenviar deliberadamente el mismo CSV como recordatorio; bloquearlo en silencio sería peor. Si el supervisor re-sube una asignación incompleta, sí se duplicaría: con `chats/` actualizado puede re-subir solo los pendientes (documentarlo en `README-SUPERVISORES.md`).

### D5. Arranque y poll
Antes del `while (true)` de `index.js`, y al inicio de cada iteración, si existe journal con pendientes para el agente/campaña configurados, se procesa ese journal en lugar de hacer poll. Así una asignación nunca se mezcla con otra y el contador de pausa sigue funcionando igual (se conserva entre asignaciones, se reinicia con el proceso, como hoy).

### D6. Contactos "por revisar": estado propio y reporte separado
Un contacto interrumpido en pleno envío no se pierde en silencio: el journal lo pasa a `por_revisar`, `resultados.csv` lo registra con `status: por_revisar` y se reporta al backend.
- Contrato: campo opcional `review: {assignment_id, contacts}` en el mismo `POST /contacts/pending` (filas originales, igual que `contacts`). `assignment_id` = `received_at` compacto (`YYYYMMDDTHHMM`) + `-` + 8 primeros hex de `csv_sha256`, guardado en el journal. El backend escribe `review/{campaign}/{agent_id}/{assignment_id}.csv` (un objeto por asignación, se sobrescribe en cada reporte) y no toca `chats/`.
- Por qué separado de `contacts`: `chats/` se sobrescribe en cada reporte y se vacía al final de la asignación (y con la siguiente), así que una fila "por revisar" ahí se perdería; mezclarla además haría que alguien la re-subiera como pendiente normal.
- Compatibilidad: los CLIs viejos no envían `review` (sin cambio). Un CLI nuevo contra un backend sin desplegar: el campo se ignora (el handler solo lee `campaign`, `agent_id`, `contacts`) y el dato sigue en `resultados.csv`. Por eso el backend se despliega antes del release del CLI.
- Visibilidad: `GET /supervisors/review/{campaign}` con `X-Admin-Key` (mismo patrón que las demás consultas de supervisor). La autenticación de agente de `migrate-cli-to-cognito-login` cubre `review` sin cambios porque viaja en la misma ruta.
- Alternativa: columna `ana_status` en las filas de `contacts`. Descartada por la sobrescritura descrita arriba.
- Fuera de alcance: marcar registros como resueltos o borrarlos desde una ruta, y mostrarlos en ANA Admin (seguimiento anotado en `add-contact-upload-console`).

## Risks / Trade-offs

- [Datos de deudores en un archivo local adicional] → mismo nivel de exposición que `resultados.csv` en el mismo directorio; se elimina al terminar la asignación.
- [Datos de deudores enviados a una ruta sin autenticación en cada contacto] → `/contacts/pending` ya es público y ya recibe (o debía recibir) estos datos; el cierre de esa ruta está en el plan de seguridad como seguimiento.
- [CSV de `chats/` malformado si un mensaje contiene comillas o saltos de línea] → limitación conocida de `contacts.ts`; el journal local no depende de él.
- [Registro de una campaña antigua que nunca se reanuda] → se conserva; el CLI imprime un aviso al arrancar listando registros de otros agentes/campañas para que soporte decida.
- [Un cierre entre "enviado" y "done"] → el contacto queda `in_flight`, no se reenvía y pasa a `por_revisar`; el supervisor lo ve en `review/` y decide si reasignarlo (si no se envió) o descartarlo (si sí).
- [Registros de `review/` que se acumulan sin resolverse] → volumen bajo (solo cierres en pleno envío); la limpieza o el estado "resuelto" queda como seguimiento.

## Migration Plan

1. Desplegar el backend con el campo `review` y `GET /supervisors/review/{campaign}` (aditivo).
2. Release del CLI con el journal. Las versiones viejas siguen enviando `[]` al final.
3. Documentar en `README-SUPERVISORES.md` cómo leer `chats/{agent}-{campaign}.csv` para recuperar pendientes de un equipo perdido y cómo consultar los contactos por revisar.
4. Rollback: publicar una versión mayor sin el journal; los archivos `assignment-journal-*.json` restantes se ignoran. El backend no necesita rollback (sin `review` se comporta como antes).
