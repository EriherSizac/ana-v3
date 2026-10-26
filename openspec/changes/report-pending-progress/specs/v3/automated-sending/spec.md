# Spec Delta

## MODIFIED Requirements

### Requirement: Consumo de la lista de pendientes
Después de procesar cada contacto de una asignación, el CLI SHALL hacer `POST {API_BASE_URL}/contacts/pending` con `{campaign, agent_id, contacts}`, donde `contacts` son las filas originales del CSV (columnas y valores tal como llegaron) de los contactos aún pendientes, en su orden; al terminar la asignación `contacts` MUST ser `[]`. Si una llamada falla, el CLI MUST registrar "Error al actualizar contactos pendientes" y continuar sin reintentar.

#### Scenario: Ciclo completado
- **WHEN** el CLI termina de procesar todos los contactos del ciclo
- **THEN** envía `contacts: []` a `/contacts/pending`
- **AND** el siguiente poll no devuelve esos contactos

#### Scenario: Progreso dentro del ciclo
- **WHEN** el CLI termina el contacto 3 de una asignación de 10
- **THEN** envía a `/contacts/pending` las filas originales de los contactos 4 a 10

#### Scenario: Cierre a mitad de ciclo
- **WHEN** el agente cierra el CLI después de procesar 5 de 10 contactos
- **THEN** `chats/{agent_id}-{campaign}.csv` contiene las filas de los 5 contactos restantes
- **AND** el servidor no vuelve a entregar la asignación, porque ya la consumió

#### Scenario: Falla el reporte
- **WHEN** `/contacts/pending` responde con error tras un contacto
- **THEN** el CLI registra el error y continúa con el siguiente contacto

## ADDED Requirements

### Requirement: Registro local de la asignación en curso
Al recibir una asignación con contactos y antes del primer envío, el CLI SHALL guardar en su directorio de datos, en un archivo por agente y campaña, el CSV recibido y el estado de cada contacto (`pendiente`, `en curso`, `procesado`, `por revisar`). MUST marcar `en curso` antes de abrir el chat y `procesado` al obtener el resultado, y cada escritura MUST ser atómica para que un cierre no deje el archivo corrupto.

#### Scenario: Asignación recibida
- **WHEN** el poll devuelve una asignación de 10 contactos
- **THEN** antes de enviar el primer mensaje existe el registro local con los 10 contactos en `pendiente`

#### Scenario: Contacto procesado
- **WHEN** termina el envío al contacto 4 con cualquier estado (`sent`, `no_whatsapp` o `error`)
- **THEN** el registro local marca el contacto 4 como `procesado`

#### Scenario: Cierre durante una escritura
- **WHEN** el proceso termina mientras actualiza el registro
- **THEN** el registro conserva su versión anterior completa o la nueva, nunca un contenido parcial

### Requirement: Reanudación de la asignación tras un cierre
Al iniciar el ciclo de envío y antes del primer poll, si existe un registro local para el agente y campaña configurados con contactos `pendiente`, el CLI SHALL procesar solo esos contactos, en su orden y con el mismo ritmo, pausas y registro en el CRM. Los contactos `procesado` MUST NOT reenviarse. Registros de otro agente o campaña SHALL conservarse sin procesarse.

#### Scenario: Reinicio tras cierre a mitad de ciclo
- **WHEN** el CLI se cerró tras procesar 5 de 10 contactos y el agente lo vuelve a abrir
- **THEN** el CLI imprime que reanuda la asignación con 5 contactos pendientes y envía solo los contactos 6 a 10
- **AND** los contactos 1 a 5 no reciben un segundo mensaje

#### Scenario: Registro de otra campaña
- **WHEN** existe un registro de la campaña `A` y el agente inicia sesión en la campaña `B`
- **THEN** el CLI no procesa el registro de `A`, lo deja intacto y hace poll de `B`

#### Scenario: Registro ilegible
- **WHEN** el registro local no se puede leer o su contenido no coincide con el CSV guardado
- **THEN** el CLI no envía nada de ese registro, lo renombra conservando su contenido, avisa en consola y continúa con el poll

### Requirement: Contacto interrumpido durante el envío
Si al reanudar un contacto figura `en curso`, el CLI MUST NOT reenviarle el mensaje, porque no puede saber si WhatsApp lo envió; SHALL marcarlo `por revisar`, incluirlo en `resultados.csv` con `status: por_revisar` y el error "Envío interrumpido por cierre del CLI; revisar antes de reenviar", y MUST NOT registrar interacción en el CRM para él.

#### Scenario: Cierre justo al enviar
- **WHEN** el CLI se cerró mientras enviaba al contacto 6 y se vuelve a abrir
- **THEN** el contacto 6 no recibe un mensaje nuevo y aparece en `resultados.csv` con `status: por_revisar`
- **AND** la reanudación continúa con el contacto 7

### Requirement: Reporte de contactos por revisar
En cada llamada a `/contacts/pending` de una asignación con contactos `por revisar`, el CLI SHALL incluir `review: {assignment_id, contacts}` con el identificador de la asignación del registro local y las filas originales de esos contactos, sin incluirlos en `contacts`. Si el backend ignora el campo o la llamada falla, MUST continuar igual que con el reporte de pendientes.

#### Scenario: Reporte tras reanudar
- **WHEN** al reanudar el contacto 6 queda `por revisar` y el CLI termina el contacto 7 de 10
- **THEN** envía en `contacts` las filas 8 a 10 y en `review.contacts` la fila 6

#### Scenario: Asignación sin interrupciones
- **WHEN** ningún contacto de la asignación está `por revisar`
- **THEN** el CLI no envía el campo `review`

### Requirement: Cierre del registro local
Cuando todos los contactos del registro están `procesado` o `por revisar`, el CLI SHALL enviar `contacts: []` (con `review` si hay contactos `por revisar`) a `/contacts/pending` y después eliminar el registro local, antes de volver a consultar el servidor. El CLI MUST NOT consultar una asignación nueva mientras exista un registro con contactos pendientes para el agente y campaña configurados.

#### Scenario: Asignación terminada
- **WHEN** se procesa el último contacto pendiente
- **THEN** el registro local se elimina y el siguiente poll puede traer una asignación nueva

#### Scenario: Asignación nueva con contactos repetidos
- **WHEN** después de terminar una asignación llega otra que incluye a un deudor ya contactado
- **THEN** ese deudor recibe el mensaje de la asignación nueva, porque el registro solo evita duplicados dentro de una misma asignación
