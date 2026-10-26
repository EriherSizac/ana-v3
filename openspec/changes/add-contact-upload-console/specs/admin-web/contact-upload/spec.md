# Spec Delta

## Purpose

Permitir a líderes y administradores cargar listas de contactos de cobranza desde ANA Admin y entregarlas a los agentes habilitados de una campaña en v3 o v4, con validación, vista previa del reparto por agente, confirmación explícita e historial de cargas.

## ADDED Requirements

### Requirement: Sección Contactos
ANA Admin SHALL ofrecer la sección "Contactos" (`/contactos`) solo a usuarios admin o con `ana:contacts:list:upload` y `ana:contacts:list:distribute`; las rutas del BFF de la sección MUST responder 403 a cualquier otro usuario y a campañas fuera de su alcance.

#### Scenario: Solo permiso de carga
- **WHEN** un usuario con `ana:contacts:list:upload` pero sin `ana:contacts:list:distribute` abre `/contactos`
- **THEN** la app muestra "Sin acceso"

### Requirement: Destino de la carga
El formulario SHALL pedir, con selectores con búsqueda, campaña (de `GET /api/campaigns`), flota (`v3` o `v4`) y modo: "Repartir entre agentes habilitados" o "Asignar a un agente" (elegido entre los habilitados de esa campaña y flota). Si la campaña no tiene agentes habilitados en la flota, MUST impedir continuar con un aviso que enlaza a "Agentes".

#### Scenario: Campaña sin agentes habilitados
- **WHEN** el líder elige `zendere` y `v3` y el roster v3 de `zendere` no tiene habilitados
- **THEN** la página muestra "No hay agentes habilitados en esta campaña para v3" con enlace a `/agentes` y no permite cargar archivo

### Requirement: Lectura y límites del archivo
El navegador SHALL leer un archivo `.csv` UTF-8 (quitando BOM) con encabezado, de hasta 4 MB y 20 000 filas en v3 o 10 MB y 50 000 filas en v4; un archivo fuera de límites, vacío o sin encabezado MUST rechazarse con mensaje inline antes de cualquier envío al servidor.

#### Scenario: Archivo grande para v3
- **WHEN** el líder elige un CSV de 6 MB con flota `v3`
- **THEN** la página muestra "El archivo supera 4 MB para v3" y no envía nada

### Requirement: Columna de teléfono
La página SHALL detectar la columna de teléfono entre los alias `phone_number`, `contact_phone`, `contact_pho`, `phone` y, solo en v4, `telefono` o la que el usuario elija en un selector con búsqueda; en v3 MUST existir uno de los cuatro primeros alias.

#### Scenario: CSV en español para v3
- **WHEN** el CSV solo tiene `telefono` y la flota es `v3`
- **THEN** la página indica que v3 requiere `phone_number`, `contact_phone`, `contact_pho` o `phone` y no permite continuar

### Requirement: Validación de filas
Cada fila SHALL clasificarse como válida o inválida: inválida si tiene menos columnas que el encabezado, teléfono vacío o con menos de 10 dígitos, si repite un teléfono (solo dígitos) de una fila anterior o, en v3, si un campo contiene un salto de línea. La página MUST mostrar totales y hasta 100 filas inválidas con su número y causa; solo las válidas se entregan.

#### Scenario: Filas con problemas
- **WHEN** un CSV de 500 filas tiene 3 sin teléfono y 2 teléfonos repetidos
- **THEN** la página muestra 495 válidas y 5 inválidas con causa "Sin teléfono" o "Teléfono duplicado"

### Requirement: Mensaje o plantilla
En v3, si el CSV no tiene columna `message`, la página SHALL exigir un mensaje plantilla (variables `{columna}`); en v4 SHALL pedir la plantilla con valor por defecto `{mensaje}` y el código de país con valor por defecto `52`. La vista previa MUST mostrar el mensaje resultante de las primeras filas.

#### Scenario: v3 sin mensaje
- **WHEN** el CSV de v3 no tiene `message` y el campo de mensaje está vacío
- **THEN** el botón de vista previa está deshabilitado con el motivo "Escribe el mensaje"

### Requirement: Vista previa del reparto
Antes de enviar, la página SHALL calcular el plan: en "Repartir", fila válida i (en orden del archivo) al agente `i mod n` de los habilitados ordenados por username; en "Asignar", todas al agente elegido. MUST mostrar por agente el número de contactos y sus primeras 5 filas, sin enviar el archivo al servidor hasta confirmar.

#### Scenario: Reparto entre tres agentes
- **WHEN** hay 10 filas válidas y los habilitados son `ana`, `beto`, `carla`
- **THEN** la vista previa muestra 4 para `ana`, 3 para `beto` y 3 para `carla`

### Requirement: Confirmación y verificación del plan
Al confirmar en un `ConfirmDialog` (campaña, flota, modo, total y conteo por agente), el BFF SHALL recalcular el plan con el roster vigente y responder 409 sin entregar si difiere del previsualizado; la página MUST pedir volver a previsualizar.

#### Scenario: Roster cambió
- **WHEN** entre la vista previa y la confirmación se deshabilita a `beto`
- **THEN** el BFF responde 409 `conflict` y la página muestra "El roster cambió; revisa la nueva vista previa"

### Requirement: Entrega en v3
Para v3 el BFF SHALL enviar a `POST /admin/campaigns/{campaign}/contacts` (`v3/agent-assignments`) un archivo por agente con el encabezado original y sus filas válidas, el mensaje y un `uploadId` generado una vez por confirmación, con el token del usuario; ante un error de red MUST reintentar una vez con el mismo `uploadId`.

#### Scenario: Entrega exitosa
- **WHEN** el líder confirma una carga v3 a dos agentes
- **THEN** la página muestra "Carga entregada" con el conteo por agente devuelto en el manifiesto

### Requirement: Entrega en v4
Para v4 el BFF SHALL pedir `POST /uploads/presign` con el token del usuario, `campaign`, plantilla, código de país, columna de teléfono, `distribute:true` y `assignments` con peso 1 por agente en el orden del plan, y subir a la URL firmada un CSV con solo las filas válidas. Si `assignments` excede 1500 caracteres MUST bloquear la carga con un aviso.

#### Scenario: Asignar a un agente en v4
- **WHEN** el líder asigna todo a `ana.lopez` en v4
- **THEN** el presign lleva `assignments:{"ana.lopez":1}` y, tras procesarse, todos los jobs son de `ana.lopez`

#### Scenario: Procesamiento asíncrono
- **WHEN** la subida a S3 termina
- **THEN** la página muestra "Procesando" y consulta el historial v4 por `srcKey` hasta 60 segundos, mostrando el resultado o "Sigue en proceso; revisa el historial"

### Requirement: Historial de cargas
La sección SHALL mostrar en `/contactos/historial`, por campaña y flota, las cargas más recientes con fecha, autor, archivo, modo, filas válidas/totales, estado y conteo por agente, desde `GET /admin/campaigns/{campaign}/uploads` (v3) y `GET /uploads/history` (v4), con Skeleton mientras carga.

#### Scenario: Historial v4 con carga rechazada
- **WHEN** una carga v4 fue rechazada por exceder filas
- **THEN** el historial la muestra con estado "Rechazada" y la causa

### Requirement: Contactos fuera de logs
El BFF MUST NOT registrar en logs ni guardar fuera de la solicitud el contenido de los CSV ni datos de contactos; los logs solo pueden incluir campaña, flota, usuario, `uploadId`/`srcKey` y conteos.

#### Scenario: Error durante la entrega
- **WHEN** la entrega a v3 falla
- **THEN** el log del BFF contiene campaña, `uploadId`, código de error y conteos, sin teléfonos ni filas
