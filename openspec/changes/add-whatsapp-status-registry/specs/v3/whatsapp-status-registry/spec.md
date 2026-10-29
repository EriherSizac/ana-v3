# Spec Delta

## Purpose

Recordar qué teléfonos se marcaron sin WhatsApp (o se confirmaron con WhatsApp), avisarlo al agente cuando vuelven a llegar en una asignación y permitir corregir la marca.

## ADDED Requirements

### Requirement: Registro de estado de WhatsApp por teléfono
El backend v3 SHALL guardar un registro por teléfono normalizado MX (`52` + 10 dígitos; 10, 12 con `52` o 13 con `521` se normalizan, otras longitudes se ignoran) con `status` (`no_whatsapp` | `has_whatsapp`), `updatedAt`, `updatedBy`, `source` (`cli_send`, `agent_manual`, `admin_manual`; `v4_desktop` reservado), `campaign`, `lastNoWaAt`, `noWaCount`, `lastSentAt` y `note`. Los logs MUST NOT llevar teléfonos.

#### Scenario: Formatos equivalentes
- **WHEN** se registran `5512345678`, `525512345678` y `5215512345678`
- **THEN** los tres corresponden al mismo registro `525512345678`

### Requirement: Estado desde los resultados del CLI
Al aceptar resultados en `POST /agent/results`, el sistema SHALL marcar `no_whatsapp` (suma 1 a `noWaCount`, fija `lastNoWaAt`) por cada resultado `no_whatsapp` y `has_whatsapp` (fija `lastSentAt`) por cada `sent`, con `source: cli_send`, el agente del token y `sentAt` como fecha. Un evento con fecha ≤ `updatedAt` MUST NOT cambiar el estado ni contarse dos veces. Si el registro falla, el lote MUST aceptarse igual.

#### Scenario: Número sin WhatsApp
- **WHEN** el agente `erick` reporta `no_whatsapp` para `5215512345678` el 29/10/2026
- **THEN** el registro `525512345678` queda `no_whatsapp`, `updatedBy: erick`, `noWaCount: 1`

#### Scenario: Marca manual más nueva
- **WHEN** un líder marcó `has_whatsapp` el 30/10 y llega tarde un resultado `no_whatsapp` del 29/10
- **THEN** el estado sigue `has_whatsapp`

#### Scenario: Reintento del mismo lote
- **WHEN** el CLI reenvía el mismo resultado `no_whatsapp`
- **THEN** `noWaCount` no aumenta

### Requirement: Marca manual del estado
El sistema SHALL exponer `POST /agent/wa-status` (`cognitoAgentJwt`, token estricto, roster de `campaign`) y `POST /admin/campaigns/{campaign}/wa-status` (permisos de Contactos para subir y repartir, campaña en alcance) con `{campaign, phones[1..500], status, note?}`. Fija el estado con la hora del servidor, `updatedBy` del token y `source` `agent_manual` o `admin_manual`. Teléfonos inválidos se devuelven en `rejected`.

#### Scenario: Agente confirma WhatsApp
- **WHEN** el agente `erick` marca `has_whatsapp` para `5512345678` en `prueba`
- **THEN** responde 200 con `updated: 1` y el registro queda `has_whatsapp`, `updatedBy: erick`, `source: agent_manual`

#### Scenario: Fuera de alcance
- **WHEN** el agente no está en el roster de la campaña, o el líder no la tiene en su alcance
- **THEN** responde 403 sin escribir

### Requirement: Consulta por lote del estado
El sistema SHALL exponer `POST /agent/wa-status/lookup` (agente con roster de `campaign`) y `POST /admin/campaigns/{campaign}/wa-status/lookup` (permiso de subir Contactos, campaña en alcance) con `{campaign, phones[1..2000]}`. Responde, por teléfono normalizado con registro, `{status, updatedAt, updatedBy, source, lastNoWaAt, noWaCount}`; los teléfonos sin registro no aparecen. Más de 2000 teléfonos MUST responder 400. Una lectura parcial transitoria MUST reintentarse.

#### Scenario: Asignación con números marcados
- **WHEN** se consultan 3 teléfonos y solo `525512345678` tiene registro `no_whatsapp`
- **THEN** la respuesta trae solo `525512345678` con su estado, fecha y autor

### Requirement: Aviso y filtro en Mi asignación
En el paso Contactos, ANA Admin SHALL consultar el registro con los teléfonos de las columnas elegidas y mostrar por fila "Sin WhatsApp (marcado el dd/mm/aaaa por X)" o "Con WhatsApp", un aviso "N contactos fueron marcados sin WhatsApp en algún momento" si hay filas seleccionadas marcadas, y un filtro WhatsApp (Todos, Con WhatsApp, Sin WhatsApp, Sin dato) combinado con los demás filtros. Si la consulta falla, la vista MUST seguir usable.

#### Scenario: Filtrar sin WhatsApp
- **WHEN** 2 de 5 filas tienen un teléfono marcado sin WhatsApp y el agente elige "Sin WhatsApp"
- **THEN** la tabla muestra esas 2 filas y el aviso dice "2 contactos fueron marcados sin WhatsApp en algún momento"

### Requirement: Marcar con WhatsApp desde Mi asignación
ANA Admin SHALL ofrecer "Marcar con WhatsApp" por fila marcada sin WhatsApp y para las filas seleccionadas, con confirmación. Al confirmar, actualiza la insignia de inmediato y llama a `POST /agent/wa-status`; si falla, MUST restaurar el estado anterior y mostrar el error.

#### Scenario: Corrección de una fila
- **WHEN** el agente confirma "Marcar con WhatsApp" en una fila marcada sin WhatsApp
- **THEN** la fila muestra "Con WhatsApp" y el registro queda `has_whatsapp` con su usuario

#### Scenario: Error al guardar
- **WHEN** `POST /agent/wa-status` falla
- **THEN** la fila vuelve a "Sin WhatsApp" y se muestra el error

### Requirement: Saltar teléfonos sin WhatsApp en modo primer teléfono
En modo "Primer teléfono válido", si el primer teléfono válido de una fila está marcado `no_whatsapp` y otro teléfono válido de la fila no lo está, ANA Admin SHALL elegir ese otro como teléfono de la fila (salvo elección manual del agente) y la vista previa MUST indicar cuántas filas cambiaron. La publicación lo envía como teléfono elegido, que v3 ya valida.

#### Scenario: Segundo teléfono
- **WHEN** una fila tiene `telefono_1` marcado sin WhatsApp y `telefono_2` sin marca
- **THEN** "Teléfono a enviar" muestra `telefono_2` y la nota indica 1 fila con teléfono cambiado

### Requirement: Aviso en la vista previa de carga de Contactos
En la vista previa de una carga (v3 o v4), ANA Admin SHALL consultar el registro con el teléfono de cada fila válida y mostrar cuántas filas tienen el teléfono marcado sin WhatsApp. El aviso MUST NOT bloquear la carga y un fallo de la consulta MUST NOT impedirla.

#### Scenario: Carga con marcados
- **WHEN** la vista previa tiene 100 filas válidas y 7 teléfonos marcados sin WhatsApp
- **THEN** muestra "7 contactos con teléfono marcado sin WhatsApp" y el botón de enviar sigue habilitado
