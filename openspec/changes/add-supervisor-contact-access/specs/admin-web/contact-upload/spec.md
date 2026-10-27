# Spec Delta

## MODIFIED Requirements

### Requirement: Destino de la carga
El formulario SHALL pedir, con selectores con búsqueda, campaña (de `GET /api/campaigns`), flota (`v3` o `v4`, con `v3` preseleccionada) y modo: "Repartir entre agentes habilitados" o "Asignar a un agente" (elegido entre los habilitados de esa campaña y flota). Si la campaña no tiene destinatarios habilitados en la flota, MUST impedir continuar con un aviso que enlaza a "Agentes".

#### Scenario: Campaña sin agentes habilitados
- **WHEN** el líder elige `zendere` y `v3` y el roster v3 de `zendere` no tiene habilitados
- **THEN** la página muestra "No hay agentes habilitados en esta campaña para v3" con enlace a `/agentes` y no permite cargar archivo

#### Scenario: Flota por defecto
- **WHEN** el supervisor abre `/contactos`
- **THEN** la flota `v3` ya está seleccionada

### Requirement: Vista previa del reparto
Antes de enviar, la página SHALL calcular el plan: en "Repartir", fila válida i (en orden del archivo) al destinatario `i mod n` de los habilitados ordenados por username; en "Asignar", todas al elegido. MUST mostrar por destinatario el número de contactos y sus primeras 5 filas (teléfono y nombre si existe), con la etiqueta "Supervisor" en los supervisores, sin enviar el archivo al servidor hasta confirmar.

#### Scenario: Reparto entre tres agentes
- **WHEN** hay 10 filas válidas y los habilitados son `ana`, `beto`, `carla`
- **THEN** la vista previa muestra 4 para `ana`, 3 para `beto` y 3 para `carla`

#### Scenario: Supervisor en la vista previa
- **WHEN** "Incluir supervisores" está encendido y `sara` es supervisora habilitada
- **THEN** la tarjeta de `sara` muestra la etiqueta "Supervisor"

### Requirement: Entrega en v3
Para v3 el BFF SHALL enviar a `POST /admin/campaigns/{campaign}/contacts` (`v3/agent-assignments`) un archivo por destinatario con el encabezado original y sus filas válidas y un `uploadId` generado una vez por confirmación, sin mensaje, con el token del usuario; ante un error de red MUST reintentar una vez con el mismo `uploadId`.

#### Scenario: Entrega exitosa
- **WHEN** el líder confirma una carga v3 a dos agentes
- **THEN** la página muestra "Carga entregada" con el conteo por agente devuelto en el manifiesto y que cada agente la verá en "Mi asignación"

### Requirement: Entrega en v4
Para v4 el BFF SHALL pedir `POST /uploads/presign` con el token del usuario, `campaign`, código de país (campo del formulario, default `52`), columna de teléfono, `distribute:true` y `assignments` con peso 1 por destinatario en el orden del plan, sin `template`, y subir a la URL firmada un CSV con solo las filas válidas. Si `assignments` excede 1500 caracteres MUST bloquear la carga con un aviso.

#### Scenario: Asignar a un agente en v4
- **WHEN** el líder asigna todo a `ana.lopez` en v4
- **THEN** el presign lleva `assignments:{"ana.lopez":1}` sin `template` y, tras procesarse, todos los jobs son de `ana.lopez`

#### Scenario: Procesamiento asíncrono
- **WHEN** la subida a S3 termina
- **THEN** la página muestra "Procesando" y consulta el historial v4 por `srcKey` hasta 60 segundos, mostrando el resultado o "Sigue en proceso; revisa el historial"

### Requirement: Columna reservada ana_upload_id
En v3 la página SHALL rechazar antes de la vista previa un CSV cuyo encabezado contenga `ana_upload_id` (sin distinguir mayúsculas) con "La columna ana_upload_id está reservada", y MUST marcar como error una variable `{var}` de la columna `message` del CSV que no resuelve contra ninguna otra columna pero sí, por coincidencia parcial, contra `ana_upload_id` (p. ej. `{upload}`).

#### Scenario: CSV con la columna reservada
- **WHEN** el líder carga para v3 un CSV con columna `ana_upload_id`
- **THEN** la página muestra "La columna ana_upload_id está reservada" y no permite continuar

#### Scenario: Variable que tomaría el identificador
- **WHEN** la columna `message` del CSV usa `{upload}` y ninguna columna del CSV contiene `upload`
- **THEN** la página muestra "Variable desconocida: {upload}" y deshabilita la vista previa

## REMOVED Requirements

### Requirement: Mensaje o plantilla
**Reason**: quien carga ya no define el mensaje; el agente lo escribe en "Mi asignación" (ANA Admin para v3, desktop para v4).
**Migration**: ninguna para el usuario; el código de país de v4 pasa al requisito "Entrega en v4" y v3 ignora `message` si un cliente anterior lo envía.

## ADDED Requirements

### Requirement: Incluir supervisores
El formulario SHALL ofrecer el toggle "Incluir supervisores" (apagado por defecto). Encendido, los supervisores habilitados de la campaña y flota se suman a los destinatarios del reparto y del selector de "Asignar a un agente"; apagado, MUST excluirse. El BFF SHALL recalcular el plan con el mismo filtro y responder 409 si difiere.

#### Scenario: Toggle apagado
- **WHEN** `ana` es agente y `sara` supervisora, ambas habilitadas, y el toggle está apagado
- **THEN** el reparto y el selector solo ofrecen a `ana`

#### Scenario: Toggle encendido
- **WHEN** se enciende el toggle con 4 filas válidas
- **THEN** la vista previa reparte 2 a `ana` y 2 a `sara`

#### Scenario: Supervisor deshabilitado tras la vista previa
- **WHEN** con el toggle encendido se deshabilita a `sara` antes de confirmar
- **THEN** el BFF responde 409 y la página pide revisar la nueva vista previa
