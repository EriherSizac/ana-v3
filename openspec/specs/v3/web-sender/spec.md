# web-sender Specification

## Purpose
Aplicación web Next.js 14 de v3 (`v3/app`, `v3/lib`) que corre localmente en `http://localhost:3000` para un solo usuario y envía mensajes masivos personalizados por WhatsApp Web, automatizando un navegador Chromium visible mediante Playwright con sesión persistente en disco. Este spec documenta el comportamiento actual de la UI y de las rutas `/api/whatsapp/*`.

## Requirements

### Requirement: Página única de envío masivo
La aplicación SHALL servir en `/` una sola página cliente titulada "WhatsApp Mass Sender" (`<html lang="es">`, metadata title "WhatsApp Mass Sender") con cuatro bloques: estado de sesión, contactos, mensaje con plantilla e historial de campañas. Todo el estado de la página (contactos, mensaje, retraso, historial) MUST vivir solo en memoria del navegador, sin `localStorage` ni persistencia en servidor.

#### Scenario: Recarga de la página
- **WHEN** el usuario recarga la página después de agregar contactos o enviar campañas
- **THEN** la lista de contactos, el mensaje y el historial de campañas aparecen vacíos
- **AND** el retraso vuelve a su valor inicial de 5 segundos

#### Scenario: Estado inicial al cargar
- **WHEN** la página se monta
- **THEN** realiza `GET /api/whatsapp/status` y muestra "Estado: Conectado" o "Estado: Desconectado" según el campo `status` de la respuesta
- **AND** si la petición falla muestra "Desconectado"

### Requirement: Conexión a WhatsApp Web
El sistema SHALL abrir WhatsApp Web en un Chromium no headless (viewport 1280x720) con contexto persistente en el directorio `whatsapp-session/` relativo al directorio de trabajo del servidor, cuando el usuario pulsa "Conectar WhatsApp". El vínculo del dispositivo MUST hacerse escaneando el código QR directamente en esa ventana del navegador; la página web no muestra el QR.

#### Scenario: Primera conexión sin sesión guardada
- **WHEN** el usuario pulsa "Conectar WhatsApp" y no hay sesión vinculada
- **THEN** la UI pasa a "Conectando...", el servidor abre el navegador en `https://web.whatsapp.com`, espera carga de red más 5 segundos y responde `{ success: true, message: "Escanea el código QR para conectar" }`
- **AND** la UI espera 2 segundos, consulta `/api/whatsapp/status`, vuelve a "Desconectado" y muestra un `alert` pidiendo escanear el QR y esperar a que cargue

#### Scenario: Conexión con sesión persistida
- **WHEN** existe una sesión válida en `whatsapp-session/` y el usuario pulsa "Conectar WhatsApp"
- **THEN** el servidor responde `{ success: true, message: "Conectado a WhatsApp Web" }`
- **AND** la UI muestra "Conectado", oculta el botón de conexión y muestra un `alert` de conexión exitosa

#### Scenario: Navegador ya abierto
- **WHEN** ya existe un navegador y página activos en el proceso del servidor y se vuelve a llamar `POST /api/whatsapp/connect`
- **THEN** no se abre un navegador nuevo y la respuesta es `{ success: true, message: "Ya conectado" }` o `{ success: true, message: "Sesión activa - escanea QR si es necesario" }` según el estado detectado

#### Scenario: Fallo al lanzar el navegador
- **WHEN** ocurre un error al lanzar o navegar el navegador
- **THEN** se descartan las referencias al navegador y la ruta responde HTTP 200 con `{ success: false, message: "Error al inicializar WhatsApp" }`
- **AND** la UI muestra `alert` "Error al conectar con WhatsApp: Error al inicializar WhatsApp" y estado "Desconectado"

#### Scenario: Usuario cierra la ventana del navegador
- **WHEN** el usuario cierra la ventana de Chromium controlada
- **THEN** el servidor descarta sus referencias al navegador y las siguientes consultas de estado devuelven `disconnected`

### Requirement: Detección de estado de conexión
`GET /api/whatsapp/status` SHALL responder siempre HTTP 200 con `status` (`connected`/`disconnected`) y `debug` con `browser` y `page` (`active`/`null`) y `sessionPath` (ruta absoluta). El estado MUST ser `connected` solo si hay navegador y página activos, la URL contiene `web.whatsapp.com` y existe alguno de los selectores de sesión de WhatsApp Web (lista de chats, panel lateral o cuadro de texto).

#### Scenario: Sin navegador iniciado
- **WHEN** se consulta el estado sin haber conectado
- **THEN** la respuesta es `{ status: "disconnected", debug: { browser: "null", page: "null", sessionPath: "<ruta>" } }`

#### Scenario: QR visible
- **WHEN** el navegador muestra el código QR y ninguno de los selectores de sesión existe
- **THEN** la respuesta tiene `status: "disconnected"`

#### Scenario: Botón Verificar
- **WHEN** el usuario pulsa "Verificar" junto al indicador de estado
- **THEN** la UI vuelve a consultar `/api/whatsapp/status` y actualiza el indicador (verde Conectado, rojo Desconectado)

#### Scenario: Error inesperado
- **WHEN** la verificación lanza una excepción no controlada
- **THEN** la respuesta es HTTP 200 con `{ status: "disconnected", error: "<mensaje>" }`

### Requirement: Diagnóstico de conexión
`GET /api/whatsapp/diagnose` SHALL responder HTTP 200 con `{ success: true, diagnosis }`, donde `diagnosis` incluye `browser`, `page`, `globalBrowser`, `globalPage` (booleanos), `url` (o `null`), `elements` (mapa selector→booleano para los cinco selectores de sesión más `canvas`), `qrCode`, `browserClosed` y, cuando aplica, `pagesCount`, `qrSelector`, `browserError` o `error`. El botón "🔍 Diagnóstico" de la UI MUST presentar este resultado en un `alert` con una recomendación.

#### Scenario: Diagnóstico sin navegador
- **WHEN** el usuario pulsa "🔍 Diagnóstico" sin haber conectado
- **THEN** el `alert` muestra Browser ❌, Page ❌, URL N/A, "Total elementos: 0/0"
- **AND** la recomendación es "→ Haz clic en \"Conectar WhatsApp\""

#### Scenario: Diagnóstico con QR pendiente
- **WHEN** hay navegador abierto y existe algún elemento `canvas` en la página
- **THEN** `diagnosis.qrCode` es `true` con el `qrSelector` que coincidió
- **AND** la recomendación es "→ Escanea el código QR con tu teléfono"

#### Scenario: Diagnóstico con sesión cargada
- **WHEN** hay navegador abierto, no hay `canvas` y al menos un selector de sesión existe
- **THEN** la recomendación es "→ ✅ WhatsApp parece estar conectado!"

#### Scenario: Falla del diagnóstico
- **WHEN** el diagnóstico lanza una excepción
- **THEN** la ruta responde HTTP 200 con `{ success: false, error: "<mensaje>" }` y la UI no muestra `alert`

### Requirement: Alta manual de contactos
La UI SHALL permitir agregar un contacto con campos "Teléfono" y "Nombre" mediante el botón "Agregar". Ambos campos MUST tener texto para que se agregue; no se valida formato del teléfono.

#### Scenario: Agregar contacto válido
- **WHEN** el usuario escribe teléfono `521234567890` y nombre `Juan` y pulsa "Agregar"
- **THEN** el contacto aparece en la lista con nombre y teléfono y ambos campos se limpian

#### Scenario: Campo faltante
- **WHEN** el usuario pulsa "Agregar" con el teléfono o el nombre vacío
- **THEN** no se agrega nada y no se muestra mensaje

#### Scenario: Eliminar contacto
- **WHEN** el usuario pulsa "✕" en un contacto
- **THEN** el contacto se quita de la lista

#### Scenario: Lista vacía
- **WHEN** no hay contactos
- **THEN** la lista muestra "No hay contactos agregados"

### Requirement: Importación de contactos por CSV
La UI SHALL importar contactos desde un `.csv` ("Importar CSV con datos") separando filas por salto de línea y columnas por coma simple, sin soporte de comillas, y agregándolos a los existentes. Los encabezados MUST normalizarse con trim y minúsculas y mapearse solo a los campos conocidos; cualquier otra columna MUST ignorarse y no queda disponible para la plantilla.

#### Scenario: Alias de encabezados
- **WHEN** el CSV usa encabezados en español o alternativos
- **THEN** se mapean `contact_pho`/`phone`/`telefono`→teléfono, `name`/`nombre`, `credit`/`credito`, `discount`/`descuento`, `first_name`/`nombre_pila`, `last_name`/`apellido`, `total_balanc`/`balance`/`saldo`→`total_balanc` y `product`/`producto`

#### Scenario: CSV con columnas conocidas
- **WHEN** se importa `contact_pho,first_name,last_name,credit` con una fila `521234567890,Juan,Pérez,5000`
- **THEN** se agrega un contacto con teléfono `521234567890`, nombre `Juan Pérez` (construido de nombre y apellido) y crédito `5000`
- **AND** se muestra `alert` "1 contactos importados correctamente"

#### Scenario: Columnas adicionales no reconocidas
- **WHEN** el CSV incluye una columna `monto` además de `phone`
- **THEN** el valor de `monto` se descarta y `{{monto}}` no se reemplaza al enviar

#### Scenario: Nombre ausente
- **WHEN** una fila no tiene `name`, `first_name` ni `last_name`
- **THEN** el nombre del contacto es igual a su teléfono

#### Scenario: Filas sin teléfono
- **WHEN** una fila tiene el teléfono vacío o es una línea en blanco
- **THEN** la fila se omite

#### Scenario: Ningún contacto válido
- **WHEN** ninguna fila tiene teléfono
- **THEN** se muestra `alert` "No se encontraron contactos válidos en el CSV" y la lista no cambia

#### Scenario: Archivo sin filas de datos
- **WHEN** el archivo tiene menos de dos líneas
- **THEN** se muestra `alert` "El archivo CSV está vacío o no tiene el formato correcto"

#### Scenario: Datos extra visibles en la lista
- **WHEN** un contacto tiene `credit`, `discount`, `product` o `total_balanc`
- **THEN** su tarjeta muestra los campos presentes con etiquetas Nombre, Apellido, Crédito, Descuento, Balance y Producto

### Requirement: Composición de mensaje
La UI SHALL ofrecer un área de texto para la plantilla del mensaje y un botón "Ver variables"/"Ocultar variables" que muestra las variables `{{first_name}}`, `{{last_name}}`, `{{name}}`, `{{phone}}`, `{{credit}}`, `{{discount}}`, `{{total_balanc}}` y `{{product}}` con un ejemplo. La plantilla MUST enviarse sin renderizar al servidor, que la personaliza por contacto según la capability `template-rendering`.

#### Scenario: Mostrar ayuda de variables
- **WHEN** el usuario pulsa "Ver variables"
- **THEN** aparece el panel "Variables disponibles:" con las ocho variables y el botón cambia a "Ocultar variables"

### Requirement: Retraso configurable entre mensajes
La UI SHALL exponer el campo numérico "Retraso entre mensajes (segundos)" con valor inicial 5 y atributos `min=3` y `max=60`; el valor se envía como `delay`. El servidor MUST esperar `delay` segundos entre un contacto y el siguiente, sin espera después del último, y usar 5 cuando `delay` es 0, nulo o no numérico. Los límites 3–60 no se validan en el servidor.

#### Scenario: Retraso personalizado
- **WHEN** se envía una campaña de 3 contactos con `delay` 10
- **THEN** el servidor espera 10 segundos tras el primer y el segundo contacto y ninguno tras el tercero

#### Scenario: Retraso ausente
- **WHEN** `POST /api/whatsapp/send` llega sin `delay` o con `delay` 0
- **THEN** se usa un retraso de 5 segundos

### Requirement: Envío de campaña
El botón "Enviar Campaña (N contactos)" SHALL estar deshabilitado salvo que el estado sea Conectado, haya mensaje y al menos un contacto. Al pulsarlo, la UI MUST volver a verificar el estado y, si está conectado, enviar en una sola petición `POST /api/whatsapp/send` con `{ message, contacts, delay }`; el servidor procesa los contactos secuencialmente y responde solo al terminar todos.

#### Scenario: Verificación previa falla
- **WHEN** el usuario pulsa enviar y `/api/whatsapp/status` devuelve `disconnected`
- **THEN** no se envía nada, el estado pasa a Desconectado y se muestra `alert` "WhatsApp no está conectado. Por favor, haz clic en \"Conectar WhatsApp\" primero."

#### Scenario: Campaña completada
- **WHEN** el servidor responde `{ success: true, sent, failed, total }`
- **THEN** se muestra `alert` "Campaña completada: <sent> enviados, <failed> fallidos"
- **AND** el mensaje y la lista de contactos se limpian

#### Scenario: Envío por contacto
- **WHEN** el servidor procesa un contacto
- **THEN** renderiza la plantilla con los datos del contacto, elimina todo carácter no numérico del teléfono y abre `https://web.whatsapp.com/send?phone=<dígitos>` (timeout 30 s), espera 3 s, escribe el texto en el cuadro de mensaje carácter por carácter con 100 ms entre teclas, espera 1 s, pulsa el botón de enviar y espera 2 s
- **AND** cuenta el contacto como enviado solo si llegó a pulsar el botón de enviar

#### Scenario: Número inválido o error de UI
- **WHEN** WhatsApp muestra "El número de teléfono compartido a través de la dirección URL no es válido", o no aparece el cuadro de mensaje en 10 s o el botón de enviar en 5 s
- **THEN** el contacto se cuenta como fallido y el envío continúa con el siguiente

### Requirement: Validaciones de la ruta de envío
`POST /api/whatsapp/send` SHALL validar la petición antes de enviar y MUST responder con estos contratos: HTTP 400 `{ success: false, message: "Faltan parámetros requeridos" }` si falta `message` o `contacts` está vacío; HTTP 400 `{ success: false, message: "WhatsApp no está conectado. Por favor, conecta WhatsApp primero." }` si no hay conexión; HTTP 500 `{ success: false, message: "Error al enviar mensajes" }` ante excepción; HTTP 200 `{ success: true, sent, failed, total }` al terminar.

#### Scenario: Parámetros faltantes
- **WHEN** se envía `{ "message": "", "contacts": [] }`
- **THEN** la respuesta es HTTP 400 con `message` "Faltan parámetros requeridos"

#### Scenario: Servidor desconectado
- **WHEN** la petición es válida pero WhatsApp no está conectado en el servidor
- **THEN** la respuesta es HTTP 400 con el mensaje de no conectado
- **AND** la UI marca la campaña como error, muestra `alert` "Error: <mensaje>" y cambia el estado a Desconectado

### Requirement: Historial de campañas en sesión
La UI SHALL mostrar "Historial de Campañas" cuando exista al menos una campaña, con la más reciente primero, mostrando los primeros 50 caracteres del mensaje seguidos de "...", el texto "<sent> / <total> enviados" y un ícono por estado (spinner en curso, check completada, alerta en error). Al completar con éxito, `sent` MUST fijarse igual a `total` aunque el servidor reporte fallidos.

#### Scenario: Campaña en curso
- **WHEN** se inicia el envío
- **THEN** se agrega una entrada con estado en curso y "0 / N enviados"

#### Scenario: Campaña con fallos parciales
- **WHEN** el servidor responde `success: true` con `sent: 2, failed: 1` para 3 contactos
- **THEN** la entrada queda como completada mostrando "3 / 3 enviados"

#### Scenario: Error de red
- **WHEN** la petición de envío lanza una excepción en el navegador
- **THEN** la entrada queda en estado error sin mostrar `alert`

### Requirement: Persistencia de sesión de WhatsApp
El sistema SHALL conservar la vinculación de WhatsApp Web entre reinicios guardando el perfil de Chromium en `whatsapp-session/` dentro del directorio de trabajo del servidor. Dentro de un mismo proceso del servidor, el navegador y la página MUST compartirse entre rutas y sobrevivir recargas en caliente del modo desarrollo.

#### Scenario: Reinicio del servidor
- **WHEN** el servidor se reinicia y el usuario vuelve a pulsar "Conectar WhatsApp"
- **THEN** se reutiliza el perfil guardado y no se requiere escanear el QR mientras WhatsApp mantenga el dispositivo vinculado

#### Scenario: Reinicio de la sesión
- **WHEN** el usuario borra el directorio `whatsapp-session/` y vuelve a conectar
- **THEN** WhatsApp Web solicita escanear un nuevo código QR
