# Proposal

## Why

Cuando el CLI v3 detecta que un número no tiene WhatsApp, el dato solo queda en el resultado de ese envío (`results/`, historial de envíos) y en el CRM. La siguiente vez que el mismo número llega en una asignación, el agente no lo sabe: lo publica de nuevo, el CLI pierde tiempo abriendo el chat y el crédito no recibe el mensaje en su otro teléfono. Tampoco hay forma de corregir un número marcado por error ("sí tiene WhatsApp").

## What Changes

- **Registro de estado de WhatsApp por teléfono** en una tabla DynamoDB nueva del stack v3 (`ana-backend-wa-status-<stage>`, us-east-1, bajo demanda, PITR): llave = teléfono normalizado MX (`52` + 10 dígitos), estado `no_whatsapp` | `has_whatsapp`, quién y cuándo lo marcó, origen, campaña, `lastNoWaAt`, `noWaCount`, `lastSentAt` y nota.
- **Escritores**:
  - `POST /agent/results` (existente): cada resultado `no_whatsapp` marca el teléfono sin WhatsApp y cada `sent` lo marca con WhatsApp; un evento más viejo nunca pisa un estado más nuevo (p. ej. una marca manual posterior). Es aditivo y de mejor esfuerzo: si falla, el lote se acepta igual.
  - `POST /agent/wa-status` (nuevo, agente con roster de la campaña) y `POST /admin/campaigns/{campaign}/wa-status` (nuevo, líderes/supervisores con permisos de Contactos): marcar manualmente `has_whatsapp` o `no_whatsapp` con autor y fecha.
- **Lectores**: `POST /agent/wa-status/lookup` y `POST /admin/campaigns/{campaign}/wa-status/lookup` con hasta 2000 teléfonos → estado por teléfono.
- **ANA Admin**:
  - Mi asignación, paso Contactos: insignia por fila ("Sin WhatsApp (marcado el dd/mm/aaaa por X)" / "Con WhatsApp"), aviso con el total de filas seleccionadas marcadas sin WhatsApp, filtro WhatsApp (Todos / Con WhatsApp / Sin WhatsApp / Sin dato) combinado con los filtros existentes y acción "Marcar con WhatsApp" por fila y para las seleccionadas, con confirmación.
  - En modo "Primer teléfono válido", un teléfono marcado sin WhatsApp se salta a favor del siguiente teléfono válido de la fila (como elección automática de teléfono, que v3 ya valida), con nota en la vista previa.
  - Carga de Contactos (supervisor): en la vista previa, conteo de filas cuyo teléfono está marcado sin WhatsApp (informativo, no bloquea).

Compatibilidad: el contrato solo crece. El CLI no cambia (ya reporta `no_whatsapp` y `sent` por `POST /agent/results` desde 1.0.51); `POST /agent/assignments/{c}/publish` no cambia.

Fuera de alcance: escritura desde v4 desktop (origen `v4_desktop` reservado, pendiente), excluir automáticamente filas en modo "Todos los seleccionados", expiración del registro, consulta del registro desde el CLI.

## Capabilities

### New Capabilities

- `v3/whatsapp-status-registry`: registro persistente del estado de WhatsApp por teléfono, sus escritores (resultados del CLI, marca manual de agente y de líder), su consulta por lote y su uso en Mi asignación y en la vista previa de carga de Contactos.

### Modified Capabilities

_Ninguna._ (El efecto sobre `POST /agent/results` y la elección automática de teléfono se especifican como requisitos de la capacidad nueva.)

## Impact

- Backend v3: `serverless.yml` (tabla `WaStatusTable`, IAM, variable `WA_STATUS_TABLE`, 4 funciones), nuevo `src/lib/waStatus.ts` y `src/handlers/waStatus.ts`, `agentResults.ts` (llamada aditiva), dependencias `@aws-sdk/client-dynamodb` y `@aws-sdk/lib-dynamodb`, pruebas vitest.
- ANA Admin: BFF `/api/agent/wa-status`, `/api/agent/wa-status/lookup`, `/api/campaigns/[campaign]/wa-status/lookup`; `lib/wa-status.ts`; componentes nuevos `workspace/WaStatusBadge.tsx`, `workspace/WaStatusPanel.tsx`, `contacts/WaUploadNotice.tsx`; integración mínima en `MyAssignmentView.tsx` y `ContactsUploadView.tsx`.
- Datos: teléfonos (dato personal) en DynamoDB con cifrado en reposo por omisión; las respuestas no incluyen otros datos del contacto y los logs no llevan teléfonos.
- Despliegue: v3 backend (crea la tabla) → ANA Admin.
