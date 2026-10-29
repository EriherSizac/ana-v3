# Spec Delta

## ADDED Requirements

### Requirement: Lectura de la base CRM
El navegador SHALL decodificar el archivo como UTF-8 y, ante bytes inválidos, como Windows-1252 (mostrando la codificación), quitar el BOM, detectar el delimitador `,`, `;` o tabulador en el encabezado y leer campos RFC 4180. Conserva todas las columnas (p. ej. `pago_minimo.1`); un encabezado repetido se renombra `nombre.N`. Los límites se miden sobre el texto en UTF-8.

#### Scenario: Exporte de Excel en Windows-1252
- **WHEN** el archivo trae `Espíritu` codificado en Windows-1252
- **THEN** la página muestra "Codificación: Windows-1252" y el nombre se lee `Espíritu`

#### Scenario: Delimitador punto y coma
- **WHEN** el encabezado es `id_credito;nombre_cliente;telefono_1`
- **THEN** la página detecta 3 columnas

### Requirement: Varias columnas de teléfono
Además de los alias de "Columna de teléfono", `telefono`, `telefono_N` y `phone_N` SHALL contar como columnas de teléfono en ambas flotas (y en la validación de `POST /admin/campaigns/{campaign}/contacts` de v3); la página lista las detectadas. Una fila es válida si alguna tiene 10 o más dígitos; el teléfono de la fila es el primero válido (en filas sin crédito el duplicado se mide con él; ver "Duplicados por crédito"). Los archivos v3 conservan todas las columnas.

#### Scenario: Base CRM para v3
- **WHEN** el CSV solo tiene `telefono_1`, `telefono_2` y `telefono_3` y la flota es `v3`
- **THEN** la página muestra esas columnas de teléfono y permite continuar

#### Scenario: Solo el segundo teléfono
- **WHEN** una fila tiene `telefono_1` vacío y `telefono_2=5512345678`
- **THEN** la fila es válida

### Requirement: Saltos de línea dentro de un campo
Un salto de línea dentro de un campo MUST NOT invalidar la fila (reemplaza la causa "Salto de línea dentro de un campo" de "Validación de filas"): CR/LF se convierten en un espacio y el campo se recorta al leer, y el backend v3 hace lo mismo al escribir la carga de administración y la publicación de "Mi asignación".

#### Scenario: Comentario multilínea
- **WHEN** un campo es `"\n*** 5520 SE CONTACTA\nPOR WHATSAPP"`
- **THEN** la fila es válida y el archivo entregado lo contiene como `*** 5520 SE CONTACTA POR WHATSAPP`

### Requirement: Pegar desde Excel
El paso 2 SHALL ofrecer pestañas "Archivo" y "Pegar". "Pegar" tiene un área de texto para un rango copiado de Excel (encabezado en la primera fila, tabuladores, comillas de Excel) y "Usar datos pegados", que lo procesa con las mismas reglas, límites, validación, vista previa y entrega que un archivo, mostrando filas y columnas leídas o el error inline.

#### Scenario: Rango pegado
- **WHEN** el líder pega 3 filas con encabezado de la base CRM y pulsa "Usar datos pegados"
- **THEN** la página muestra "3 filas · 76 columnas" y la validación de las 3 filas

#### Scenario: Pegado demasiado grande
- **WHEN** el texto pegado supera 4 MB con flota `v3`
- **THEN** la página muestra "El texto pegado supera 4 MB para v3" y no lo procesa

### Requirement: Identificadores y variables de la base CRM
La vista previa y "Mi asignación" SHALL mostrar `nombre_cliente` como nombre con espacios colapsados solo al mostrar (el archivo conserva el valor). `{{columna.N}}` resuelve esa columna, también dentro de expresiones (`{{pago_minimo.1*2}}`), en ANA Admin, el backend v3 y el CLI.

#### Scenario: Variable con punto
- **WHEN** la plantilla es `Paga {{pago_minimo.1}}` y la fila tiene `pago_minimo.1=377.3`
- **THEN** la vista previa muestra `Paga 377.3`

### Requirement: Teléfono de envío en v4
En v4 la columna elegida SHALL tener por defecto el primer alias de v4 o la primera `telefono_N`. Si es `telefono_N`, cada fila usa ese valor o la siguiente `telefono_N` con 10 dígitos; el CSV subido agrega al final `telefono_envio` con el teléfono resuelto y el presign usa `phoneColumn:"telefono_envio"`.

#### Scenario: Fallback al segundo teléfono
- **WHEN** la columna elegida es `telefono_1` y una fila tiene `telefono_1` vacío y `telefono_2=5598765432`
- **THEN** el CSV a v4 tiene `telefono_envio=5598765432` en esa fila

### Requirement: Duplicados por crédito
La validación de filas (navegador y BFF, ambas flotas) SHALL detectar duplicados por el crédito de la fila: primer valor no vacío de `credit`, `credito`, `credit_id` o `id_credito`, sin espacios ni mayúsculas. La primera fila de cada crédito se conserva y las demás quedan "Crédito duplicado"; el mismo teléfono en créditos distintos MUST NOT invalidar la fila. Sin crédito, la fila se compara por teléfono con otras filas sin crédito ("Teléfono duplicado").

#### Scenario: Mismo crédito repetido
- **WHEN** las filas 2 y 3 tienen `id_credito=123` con teléfonos distintos
- **THEN** la fila 2 es válida y la fila 3 queda inválida con causa "Crédito duplicado"

#### Scenario: Un cliente con varios créditos
- **WHEN** las filas 2 y 3 tienen el mismo teléfono y `id_credito` 123 y 456
- **THEN** ambas filas son válidas y se entregan

#### Scenario: Sin columna de crédito
- **WHEN** el CSV no tiene columnas de crédito y dos filas repiten el teléfono
- **THEN** la segunda queda inválida con causa "Teléfono duplicado"

#### Scenario: Fila inválida no reserva el crédito
- **WHEN** la fila 2 tiene `id_credito=123` sin teléfono y la fila 3 `id_credito=123` con teléfono válido
- **THEN** la fila 2 queda "Sin teléfono" y la fila 3 es válida

### Requirement: Créditos duplicados en la carga v3
`POST /admin/campaigns/{campaign}/contacts` de v3 SHALL responder 400 `Crédito duplicado: <crédito>` sin escribir archivos si dos filas de la carga, en el mismo o en distintos archivos, comparten crédito con la misma normalización. Filas sin crédito no se comprueban.

#### Scenario: Carga v3 con crédito repetido
- **WHEN** la carga trae dos archivos cuyas filas comparten `id_credito=123`
- **THEN** responde 400 `Crédito duplicado: 123` y no escribe archivos

### Requirement: Publicación por crédito
Al publicar desde "Mi asignación" (v3), un teléfono SHALL omitirse solo si ya se incluyó para el mismo crédito (o, en filas sin crédito, para otra fila sin crédito): el mismo teléfono nunca recibe dos mensajes por el mismo crédito y recibe uno por cada crédito distinto. En v4 cada fila válida sigue siendo un envío (el trigger CSV no deduplica).

#### Scenario: Dos créditos del mismo teléfono
- **WHEN** el agente publica dos filas con el mismo teléfono y créditos 123 y 456
- **THEN** el archivo publicado tiene una fila por crédito

#### Scenario: Mismo crédito en dos archivos
- **WHEN** el agente publica dos filas con `id_credito=123` y el mismo teléfono
- **THEN** el archivo publicado tiene una sola fila para ese teléfono

### Requirement: Pegado sin congelar la página
El área "Pegar desde Excel" MUST NOT guardar el texto pegado en el estado de React ni pintarlo completo: el texto se toma del evento de pegado (`text/plain` del portapapeles) y la página muestra solo un resumen (líneas, tamaño) y las primeras 3 líneas recortadas; si se escribió a mano, el texto se lee del área una sola vez al pulsar "Usar datos pegados". "Quitar datos pegados" descarta el texto.

#### Scenario: Rango grande pegado
- **WHEN** el líder pega un rango de 30 000 filas
- **THEN** el área de texto queda vacía, la página muestra "Datos pegados: 30,001 líneas · <tamaño>" con 3 líneas de muestra y sigue respondiendo

### Requirement: Procesamiento en segundo plano
La lectura, validación y reparto de un archivo o texto pegado SHALL ejecutarse en un Web Worker con las mismas funciones puras que usa el BFF (lectura, teléfonos, fechas de Excel, duplicados por crédito, plan y hash). Sin soporte de Worker, el mismo procesamiento corre en el hilo principal. Mientras procesa, los demás controles siguen respondiendo y "Vista previa" queda deshabilitada.

#### Scenario: Página activa durante el proceso
- **WHEN** el Worker valida un archivo de 100 000 filas
- **THEN** el líder puede cambiar el modo de reparto y "Vista previa" está deshabilitada hasta terminar

### Requirement: Progreso y cancelación
La página SHALL mostrar, mientras procesa, una barra de progreso con la fase ("Lectura", "Validación", "Reparto"), el porcentaje y las filas procesadas de un total, y un botón "Cancelar" que detiene el Worker y descarta lo leído.

#### Scenario: Progreso de validación
- **WHEN** el Worker reporta 75 000 de 100 000 filas en validación
- **THEN** la página muestra "Validación · 75% (75,000 de 100,000 filas)" y la barra en 75

#### Scenario: Cancelar
- **WHEN** el líder pulsa "Cancelar" durante la lectura
- **THEN** el procesamiento se detiene, desaparece la barra y no queda archivo leído

### Requirement: Carga v3 grande por S3
Los límites de v3 SHALL ser 50 MB (texto en UTF-8) y 200 000 filas (reemplazan 4 MB y 20 000 de "Lectura de la base CRM" y "Pegar desde Excel"). Hasta 4 MB la carga viaja en la solicitud como antes; con más de 4 MB el navegador arma el CSV maestro (encabezado + filas válidas en el orden del plan), lo sube directo a S3 con una URL firmada y entrega `uploadId`, `sourceKey` y el plan sin `csv`.

#### Scenario: Base de 120 000 filas
- **WHEN** el líder carga para v3 un CSV de 30 MB y 120 000 filas y confirma
- **THEN** el archivo se sube a S3 con la URL firmada, cada agente recibe sus filas igual que en una carga en línea y el objeto de `uploads-incoming/` se borra

#### Scenario: Más de 50 MB
- **WHEN** el archivo para v3 supera 50 MB
- **THEN** la página muestra "El archivo supera 50 MB para v3" y no lo procesa

### Requirement: URL firmada para la carga v3
`POST /api/campaigns/{campaign}/uploads/presign` SHALL pedir a `POST /admin/campaigns/{campaign}/contacts/presign` de v3 (`cognitoAdminJwt`, permisos de la carga), con un `uploadId` nuevo, una URL de PUT de 15 minutos a `uploads-incoming/{campaign}/{uploadId}.csv` con `text/csv` y el tamaño firmados; más de 50 MB es 413. El bucket permite PUT por CORS desde `https://ana-admin.pernexium.com.mx` y expira `uploads-incoming/` en 1 día.

#### Scenario: Tamaño firmado
- **WHEN** el navegador pide la URL para 6 MB
- **THEN** la URL firma `content-length` y `content-type` y vence en 900 segundos

### Requirement: Entrega v3 desde S3
Con `sourceKey`, el BFF SHALL verificar el roster contra el orden de agentes y los conteos del plan (409 si difiere) y reenviar `{uploadId, fileName, mode, sourceKey, plan}` a la carga de v3. La Lambda exige el `sourceKey` de ese `uploadId`, lee el objeto, reparte la fila i al agente i mod n, verifica conteos y hash, escribe lo mismo que la carga en línea y borra el objeto al completar.

#### Scenario: Equivalencia con la carga en línea
- **WHEN** el mismo archivo se entrega por S3 y en línea
- **THEN** los archivos por agente son idénticos (salvo `ana_upload_id`)

#### Scenario: Archivo subido inexistente
- **WHEN** la carga por S3 llega sin que exista el objeto `uploads-incoming/{campaign}/{uploadId}.csv`
- **THEN** v3 responde 400 "No se encontró el archivo subido; vuelve a cargarlo" y no escribe archivos

#### Scenario: Plan distinto del archivo
- **WHEN** los conteos o el hash del plan no coinciden con el CSV maestro
- **THEN** v3 responde 409 y la página pide revisar la nueva vista previa

### Requirement: Límites de v4
v4 SHALL mantener 10 MB y 50 000 filas (máximo del trigger CSV); la página muestra ambos límites y aclara que el de filas es el del procesador de v4.

#### Scenario: Pegado demasiado grande para v4
- **WHEN** el texto pegado supera 10 MB con flota `v4`
- **THEN** la página muestra "El texto pegado supera 10 MB para v4" y no lo procesa

### Requirement: Fechas de Excel
Al leer un archivo o pegado y al escribir la carga de v3, un número de serie de Excel de 20 000 a 80 000 (entero o decimal) en una columna de fecha (nombre con `fecha` o `date`) SHALL pasar a `dd/mm/aaaa` (sistema 1900 con el 29/02/1900 ficticio; sin hora); en `hora`/`hora_*` una fracción de 0 a 1 pasa a `HH:MM:SS`. Valores formateados, texto y otras columnas (p. ej. `saldo_*`) MUST NOT cambiar. La página indica cuántas fechas convirtió.

#### Scenario: Fecha copiada como número
- **WHEN** una fila trae `fecha_corte=45961` y `saldo_total=45961`
- **THEN** se entrega `fecha_corte=31/10/2025` y `saldo_total=45961`

#### Scenario: Día ficticio de Excel
- **WHEN** se convierte el número de serie 60
- **THEN** el resultado es `29/02/1900`

### Requirement: Fechas de Excel en asignaciones anteriores
Los archivos ya cargados con números de serie en columnas de fecha SHALL mostrarse como fecha en "Mi asignación", y la vista previa del mensaje y la publicación de v3 SHALL renderizar `{{fecha_*}}` con la fecha usando la misma conversión; el texto original de los pendientes no se reescribe.

#### Scenario: Asignación anterior
- **WHEN** un archivo ya cargado tiene `fecha_corte=45961` y la plantilla es `Corte {{fecha_corte}}`
- **THEN** "Mi asignación" muestra `31/10/2025` y el mensaje publicado dice `Corte 31/10/2025`

### Requirement: Filtros por columna en "Mi asignación"
La tabla de contactos de "Mi asignación" SHALL conservar la barra de filtros actual y agregar un filtro junto al control de orden de cada encabezado: un panel del sistema de diseño con búsqueda y valores distintos con conteo ("Seleccionar todo", "Limpiar"; los 200 más frecuentes y la búsqueda para el resto), rango mínimo/máximo en columnas numéricas y rango `dd/mm/aaaa` en columnas de fecha. Los valores se calculan al abrir el panel.

#### Scenario: Filtro por valores
- **WHEN** el agente filtra `estado` por `CDMX` y `Jalisco` desde el encabezado
- **THEN** la tabla muestra solo esas filas, el icono queda resaltado y aparece el chip "estado: CDMX, Jalisco"

### Requirement: Filtros combinados en "Mi asignación"
Los filtros de la barra y los de columna SHALL combinarse (Y): cada filtro de columna aparece como chip con ×, "Limpiar filtros" borra ambos, los dos se guardan por campaña y "Seleccionar todo" respeta todos.

#### Scenario: Limpiar filtros
- **WHEN** hay un filtro de la barra y uno de columna y el agente pulsa "Limpiar filtros"
- **THEN** se quitan ambos

### Requirement: Aviso de plantilla sin campos personalizados
En "Mi asignación", si la plantilla no tiene ninguna variable (`{{...}}` o `{var}`) que resuelva a una columna del archivo, el paso Mensaje SHALL mostrar en vivo bajo el editor el aviso "Tu plantilla no tiene ningún campo personalizado. Usar variables como {{nombre_cliente}} o {{saldo_vencido_actual}} hace cada mensaje distinto y reduce la probabilidad de bloqueos de WhatsApp." con 3 columnas sugeridas que se insertan con un clic. No bloquea la publicación.

#### Scenario: Insertar columna sugerida
- **WHEN** el agente pulsa la columna sugerida `nombre_cliente`
- **THEN** la plantilla recibe `{{nombre_cliente}}` y el aviso desaparece

### Requirement: Aviso de plantilla en Resumen y confirmación
Con el aviso de plantilla sin campos personalizados, el paso Resumen SHALL repetirlo y la confirmación de publicación SHALL mencionarlo con el botón "Enviar de todos modos".

#### Scenario: Plantilla fija
- **WHEN** la plantilla es `Hola, tienes un adeudo pendiente`
- **THEN** se muestra el aviso y la confirmación dice "Enviar de todos modos"

#### Scenario: Solo variables desconocidas
- **WHEN** la plantilla es `Hola {{no_existe}}`
- **THEN** se muestra el aviso

#### Scenario: Con variable
- **WHEN** la plantilla es `Hola {{nombre_cliente}}` y el archivo tiene esa columna
- **THEN** no se muestra el aviso
