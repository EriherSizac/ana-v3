# Spec Delta

## ADDED Requirements

### Requirement: Columna reservada ana_upload_id
En v3 la página SHALL rechazar antes de la vista previa un CSV cuyo encabezado contenga `ana_upload_id` (sin distinguir mayúsculas) con "La columna ana_upload_id está reservada", y MUST marcar como error una variable `{var}` del mensaje que no resuelve contra ninguna otra columna pero sí, por coincidencia parcial, contra `ana_upload_id` (p. ej. `{upload}`).

#### Scenario: CSV con la columna reservada
- **WHEN** el líder carga para v3 un CSV con columna `ana_upload_id`
- **THEN** la página muestra "La columna ana_upload_id está reservada" y no permite continuar

#### Scenario: Variable que tomaría el identificador
- **WHEN** el mensaje usa `{upload}` y ninguna columna del CSV contiene `upload`
- **THEN** la página muestra "Variable desconocida: {upload}" y deshabilita la vista previa

### Requirement: Contactos por revisar en el detalle de una carga
El detalle de una carga v3 (`/contactos/historial/{uploadId}`) SHALL mostrar, por agente del manifiesto, los contactos por revisar de esa carga (`GET .../review-items?uploadId=`) con teléfono, nombre si existe, `assignmentId`, estado y quién/cuándo, con Skeleton mientras carga y "Sin contactos por revisar" si no hay. Las cargas v4 MUST NOT mostrar la sección.

#### Scenario: Carga con contactos interrumpidos
- **WHEN** la carga `U1` tiene 2 contactos por revisar de `ana.lopez` y ninguno de `luis`
- **THEN** el detalle muestra 2 en `ana.lopez` en estado "Pendiente de revisión" y "Sin contactos por revisar" en `luis`

#### Scenario: Contacto ya reasignado
- **WHEN** un contacto está `reassigned` a `luis` en la carga `U9`
- **THEN** la fila muestra "Reasignado a luis", autor, fecha y enlace al detalle de `U9`

### Requirement: Reasignar contactos por revisar
Con contactos pendientes seleccionados, la página SHALL ofrecer "Reasignar" con un selector con búsqueda de agentes habilitados v3 de la campaña; reutiliza el flujo de carga en modo "Asignar a un agente" con las filas originales (sin `ana_upload_id`), su vista previa y `ConfirmDialog` que advierte confirmar en WhatsApp que el mensaje no salió. Tras la carga, MUST marcar los contactos como reasignados.

#### Scenario: Reasignación exitosa
- **WHEN** el líder reasigna 2 contactos de `ana.lopez` a `luis` y confirma
- **THEN** se crea una carga nueva `single` a `luis` con 2 filas y `source` de esos contactos, y ambos quedan "Reasignado a luis"

#### Scenario: Marcado fallido tras la carga
- **WHEN** la carga nueva termina `completed` pero el marcado responde error de red
- **THEN** la página reintenta el marcado con el mismo `reassignUploadId` y, si sigue fallando, muestra "Carga entregada; reintenta marcar como reasignados" sin crear otra carga

### Requirement: Descartar contactos por revisar
La página SHALL permitir descartar contactos pendientes seleccionados (p. ej. el mensaje sí salió) con un `ConfirmDialog` destructivo; el resultado MUST reflejar el estado devuelto por el backend o el error inline.

#### Scenario: Descartar un contacto
- **WHEN** el líder descarta un contacto pendiente y confirma
- **THEN** la fila muestra "Descartado", autor y fecha

### Requirement: Contactos por revisar sin carga asociada
El historial v3 SHALL ofrecer una vista "Por revisar sin carga asociada" (`uploadId=none`) con las mismas acciones de reasignar y descartar, para filas de cargas hechas fuera de ANA Admin o antes de la columna `ana_upload_id`.

#### Scenario: Fila de una carga por curl
- **WHEN** existe una fila por revisar sin `ana_upload_id`
- **THEN** aparece en "Por revisar sin carga asociada" y no en el detalle de ninguna carga
