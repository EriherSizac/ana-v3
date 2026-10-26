# job-processing Specification

## Purpose
Describe el procesamiento de send-jobs en el proceso main de la app de escritorio v4: consulta periódica de los jobs del operador, vista "Mi asignación" para revisar, filtrar, seleccionar y aprobar envíos (con plantilla editable), envío automático de jobs directos, ritmo anti-bloqueo, resolución del número en WhatsApp, simulación de escritura, acuse por job, reporte de la interacción al CRM, borrado del CSV de origen y progreso flotante. La interpolación de plantillas se describe en `v4/template-interpolation`; las rutas `/jobs/*`, `/interactions/report` y `/uploads/delete` pertenecen al backend.

> Nota: el ritmo de envío y la lista de envíos recientes viven solo en memoria: al reiniciar la app la ventana de 20 minutos empieza vacía. Si la app se cierra o actualiza entre el envío de WhatsApp y el acuse, el job sigue pendiente en el backend y puede volver a enviarse al mismo contacto en la siguiente aprobación.

## Requirements

### Requirement: Consulta periódica de jobs
Con token presente y sin envío en curso, el poller SHALL consultar `GET /jobs/poll` cada 5 segundos (esperando 2 s si no hay token o hay envío en curso) y publicar al renderer todos los jobs del operador, pendientes e historial. Una respuesta no exitosa MUST tratarse como lista vacía; un error de red se ignora hasta el siguiente ciclo. El poller se detiene al cerrar sesión o salir.

#### Scenario: Jobs nuevos
- **WHEN** el líder reparte contactos al agente
- **THEN** en máximo 5 segundos aparecen en "Mi asignación"

#### Scenario: Respuesta 401
- **WHEN** el backend rechaza el token del poller
- **THEN** la asignación publicada queda vacía y la vista muestra "Sin contactos pendientes"

> Nota: como el main no renueva el ID token (ver `v4/desktop-auth`), tras su expiración la asignación del agente aparece vacía sin ningún aviso de error.

### Requirement: Vista Mi asignación
La vista SHALL mostrar pestañas "Pendientes (N)" (jobs no directos con estado pendiente, arrendado o sin estado) y "Enviados (N)" (enviado, sin WhatsApp o error, más reciente primero) con columnas Nombre, Crédito, Teléfono enmascarado y, en historial, Resultado ("Enviado", "Sin WhatsApp", "Error"). Al montarse MUST hidratarse con la última asignación del main sin esperar al siguiente ciclo.

#### Scenario: Sin pendientes
- **WHEN** el agente no tiene jobs pendientes
- **THEN** se muestra "Sin contactos pendientes. Cuando tu líder reparta una campaña (o subas un CSV propio), aparecerán aquí."

#### Scenario: Historial
- **WHEN** el agente abre "Enviados"
- **THEN** ve cada contacto procesado con su resultado y sin casillas de selección

### Requirement: Búsqueda y selección
La búsqueda SHALL filtrar por nombre, crédito (`credit`, `credito`, `credit_id`, `id_credito`) o, con al menos 2 dígitos, por dígitos del teléfono. Todo job nuevo MUST quedar seleccionado por defecto y la selección se conserva entre ciclos. La casilla general marca o desmarca solo lo filtrado; clic en la fila alterna la selección.

#### Scenario: Búsqueda por últimos dígitos
- **WHEN** el agente escribe "1922"
- **THEN** la tabla muestra solo los contactos cuyo teléfono contiene esos dígitos

#### Scenario: Sin coincidencias
- **WHEN** la búsqueda no encuentra nada
- **THEN** se muestra "Sin coincidencias para “<texto>”."

> Nota: la selección conserva ids de jobs ya enviados, por lo que el contador "seleccionados/pendientes" puede exceder el total de pendientes.

### Requirement: Aprobación de envío
El agente SHALL aprobar con "Enviar a N contacto(s)", deshabilitado sin selección, sin mensaje o con envío en curso. La plantilla por defecto MUST ser la del primer job y se reemplaza al editarla; si el job no trae plantilla se marca "(obligatorio: el líder no fijó uno)". La plantilla mostrada SHALL enviarse siempre como reemplazo para todos los seleccionados. Solo se envían jobs aún pendientes.

#### Scenario: Aprobación exitosa
- **WHEN** el agente selecciona 10 contactos y pulsa enviar
- **THEN** se muestra "Envío iniciado." y lo no seleccionado queda pendiente

#### Scenario: Envío ya en curso
- **WHEN** se aprueba mientras otro lote se envía
- **THEN** se muestra "Error: Ya hay un envío en curso"

#### Scenario: Selección ya procesada
- **WHEN** ninguno de los seleccionados sigue pendiente
- **THEN** se muestra "Error: Sin envíos seleccionados"

> Nota: con jobs de varios archivos o plantillas, la del primer job reemplaza a todas. La plantilla editada no se valida contra las columnas; un campo inexistente se envía vacío.

### Requirement: Jobs directos sin aprobación
Los jobs marcados como directos que sigan pendientes SHALL enviarse automáticamente en cada ciclo sin aprobación ni reemplazo de plantilla, y MUST NOT mostrarse en la pestaña "Pendientes".

#### Scenario: Envío directo
- **WHEN** el backend crea jobs directos para el agente
- **THEN** se envían solos con el mismo ritmo y aparecen después en "Enviados"

### Requirement: Ritmo anti-bloqueo
Los envíos SHALL agruparse por archivo de origen, un archivo a la vez y en orden de aparición. Antes de cada job MUST esperarse al menos 2 minutos desde el anterior y no superar 7 envíos en cualquier ventana de 20 minutos; durante la espera se emite cada segundo la fase `waiting` con el tiempo restante. Todo intento, exitoso o fallido, cuenta para el ritmo.

#### Scenario: Octavo mensaje
- **WHEN** ya se enviaron 7 mensajes en los últimos 20 minutos
- **THEN** el siguiente espera a que el más antiguo salga de la ventana

#### Scenario: Gap mínimo
- **WHEN** acaba de enviarse un mensaje
- **THEN** el siguiente no sale antes de 2 minutos

### Requirement: Envío de un job
Para cada job el main SHALL normalizar el teléfono con la lada del job y resolver el número real con WhatsApp; si no existe, el resultado es "No tiene WhatsApp". Si existe, MUST interpolar la plantilla con la fila, mostrar "escribiendo…" entre 2 y 9 segundos (70 ms por carácter), enviar, persistir el mensaje en `PUT /messages` y los datos del contacto en `PUT /conversations/meta`.

#### Scenario: Número sin WhatsApp
- **WHEN** WhatsApp no reconoce el número
- **THEN** el job queda como `no_whatsapp` y no se envía nada

#### Scenario: WhatsApp desconectado a media campaña
- **WHEN** el cliente se desconecta durante un lote
- **THEN** cada job restante falla con "WhatsApp no conectado", queda como `error` y se espacia por el ritmo

### Requirement: Acuse, reporte y limpieza
Tras cada job el main SHALL enviar `POST /jobs/ack` con estado `sent`, `no_whatsapp` o `error`, y reportar sin bloquear a `POST /interactions/report` con job, campaña, teléfono, estado y fila. Al terminar un archivo, si no quedan jobs pendientes de él, MUST pedir `POST /uploads/delete` del CSV. Fallos de acuse, reporte o borrado se ignoran.

#### Scenario: Lote completo
- **WHEN** se procesan todos los jobs de un archivo
- **THEN** cada job queda marcado con su resultado, el CRM recibe cada interacción y el CSV se borra de S3

### Requirement: Progreso del envío
El main SHALL emitir progreso con fases `idle`, `sending`, `waiting` y `fileDone`, con total, hechos, enviados, fallidos, tiempo de espera y último teléfono. Una tarjeta flotante MUST mostrarse en cualquier pestaña con "Enviando", "En pausa" o "Lote completado", la barra, "Enviados", "Fallidos", "Pausa anti-bloqueo · siguiente en Xm Ys" y "Último: <teléfono>"; se puede ocultar y reaparece con el siguiente lote.

#### Scenario: Pausa visible
- **WHEN** el envío espera por el ritmo
- **THEN** la tarjeta muestra "En pausa" y la cuenta regresiva

> Nota: la tarjeta flotante muestra el teléfono completo del último envío, sin enmascarar, a diferencia de las tablas.
