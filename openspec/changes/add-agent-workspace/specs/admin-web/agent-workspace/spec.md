# Spec Delta

## Purpose

Ofrecer al agente v3 (y al supervisor que recibe contactos) la vista "Mi asignación" de ANA Admin para revisar sus asignaciones pendientes, escribir el mensaje con variables y vista previa, elegir a quién enviar y publicarlo al CLI, con su historial.

## ADDED Requirements

### Requirement: Sección Mi asignación
ANA Admin SHALL ofrecer la sección "Mi asignación" (`/mi-asignacion`) a usuarios con `ana:campaign:message:send` (o admin); sus rutas BFF (`/api/agent/*`) MUST responder 403 a cualquier otro usuario y propagar el id token del usuario a v3, que decide el roster.

#### Scenario: Agente sin otros permisos
- **WHEN** un usuario con solo el rol "Agente Prueba" inicia sesión
- **THEN** la navegación muestra solo "Mi asignación" y la página de inicio la enlaza

#### Scenario: Usuario sin permiso de envío
- **WHEN** un usuario sin `ana:campaign:message:send` abre `/mi-asignacion`
- **THEN** la app muestra "Sin acceso"

### Requirement: Campañas del agente
La página SHALL ofrecer en un selector con búsqueda solo las campañas donde el usuario está habilitado en v3 (`GET /agent/campaigns`) y preseleccionar la única si hay una. Sin campañas MUST mostrar "No estás habilitado como agente v3 en ninguna campaña".

#### Scenario: Dos campañas
- **WHEN** el agente está habilitado en `prueba` y `zendere`
- **THEN** el selector ofrece ambas y no preselecciona ninguna

### Requirement: Asignaciones pendientes en la página
Con campaña elegida, la página SHALL listar sus archivos pendientes (nombre, fecha en hora de Ciudad de México, tamaño) con casillas, preseleccionando el más reciente, con Skeleton mientras carga y "Sin asignaciones pendientes" si no hay; "Cargar seleccionados" combina los archivos elegidos en una sola tabla.

#### Scenario: Combinar dos archivos
- **WHEN** el agente selecciona dos archivos con encabezados `phone_number,first_name` y `phone_number,first_name,total_balance` y pulsa "Cargar seleccionados"
- **THEN** la tabla muestra las filas de ambos con las columnas `phone_number`, `first_name` y `total_balance` (vacía en las filas del primero)

### Requirement: Tabla de contactos
La tabla SHALL permitir buscar en todas las columnas, ordenar por columna, seleccionar filas (casilla por fila y "Seleccionar todos los resultados" sobre lo filtrado) y mostrar los teléfonos enmascarados (últimos 4 dígitos) y las filas inválidas sin casilla con su causa, con scroll horizontal.

#### Scenario: Selección sobre lo filtrado
- **WHEN** el agente busca `Ana` y marca "Seleccionar todos los resultados"
- **THEN** solo quedan seleccionadas las filas que coinciden

### Requirement: Columnas de teléfono
La página SHALL pedir con un selector múltiple con búsqueda una o más columnas de teléfono (máximo 5), preseleccionando la columna que usaría el CLI (último alias `phone_number`, `contact_phone`, `contact_pho` o `phone` del encabezado) o, si no hay alias, la primera columna que contiene `tel` o `phone`; sin columna MUST deshabilitar la publicación.

#### Scenario: CSV con telefono_1 y telefono_2
- **WHEN** las columnas son `telefono_1,telefono_2,first_name`
- **THEN** se preselecciona `telefono_1` y el agente puede agregar `telefono_2`

### Requirement: Mensaje con variables y vista previa
La página SHALL ofrecer un editor del mensaje con un selector con búsqueda que inserta `{{columna}}` en el cursor, aceptar expresiones (`{{total_balance*0.8}}`) con la semántica del CLI v3, mostrar la vista previa renderizada por fila en la tabla y marcar "Variable desconocida: <marcador>" bloqueando la publicación. Si los archivos traen columna `message`, el editor se precarga con el de la primera fila.

#### Scenario: Vista previa por fila
- **WHEN** el mensaje es `Hola {{first_name}}` y la fila 2 tiene `first_name=Beto`
- **THEN** la columna de vista previa de la fila 2 muestra `Hola Beto`

#### Scenario: Variable inexistente
- **WHEN** el mensaje usa `{{apodo}}` y no hay esa columna
- **THEN** la página muestra "Variable desconocida: {{apodo}}" y "Publicar" queda deshabilitado

### Requirement: Publicación de la selección
"Publicar (N)" SHALL abrir un `ConfirmDialog` con campaña, contactos y teléfonos a enviar; al confirmar, el BFF llama a `POST /agent/assignments/{campaign}/publish` con un `publishId` generado una vez por confirmación. Tras el éxito MUST mostrar "Publicado: N contactos; el CLI los enviará en su siguiente consulta" y recargar pendientes e historial.

#### Scenario: Publicación exitosa
- **WHEN** el agente publica 12 filas seleccionadas
- **THEN** la página muestra el mensaje de éxito, los pendientes ya no contienen esas filas y el historial muestra la publicación

#### Scenario: Asignación cambiada
- **WHEN** v3 responde 409 porque la fuente cambió
- **THEN** la página muestra "La asignación cambió; vuelve a cargarla" y recarga la lista de pendientes

### Requirement: Historial de publicaciones en la página
La página SHALL mostrar las publicaciones del agente en la campaña (fecha, contactos, archivos origen y estado de cada uno: reescrito o consumido) con Skeleton mientras carga y "Sin publicaciones" si no hay.

#### Scenario: Historial con una publicación
- **WHEN** el agente publicó 12 contactos de un archivo que quedó vacío
- **THEN** el historial muestra la fecha, 12 contactos y el archivo como "Consumido"

### Requirement: Contactos fuera de logs del BFF
Las rutas `/api/agent/*` MUST NOT registrar teléfonos, filas, plantillas ni mensajes; los logs solo incluyen campaña, usuario, `publishId`, códigos de error y conteos.

#### Scenario: Error al publicar
- **WHEN** la publicación falla en v3
- **THEN** el log del BFF contiene campaña, usuario, `publishId` y código, sin datos de contacto
