# Design

## Context

- El CLI recibe una asignación con `GET /get/chats/{agent}/{campaign}`, que entrega y borra el archivo más antiguo `agents/{campaign}/{agent}-contacts-*.csv`. No sabe qué llave recibió ni a qué publicación pertenece.
- El manifiesto de una publicación de Mi asignación (`agent-publications/{campaign}/{agent}/{publishId}.json`) guarda `key` = esa misma llave y `contacts` = filas publicadas. Los archivos subidos por un supervisor desde Contactos no tienen manifiesto.
- El registro local (`assignment-journal.js`) da a cada fila un `index` y un estado `pending → in_flight → done | por_revisar`; una fila se intenta a lo sumo una vez por asignación.
- Backend sobre S3 puro, sin base de datos; varias Lambdas pueden escribir al mismo tiempo.

## Goals / Non-Goals

**Goals:** resultado por contacto visible en ANA Admin minutos después del envío; cero impacto en el ritmo de envío; tolerancia a cortes de red y reinicios; escrituras seguras sin coordinación; lectura acotada en costo.

**Non-Goals:** exactitud transaccional entre resultados y publicaciones; historial de v4; edición o borrado de resultados por el usuario.

## Decisions

**D1. Enlace resultado → publicación por llave del archivo.** `GET /get/chats` responde la cabecera `X-Ana-Assignment-Key: <key>`; el CLI la guarda en el journal (`source_key`) y la envía como `sourceKey`. El backend resuelve `publicationId` al leer, comparando con `manifest.key`. Alternativa descartada: agregar `publishId` como columna del CSV publicado (cambia el archivo que consumen CLIs instalados y no cubre cargas de supervisor).

**D2. Llave de idempotencia** `id = assignmentId#rowIndex#attempt`, con `attempt = 1` (una fila se intenta una vez por asignación; el contacto interrumpido se reporta como `por_revisar` con la misma llave). Primer registro gana.

**D3. Bandeja de salida del CLI** (`results-outbox.js`): archivo `results-outbox-<agent>.json` en el directorio de datos con `pending` (máx. 5000, descarta los más viejos) y `sent` (últimas 2000 llaves para deduplicar). `enqueue` escribe de forma atómica (`.tmp` + rename) y programa un `flush` sin `await`. `flush` es de vuelo único, agrupa por campaña hasta 100 items y: 2xx → quita aceptados, duplicados y rechazados; 400 → descarta el lote (veneno); 401/403/5xx/red → reintento con espera 30 s × 2ⁿ hasta 10 min. Arranca con lo pendiente al iniciar sesión. Un fallo de disco o de red solo se registra.

**D4. Escritura concurrente sin coordinación.** Cada lote aceptado se agrupa por día MX (`America/Mexico_City`) de `sentAt` y se escribe un objeto inmutable `results/{campaign}/{agent}/{YYYY-MM-DD}/{sha256(ids)[0..16]}.json` con `If-None-Match: *`: el reintento del mismo lote es un no-op (412 = duplicado) y dos Lambdas nunca pisan el mismo objeto. La deduplicación entre lotes ocurre al leer (D5).

**D5. Lectura con compactación.** La consulta lista `results/{campaign}/{agent}/` desde `from` hasta `to` (máx. 31 días; por defecto 7). Por día: si existe `_compact.json` se lee y solo se leen los lotes que no lista; si quedan ≥ 20 lotes sin compactar, se reescribe `_compact.json` (condicional por ETag; un conflicto se ignora). Los lotes originales no se borran (los expira la retención). Filtros, orden (`sentAt`, `status`, `credit`) y cursor (desplazamiento) se aplican en el servidor tras deduplicar; los agregados por publicación usan todas las filas del rango sin filtros de estado ni búsqueda.

**D6. Pendientes.** `pending = manifest.contacts − filas distintas reportadas` (por `assignmentId#rowIndex`) solo si la publicación cae dentro del rango; si es anterior a `from`, `pending = null` ("parcial").

**D7. Datos mínimos.** Se guarda el teléfono normalizado (52 + 10), crédito, `uploadId`, estado, código y texto de error (≤ 200), `sentAt`, sha256 del mensaje y sus primeros 160 caracteres. Las respuestas GET solo devuelven el teléfono enmascarado (`**1234`); la búsqueda por teléfono se resuelve en el servidor. Los logs nunca llevan teléfonos ni mensajes.

**D8. Autorización.** `/agent/results*`: `cognitoAgentJwt` + `requireAgentToken` + roster de la campaña; agente siempre del token. `/admin/campaigns/{c}/results`: `requireAdminAccess` con `CONTACTS_UPLOAD` y `CONTACTS_DISTRIBUTE` y campaña en alcance (mismo criterio que review-items).

**D9. Realtime.** La regla del puente agrega `results/`; v4 traduce `results/{c}/{agent}/{día}/{lote}.json` creado (no `_compact.json`) a `results.changed` para el agente. ANA Admin recarga la vista del agente con ese evento; la vista de campaña se actualiza a mano.

**D10. Retención.** Regla de ciclo de vida `ExpireSendResults` (prefijo `results/`, 180 días) en `StorageBucket`, que ya gestiona `serverless.yml`.

**D11. UI.** Dos rutas sobre un mismo componente `SendHistoryView`: `/mi-asignacion/historial` (alcance agente, permiso de envío) y `/historial-envios` (alcance campaña, permisos de Contactos). `MyAssignmentView` solo recibe un enlace en su encabezado para no chocar con el trabajo en curso sobre ese archivo.

## Risks / Trade-offs

- Lecturas costosas en campañas grandes sin filtro de agente → rango máximo de 31 días, compactación y `timeout: 29`.
- Una publicación consumida por un CLI anterior a 1.0.51 no tendrá resultados; aparecerá con pendientes = publicados.
- Si el reloj del equipo del agente está mal, `sentAt` cae en otro día; se rechazan fechas futuras (> 5 min) y anteriores a 180 días.
- La deduplicación "primero gana" oculta una corrección posterior del mismo contacto; aceptable porque cada fila se intenta una sola vez.
