# Spec Delta

## Purpose

Guiar al agente en "Mi asignación" con un asistente, ordenar y filtrar sus contactos y elegir a qué teléfono enviar.

## ADDED Requirements

### Requirement: Asistente de asignación
"Mi asignación" SHALL presentarse como asistente de 4 pasos ("Archivo de asignación", "Contactos", "Mensaje", "Resumen y envío") con stepper (actual/completado), Atrás/Siguiente y Siguiente deshabilitado hasta que el paso sea válido; volver atrás MUST conservar el estado. El borrador SHALL guardarse por campaña en `sessionStorage` (con try/catch) y restaurarse tras recargar si los archivos no cambiaron.

#### Scenario: Volver sin perder trabajo
- **WHEN** el agente está en "Mensaje" y pulsa Atrás
- **THEN** ve "Contactos" con sus filtros, selección y modo de teléfono intactos

#### Scenario: Mensaje con variable desconocida
- **WHEN** la plantilla usa una variable que no existe en los archivos
- **THEN** Siguiente queda deshabilitado y se marca la variable

### Requirement: Archivos de hasta 3 meses
El paso "Archivo de asignación" SHALL ofrecer solo archivos de 90 días o menos (fecha, filas, upload id), preseleccionar el más reciente y permitir combinar varios; los más antiguos MUST ocultarse.

#### Scenario: Archivo antiguo
- **WHEN** existe un pendiente de hace 100 días
- **THEN** no se ofrece y se indica cuántos se ocultaron

### Requirement: Ordenar contactos
La tabla de contactos SHALL ordenarse por cualquier columna: clic en el encabezado alterna asc/desc con `aria-sort`, orden numérico para montos y por fecha para `dd/mm/yyyy`.

#### Scenario: Ordenar saldo
- **WHEN** el agente pulsa el encabezado `saldo_vencido_actual`
- **THEN** las filas quedan en orden numérico ascendente y al pulsar de nuevo descendente

### Requirement: Filtrar contactos
La tabla SHALL ofrecer la barra de filtros de `docs/design-system.md` §7.1: búsqueda, `SearchableMultiselect` para `segmento_credito`, `estatus_credito`, `tramo_vencido` y `ultimo_resultado` cuando existan, rango min/max para columnas de monto, "Limpiar filtros" y `FilterPill` por filtro. "Seleccionar todos" MUST seleccionar todas las filas filtradas. Filtros y orden SHALL persistirse por campaña en `localStorage` (con try/catch).

#### Scenario: Seleccionar filtrados
- **WHEN** filtra `segmento_credito` = "A" y pulsa "Seleccionar todos los resultados"
- **THEN** quedan seleccionadas solo las filas del segmento "A"

### Requirement: Teléfono a enviar
El paso "Contactos" SHALL ofrecer el modo "Primer teléfono válido" (por defecto; columnas ordenables, por defecto `telefono_1`, `telefono_2`, `telefono_3`; un mensaje por crédito) y "Todos los seleccionados"; la tabla MUST mostrar la columna "Teléfono a enviar" enmascarada y permitir, por fila con varios teléfonos válidos, elegir uno en un selector con búsqueda. Modo, orden y overrides MUST enviarse explícitos en la publicación y la vista previa MUST coincidir con lo que publica el servidor.

#### Scenario: Override por fila
- **WHEN** el agente elige `telefono_3` para una fila
- **THEN** la publicación envía `overrides` con el `rowKey` de esa fila y su mensaje sale a ese teléfono

### Requirement: Resumen y envío
El paso "Resumen y envío" SHALL mostrar campaña, archivos, contactos seleccionados, mensajes a enviar (tras modo de teléfono y duplicados), modo de teléfono, filas excluidas por motivo y 3 mensajes de muestra; "Enviar" MUST pedir `ConfirmDialog` y, al terminar, mostrar el id de publicación con enlace al historial. Un 409 o 400 de antigüedad MUST regresar al paso 1 con el mensaje.

#### Scenario: Conteo igual al publicado
- **WHEN** el resumen indica 12 mensajes y el agente confirma
- **THEN** la publicación reporta 12 mensajes publicados
