# Design

## Context

- El backend v3 vive sobre S3 sin base de datos; `POST /agent/results` (add-agent-send-history) ya recibe del CLI ≥ 1.0.51 cada resultado con `phone` (dígitos, normalmente `52` + 10) y `status` `sent` | `no_whatsapp` | `error` | `por_revisar`.
- Un teléfono se repite entre campañas, cargas y agentes: el estado "sin WhatsApp" es del número, no de la asignación. Consultarlo en el historial de resultados (S3 por campaña/agente/día) no escala a "¿alguna vez?".
- Mi asignación (`MyAssignmentView`) y su lógica (`lib/workspace`) se editan en paralelo por otro equipo: la UI nueva va en componentes y módulos nuevos con puntos de integración pequeños.
- La publicación ya admite un teléfono elegido por fila (`overrides`), que v3 valida contra los teléfonos válidos de la fila.

## Goals / Non-Goals

**Goals:** registro global por teléfono con escrituras idempotentes y "el más nuevo gana"; consulta de hasta 2000 teléfonos por solicitud; aviso, filtro y corrección en Mi asignación sin cambiar el contrato de publicación; aviso no bloqueante en la carga de Contactos.

**Non-Goals:** escritura desde v4 desktop (pendiente, origen reservado); historial de cambios por teléfono; expiración del registro; bloquear publicaciones o cargas.

## Decisions

**D1. DynamoDB, una tabla.** `WaStatusTable` = `${self:service}-wa-status-${sls:stage}` en el stack v3 (us-east-1), `PAY_PER_REQUEST`, PITR activado, `DeletionPolicy: Retain`, llave `phone` (S). Acceso por llave exacta (`GetItem`/`UpdateItem`/`BatchGetItem`), sin índices. Permisos `dynamodb:GetItem`, `UpdateItem`, `BatchGetItem` sobre su ARN en el rol compartido de las funciones (el stack usa un solo rol). Nombre por `WA_STATUS_TABLE`. Alternativa descartada: objetos S3 por teléfono (sin escrituras condicionales por atributo y lecturas por lote caras).

**D2. Normalización.** Dígitos; 10 → `52`+d; 12 con `52` → igual; 13 con `521` → `52`+últimos 10; cualquier otra longitud → no se registra ni se consulta. Misma semántica que `parseMxPhone` del CLI (`toWhatsAppUrlPhone` para MX), replicada en ANA Admin para indexar la respuesta.

**D3. Orden por fecha con expresiones condicionales.** Cada evento trae fecha `t` (ISO UTC; `sentAt` del CLI o la hora del servidor en marcas manuales). Paso 1: `UpdateItem` con `ConditionExpression: attribute_not_exists(phone) OR updatedAt < :t` que fija `status`, `updatedAt = t`, `updatedBy`, `source`, `campaign` y, para `no_whatsapp`, `lastNoWaAt = t` y `ADD noWaCount 1`; para `sent`, `lastSentAt = t`. Si la condición falla (evento más viejo o reintento), paso 2 solo actualiza el contador o la fecha con `attribute_not_exists(lastNoWaAt) OR lastNoWaAt < :t` (o `lastSentAt`); si también falla, no hace nada. Así un reintento con la misma `t` nunca cuenta dos veces y un evento atrasado nunca pisa una marca más nueva. `noWaCount` es "al menos": un evento `no_whatsapp` más viejo que el último registrado no se cuenta.

**D4. Escritura desde resultados, de mejor esfuerzo.** `postResults`, tras `writeResults`, envía al registro todos los items válidos `sent` / `no_whatsapp` con teléfono normalizable (también los de lotes duplicados: D3 los vuelve no-op, y así se recupera un fallo previo). Concurrencia 8, ordenados por `sentAt`. Un error del registro solo se registra (`evt: wa_status_error`) y la respuesta sigue siendo 200: el historial es la fuente principal y el CLI no debe reintentar por esto.

**D5. Marca manual.** Body `{campaign, phones[1..500], status, note?}` (`note` ≤ 200, espacios colapsados). `updatedBy` = usuario del token, `t` = ahora; `source` = `agent_manual` (ruta de agente) o `admin_manual` (ruta admin). Agente: `requireAgentToken` + roster de `campaign` (el agente puede marcar cualquier teléfono; se registra la campaña y el autor para auditoría; validar contra sus asignaciones exigiría leer S3 en cada marca). Admin: `CONTACTS_UPLOAD` + `CONTACTS_DISTRIBUTE` y campaña en alcance. Respuesta `{updated, rejected[]}`.

**D6. Consulta por lote.** Normaliza y deduplica; > 2000 teléfonos de entrada → 400. `BatchGetItem` en bloques de 100 con concurrencia 4 y `ProjectionExpression` de los campos públicos; `UnprocessedKeys` se reintenta hasta 5 veces con espera 50 ms × 2ⁿ (+ jitter); si quedan llaves, responde 503 para no presentar "Sin dato" como verdad. Agente: roster de `campaign`; admin: `CONTACTS_UPLOAD` y campaña en alcance (la vista previa de carga la usa quien sube). Respuesta `{items: {[phone]: {...}}}`; sin `campaign` ni `note` de otros registros.

**D7. ANA Admin, módulos nuevos.** `lib/wa-status.ts` (normalización, estado por fila, predicado de filtro `matchesWaFilter`, elección automática `waAutoOverrides`, textos), hook `useWaStatus` (consulta en bloques de 2000, caché por teléfono, marca optimista con reversión), `workspace/WaStatusBadge.tsx` (insignia y acción por fila), `workspace/WaStatusPanel.tsx` (aviso, filtro, acción en lote, nota de teléfonos cambiados) y `contacts/WaUploadNotice.tsx`. En `MyAssignmentView` solo se agregan: el hook, el panel sobre la tabla, una columna "WhatsApp", el predicado en `filtered` y `effectiveOverrides` en lugar de `overrides` para el plan y la publicación. El filtro WhatsApp vive en memoria (no en `table-filters`) para no tocar el estado persistido que edita el otro equipo; el predicado queda exportado para que su barra de filtros lo incluya.

**D8. Estado por fila.** Teléfonos de la fila = candidatos válidos de las columnas elegidas. "Sin WhatsApp" si alguno está `no_whatsapp`; "Con WhatsApp" si ninguno lo está y alguno es `has_whatsapp`; "Sin dato" si ninguno tiene registro. El filtro usa la misma clasificación. El aviso cuenta filas seleccionadas clasificadas "Sin WhatsApp".

**D9. Saltar en modo `first` sin tocar `publication.ts`.** `waAutoOverrides(rows, phoneColumns, statuses, overrides)`: para cada fila sin elección manual cuyo primer candidato está `no_whatsapp`, elige el primer candidato no marcado; si todos están marcados, no cambia nada. El resultado se mezcla con las elecciones manuales (`effectiveOverrides`) y alimenta `planPhones` y `publishOverrides`, así vista previa y archivo publicado coinciden por construcción y el backend sigue validando. Solo aplica en modo `first`; en `all` solo se avisa. Se descartó consultar el registro dentro de `POST /publish` (agrega latencia y una dependencia nueva a la ruta crítica y rompe la equivalencia pura con ANA Admin).

**D10. Carga de Contactos.** `WaUploadNotice` consulta `POST /api/campaigns/{c}/wa-status/lookup` con el teléfono de cada fila válida (bloques de 2000, máximo 20 000; más → "no verificado") y muestra el conteo de filas con teléfono `no_whatsapp`. No participa en `previewBlock` ni en el envío.

## Risks / Trade-offs

- Un agente podría marcar números ajenos a su asignación → se registra autor, campaña y origen; el líder puede revertir.
- El reloj del equipo del agente (`sentAt`) decide el orden frente a marcas manuales; `sentAt` ya se valida (≤ 5 min en el futuro).
- Costo: una escritura por resultado `sent`/`no_whatsapp` y lecturas al abrir Mi asignación; bajo demanda, del orden de centavos por miles de envíos.
- Un número reasignado por la compañía telefónica quedará marcado hasta que alguien lo corrija o el CLI lo envíe con éxito.
- Si la tabla no existe (backend sin desplegar), ANA Admin muestra "No se pudo verificar" y sigue funcionando.
