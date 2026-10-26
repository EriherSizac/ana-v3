# campaign-upload-ui Specification

## Purpose
Describe la pestaña "Campañas" de la app de escritorio v4, visible para admin, líder o quien tenga `ana:contacts:list:upload`: carga de un CSV de contactos con columna de teléfono y lada, selección de campaña desde el backend, plantilla opcional con editor y vista previa, validación de variables contra las columnas, opción de repartir entre agentes y subida a S3 por URL prefirmada. Subir no envía mensajes: genera jobs que aparecen en "Mi asignación". El procesamiento del CSV en el backend pertenece a sus especificaciones.

> Nota: la vista previa del CSV solo reconoce coma como separador y lee los primeros 64 KB; un CSV con punto y coma muestra una sola columna.

## Requirements

### Requirement: Selección de campaña
El selector de campaña SHALL cargar opciones de `GET /agents/campaigns` y, si la lista llega vacía o falla, usar las campañas del rol del usuario excepto `*`. MUST permitir solo elegir una opción existente (escribir filtra, no fija valor) y preseleccionar la primera opción. Sin campaña el botón de subida queda deshabilitado con "Selecciona una campaña antes de subir.".

#### Scenario: Búsqueda de campaña
- **WHEN** el usuario escribe parte del nombre
- **THEN** la lista se filtra y debe elegir una opción para fijarla

#### Scenario: Sin coincidencias
- **WHEN** el texto no coincide con ninguna campaña
- **THEN** la lista muestra "Sin coincidencias."

### Requirement: Carga y lectura del CSV
Al elegir un archivo `.csv` la pantalla SHALL leer su inicio para obtener encabezados y la primera fila, normalizarla con los alias de columnas y usarlos como chips y vista previa del editor. Los campos "Columna teléfono" (por defecto `telefono`) y "Lada país" (por defecto `52`) MUST ser editables como texto libre.

#### Scenario: CSV con encabezados
- **WHEN** se carga un CSV con columnas `nombre,telefono,saldo`
- **THEN** aparecen los chips `nombre`, `telefono` y `saldo` y la vista previa usa el primer contacto

### Requirement: Plantilla opcional y validación de variables
La plantilla SHALL iniciar con "Hola {nombre}, tu saldo es {saldo}. Realiza tu pago hoy." y poder vaciarse con "Dejar vacío"; vacía, cada agente escribe el mensaje. Si la plantilla usa identificadores que no existen en las columnas del CSV ni en sus alias, MUST mostrarse la lista de variables desconocidas y bloquearse la subida.

#### Scenario: Variable desconocida
- **WHEN** la plantilla usa `{apodo}` y el CSV no tiene esa columna ni alias
- **THEN** se muestra "La plantilla usa variables que no están en el CSV: {apodo}." y "Subir contactos" queda deshabilitado

#### Scenario: Alias reconocido
- **WHEN** la plantilla usa `{saldo}` y el CSV trae `total_balance`
- **THEN** no se marca variable desconocida

### Requirement: Reparto entre agentes
Solo con `ana:contacts:list:distribute` (o admin) la pantalla SHALL mostrar "Repartir contactos entre los agentes (líder)" y, al marcarla, el aviso de reparto entre los agentes activos de la campaña. La bandera de reparto MUST enviarse verdadera solo si está marcada y el usuario tiene el permiso.

#### Scenario: Líder sin permiso de reparto
- **WHEN** un líder sin `ana:contacts:list:distribute` sube un CSV
- **THEN** no ve la opción y los contactos quedan en su propia asignación

### Requirement: Subida del CSV
"Subir contactos" SHALL pedir `POST /uploads/presign` con nombre de archivo, plantilla, lada, columna de teléfono, campaña, bandera de reparto e identificador `<archivo>-<lada>`, y MUST subir el archivo por PUT sin encabezado de tipo de contenido. Durante la subida el botón muestra "Subiendo…". Al terminar SHALL indicar a quién quedaron asignados o mostrar "Error: <mensaje>".

#### Scenario: Subida propia
- **WHEN** un usuario sin reparto sube un CSV válido
- **THEN** se muestra "CSV subido. Los contactos quedaron en tu "Mi asignación" para revisar y enviar."

#### Scenario: Subida con reparto
- **WHEN** un líder con reparto marcado sube un CSV
- **THEN** se muestra que los contactos se asignaron a los agentes de la campaña y cada uno los envía desde "Mi asignación"

#### Scenario: Falla S3
- **WHEN** la subida a S3 responde error
- **THEN** se muestra "Error: falló la subida a S3 (<código>)"

> Nota: el identificador del lote depende solo del nombre del archivo y la lada; subir dos veces el mismo archivo produce el mismo identificador.

### Requirement: Progreso de envíos en Campañas
La pantalla SHALL mostrar una barra con el progreso del envío en curso reportado por el main ("Enviando" o "Archivo completado" con el identificador, hechos/total, "Enviados", "Fallidos" y "Pausa anti-bloqueo: siguiente en Ns") mientras haya total y la fase no sea `idle`.

#### Scenario: Envío en curso
- **WHEN** el agente aprobó un lote y abre "Campañas"
- **THEN** ve la barra de progreso de ese lote
