# automated-sending Specification

## Purpose
Describe el envío automático de mensajes de cobranza por WhatsApp Web que realiza el CLI v3 (`v3/cli-whatsapp`): consulta periódica de asignaciones al backend, parseo del CSV de contactos, interpolación de plantillas, envío con pausas aleatorias y lotes, detección de números sin WhatsApp, limpieza de pendientes en el servidor y archivos de resultados. El registro de interacciones en el CRM se describe en `crm-interactions`.

## Requirements

### Requirement: Polling de asignaciones
Tras inicializar las ventanas, el CLI SHALL consultar en un ciclo infinito `GET {API_BASE_URL}/get/chats/{agent_id}/{campaign}` (valores URL-encoded de `.agent-config.json`), con `API_BASE_URL` igual a `ANA_API_URL` o, por defecto, `https://ow24p7ablb.execute-api.us-east-1.amazonaws.com`. La respuesta exitosa MUST interpretarse como CSV; un 404, otro estado no exitoso o un error de red SHALL tratarse como cero contactos.

#### Scenario: Hay asignaciones
- **WHEN** el backend responde 200 con un CSV de N filas válidas
- **THEN** el CLI imprime "CICLO k: N contactos" y procesa los N contactos en orden

#### Scenario: Error del backend
- **WHEN** el backend responde 500
- **THEN** el CLI registra el estado y cuerpo de la respuesta y trata el ciclo como sin contactos

### Requirement: Intervalo de polling
Cuando un poll no devuelve contactos, y también al terminar un ciclo con contactos, el CLI SHALL esperar 30 segundos con cuenta regresiva antes del siguiente poll. El ciclo MUST continuar indefinidamente hasta que el proceso se cierre.

#### Scenario: Sin asignaciones
- **WHEN** el backend responde 404 o un CSV sin filas de datos
- **THEN** el CLI imprime "No hay contactos asignados." y espera 30 segundos antes de volver a consultar

### Requirement: Consumo de la lista de pendientes
Al terminar de procesar todos los contactos de un ciclo, el CLI SHALL hacer `POST {API_BASE_URL}/contacts/pending` con cuerpo `{campaign, agent_id, contacts: []}` para vaciar la lista de pendientes del agente, de modo que cada asignación se procese una sola vez. Si la llamada falla, MUST registrar "Error al actualizar contactos pendientes" y continuar.

#### Scenario: Ciclo completado
- **WHEN** el CLI termina de procesar todos los contactos del ciclo
- **THEN** envía `contacts: []` a `/contacts/pending`
- **AND** el siguiente poll no devuelve esos contactos

#### Scenario: Cierre a mitad de ciclo
- **WHEN** el agente cierra el CLI después de enviar 5 de 10 contactos
- **THEN** la lista de pendientes no se vacía y los 10 contactos se reciben en el siguiente arranque

> Nota: `LIMITE-MENSAJES.md` describe enviar los contactos restantes a `/contacts/pending` al alcanzar el límite del lote; el código actual solo envía la lista vacía al final del ciclo.

### Requirement: Parseo del CSV de contactos
El CLI SHALL parsear el CSV respetando campos entre comillas dobles (con comas, saltos de línea y comillas escapadas `""`) y recortando espacios de cada valor. La primera fila MUST tomarse como encabezados; las filas con menos valores que encabezados SHALL descartarse, y un CSV con menos de dos filas SHALL producir cero contactos.

#### Scenario: Mensaje con comas y saltos de línea
- **WHEN** la columna `message` contiene texto entre comillas con comas y saltos de línea
- **THEN** el mensaje completo se asigna a un único contacto sin partir la fila

#### Scenario: Fila incompleta
- **WHEN** una fila tiene menos valores que encabezados
- **THEN** esa fila no genera contacto

### Requirement: Mapeo de columnas del CSV
El CLI SHALL mapear columnas a campos del contacto así: `phone_number`, `contact_phone`, `contact_pho` y `phone` → `phone`; `contact_name` y `name` → `name`; `credit`, `credito`, `credit_id` e `id_credito` → `credit`. Las columnas `first_name`, `last_name`, `message`, `discount`, `total_balance`, `product` y cualquier otra MUST conservarse con su nombre original.

#### Scenario: Columna de crédito alternativa
- **WHEN** el CSV trae la columna `id_credito`
- **THEN** el contacto expone su valor como `credit`

#### Scenario: Columna personalizada
- **WHEN** el CSV trae la columna `fecha_limite`
- **THEN** el contacto expone `fecha_limite` con el mismo nombre para usarla en la plantilla

### Requirement: Interpolación de variables con llaves simples
Al parsear el CSV, el CLI SHALL reemplazar en `message` cada marcador `{variable}` (caracteres de palabra) por, en orden: el campo mapeado del contacto con ese nombre (excepto `message`), la columna original con ese nombre, o la primera columna cuyo nombre contenga el texto de la variable. Si no hay coincidencia, el marcador MUST quedar sin cambios.

#### Scenario: Variable simple
- **WHEN** el mensaje es `Hola {first_name}` y la columna `first_name` vale `Ana`
- **THEN** el mensaje a enviar es `Hola Ana`

#### Scenario: Coincidencia parcial
- **WHEN** el mensaje contiene `{cliente}` y existe la columna `nombre_cliente`
- **THEN** el marcador se reemplaza con el valor de `nombre_cliente`

#### Scenario: Variable inexistente
- **WHEN** el mensaje contiene `{foo}` y ninguna columna coincide
- **THEN** el texto `{foo}` se envía literal

#### Scenario: Marcador con llaves dobles
- **WHEN** el mensaje contiene `{{name}}` y la columna `name` vale `Juan`
- **THEN** esta pasada deja el texto como `{Juan}`, que se envía así

> Nota: el último escenario es un defecto (`agent-config.js:400`): la pasada de llaves simples actúa sobre el interior de `{{variable}}`. Las expresiones matemáticas con llaves dobles no se ven afectadas porque contienen caracteres no alfanuméricos.

### Requirement: Variables estándar con llaves dobles
Antes de enviar, el CLI SHALL reemplazar `{{phone}}`, `{{name}}`, `{{first_name}}`, `{{last_name}}`, `{{credit}}`, `{{discount}}` y `{{product}}` por los campos homónimos del contacto, y `{{total_balance}}` y `{{total_balanc}}` por el campo `total_balanc`; un campo ausente MUST reemplazarse por cadena vacía.

#### Scenario: Producto
- **WHEN** la plantilla contiene `{{product}}` y el contacto no tiene `product`
- **THEN** el marcador se reemplaza por cadena vacía

> Nota: el CSV del backend produce `total_balance`, no `total_balanc`, por lo que `{{total_balance}}` simple quedaría vacío (`message-utils.js:18`).

### Requirement: Expresiones matemáticas en plantillas
Cada `{{expr}}` restante que contenga `+ - * / ( ) ^ %` SHALL evaluarse como expresión numérica, sustituyendo nombres de columna por su valor numérico (coma decimal convertida a punto). Si el resultado es un número finito, MUST insertarse como entero o con 2 decimales; si no es evaluable, el marcador se reemplaza por la columna de nombre exacto si existe o se deja sin cambios.

#### Scenario: Descuento calculado
- **WHEN** el mensaje contiene `{{total_balance * 0.5}}` y `total_balance` vale `1000`
- **THEN** se envía `500`

#### Scenario: Resultado decimal
- **WHEN** el mensaje contiene `{{total_balance / 3}}` y `total_balance` vale `100`
- **THEN** se envía `33.33`

#### Scenario: Expresión no evaluable
- **WHEN** el mensaje contiene `{{saldo_x * 2}}` y no existe la columna `saldo_x`
- **THEN** el marcador `{{saldo_x * 2}}` se envía sin cambios

### Requirement: Saltos de línea literales
Después de interpolar, el CLI SHALL convertir cada secuencia literal `\n` del mensaje en un salto de línea real, y el texto MUST escribirse en WhatsApp conservando esos saltos de línea dentro de un único mensaje.

#### Scenario: Plantilla de varias líneas
- **WHEN** el mensaje contiene la secuencia `\n`
- **THEN** el texto enviado tiene un salto de línea real en esa posición

### Requirement: Apertura del chat del contacto
Para cada contacto, el CLI SHALL extraer solo los dígitos de `phone` y abrir `https://web.whatsapp.com/send?phone=<dígitos>` en la ventana de automatización (timeout 30 s y espera adicional de 3 s), sin añadir código de país. Mientras procesa el contacto, MUST mostrar un overlay "Enviando Mensaje — Por favor espera..." que se retira al terminar.

#### Scenario: Contacto sin teléfono
- **WHEN** el campo `phone` del contacto está vacío o no tiene dígitos
- **THEN** no se abre ningún chat y el resultado es `status: error` con "Contacto sin teléfono (phone vacío o no mapeado desde CSV)"

#### Scenario: Teléfono de 10 dígitos
- **WHEN** el teléfono es `5512345678`
- **THEN** se abre `https://web.whatsapp.com/send?phone=5512345678` sin anteponer `52`

### Requirement: Escritura y envío del mensaje
El CLI SHALL esperar hasta 30 s el cuadro de mensaje, enfocarlo, insertar el texto completo de una vez, reintentar la inserción una vez si quedó vacío y enviarlo con el botón Enviar o, si no existe, con Enter. El resultado MUST incluir `status` (`sent`, `no_whatsapp` o `error`), `error`, `sent_at` (ISO) y `response`; los envíos exitosos SHALL incluir `message_sent`.

#### Scenario: Envío exitoso
- **WHEN** el chat abre correctamente y el mensaje se escribe
- **THEN** el mensaje se envía y el resultado tiene `status: sent` y `message_sent` con el texto final

#### Scenario: No aparece el cuadro de mensaje
- **WHEN** el cuadro de mensaje no aparece en 30 s y no hay modal de número inválido
- **THEN** el resultado es `status: error` con "No se encontró el cuadro de mensaje en WhatsApp"

### Requirement: Detección de números sin WhatsApp
El CLI SHALL marcar un contacto como `status: no_whatsapp` con error "No tiene WhatsApp" cuando aparezca el texto "El número de teléfono compartido a través de la dirección URL no es válido." (espera hasta 8 s) o un diálogo cuyo texto o `aria-label` indique "no está en WhatsApp", "not on WhatsApp", "isn't on WhatsApp" o "phone number shared via url is invalid". La detección MUST repetirse si falla la espera o el clic del cuadro de mensaje o el pegado de media.

#### Scenario: Número no registrado
- **WHEN** WhatsApp Web muestra el modal de número inválido tras abrir el chat
- **THEN** el mensaje no se envía y el resultado es `status: no_whatsapp`

#### Scenario: Modal tardío
- **WHEN** el cuadro de mensaje no aparece en 30 s y entonces se detecta el modal de número inválido
- **THEN** el resultado es `status: no_whatsapp` en lugar de `error`

### Requirement: Envío de media por portapapeles
Con el modo `--clipboard-media` activo, el CLI SHALL, antes de escribir el texto, enfocar el cuadro de mensaje, pegar con Ctrl+V el contenido del portapapeles, esperar 1.5 s y enviarlo con Enter. Si el pegado falla y se detecta número inválido, el resultado MUST ser `no_whatsapp`; si falla por otra causa, SHALL registrar la advertencia y enviar solo el texto. No hay otro origen de media en el flujo automático.

#### Scenario: Imagen en portapapeles
- **WHEN** el modo está activo y el agente tiene una imagen copiada
- **THEN** cada contacto recibe primero la imagen y después el mensaje de texto

### Requirement: Ritmo de envío aleatorio
Entre un contacto y el siguiente dentro de un ciclo (no después del último), el CLI SHALL esperar un retraso aleatorio con distribución normal de media 70 s y desviación 10 s, MUST acotarlo al rango 30–120 s.

#### Scenario: Espera entre contactos
- **WHEN** se termina de procesar un contacto que no es el último del ciclo
- **THEN** el CLI imprime "Esperando Ns antes del siguiente contacto" con N entre 30 y 120 y espera ese tiempo

### Requirement: Pausa por lote de mensajes
El CLI SHALL contar cada contacto procesado, sin importar su estado, y al llegar a 20 desde la última pausa MUST pausar 30 minutos con cuenta regresiva "Fin de pausa" en consola y en las tres ventanas. El contador se reinicia tras la pausa y se conserva entre ciclos de polling.

#### Scenario: Se alcanza el límite
- **WHEN** se procesa el contacto número 20 desde la última pausa
- **THEN** tras el retraso aleatorio correspondiente el CLI pausa 30 minutos y luego reinicia el contador

#### Scenario: Límite repartido entre ciclos
- **WHEN** un ciclo procesa 15 contactos y el siguiente ciclo procesa 10
- **THEN** la pausa ocurre después del quinto contacto del segundo ciclo

> Nota: el mensaje de consola dice "Pausando 20 minutos" aunque la pausa real es de 30 minutos (`index.js:629` vs `index.js:426`). `LIMITE-MENSAJES.md` documenta 45 mensajes y 2 horas, valores que ya no corresponden al código.

### Requirement: Bloqueo de ventanas durante la pausa
Durante la pausa por lote, el CLI SHALL cubrir las ventanas de automatización y monitor con una capa semitransparente que bloquea los clics, y MUST retirarla al terminar la pausa. La ventana manual SHALL permanecer usable durante la pausa.

#### Scenario: Agente durante la pausa
- **WHEN** el CLI está en pausa por lote
- **THEN** el agente no puede hacer clic en las ventanas de automatización ni monitor pero sí responder en la ventana manual

### Requirement: Registro de interacción por contacto
Después de cada intento de envío, independientemente de su resultado, el CLI SHALL registrar una interacción en el CRM según la especificación `crm-interactions`. Un fallo en ese registro MUST NOT detener el ciclo de envío.

#### Scenario: Falla el CRM
- **WHEN** el endpoint de interacciones responde con error
- **THEN** el CLI registra el error y continúa con el siguiente contacto

### Requirement: Archivos de resultados locales
Al final de cada ciclo, el CLI SHALL sobrescribir `<directorio de datos>/resultados.csv` con todos los resultados acumulados desde que inició el proceso, columnas `phone,name,first_name,last_name,credit,discount,total_balanc,product,status,error,sent_at,response`. Si hay resultados con `response` no vacía, MUST escribir también `respuestas.csv` con `phone,name,sent_at,response`.

#### Scenario: Fin de ciclo
- **WHEN** termina un ciclo
- **THEN** `resultados.csv` contiene una fila por cada contacto procesado en todos los ciclos de la ejecución actual

#### Scenario: Reinicio del CLI
- **WHEN** el CLI se reinicia y completa un nuevo ciclo
- **THEN** `resultados.csv` se sobrescribe solo con los resultados de la nueva ejecución

> Nota: el CLI no espera respuestas tras enviar (`waitForResponse` = 0), por lo que `response` queda vacía y `respuestas.csv` no se genera en la práctica. La documentación (`README.md`, `INICIO_RAPIDO.md`) describe un flujo antiguo con `contactos.csv` y `mensaje.txt` locales que el CLI ya no usa.

### Requirement: Sin respaldo automático de chats
El flujo de envío automático MUST NOT generar respaldos de chats; al final de cada ciclo el CLI SHALL imprimir "Backup automático desactivado (solo manual)".

#### Scenario: Fin de ciclo sin backup
- **WHEN** termina un ciclo de envío
- **THEN** no se llama al endpoint de backups y se imprime el aviso
