# Spec Delta

## Purpose

Permitir que la publicación del agente elija a qué teléfono enviar y que nunca se envíen asignaciones antiguas.

## ADDED Requirements

### Requirement: Modo de teléfono en la publicación
`POST /agent/assignments/{campaign}/publish` SHALL aceptar `phoneMode` (`"first"` o `"all"`; ausente ⇒ `"all"`) y respetar el orden de `phoneColumns`. Con `"first"` MUST generar un solo mensaje por crédito al primer teléfono válido en ese orden; con `"all"` uno por teléfono válido sin repetir crédito+teléfono. Un `phoneMode` distinto MUST responder 400 "Modo de teléfono inválido". El manifiesto MUST registrar `phoneMode`.

#### Scenario: Primer teléfono válido
- **WHEN** se publica con `phoneMode: "first"`, `phoneColumns: ["telefono_2","telefono_1"]` y la fila tiene ambos válidos
- **THEN** se publica un mensaje a `telefono_2`

#### Scenario: Cliente anterior sin phoneMode
- **WHEN** el payload no incluye `phoneMode`
- **THEN** se publica un mensaje por cada teléfono válido, como antes

### Requirement: Teléfono elegido por fila
La publicación SHALL aceptar `overrides` opcional `{rowKey: phone}` (`rowKey` = `<source key>#<índice de fila>`) y enviar esa fila solo a ese teléfono. MUST responder 400 si el teléfono no es uno de los teléfonos válidos de esa fila en las columnas elegidas ("El teléfono elegido no pertenece a la fila N"), si la fila no está seleccionada o si el formato es inválido.

#### Scenario: Override ajeno a la fila
- **WHEN** un override apunta a un teléfono que no está en la fila
- **THEN** la respuesta es 400 y no se escribe nada

### Requirement: Antigüedad máxima de asignaciones
`GET /agent/assignments/{campaign}` MUST NOT listar archivos pendientes con más de 90 días (fecha del key; si no es válida, `LastModified`) y `/publish` MUST rechazar con 400 "Asignación con más de 3 meses" cualquier fuente más antigua, sin escribir nada.

#### Scenario: Archivo de hace 4 meses
- **WHEN** el agente publica un archivo cuyo key indica una fecha de hace 120 días
- **THEN** la respuesta es 400 "Asignación con más de 3 meses"

#### Scenario: Listado
- **WHEN** hay un archivo de hace 10 días y otro de hace 100 días
- **THEN** el listado solo incluye el de 10 días
