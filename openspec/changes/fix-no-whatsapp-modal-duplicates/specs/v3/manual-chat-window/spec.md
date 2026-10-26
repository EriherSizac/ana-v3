# Spec Delta

## MODIFIED Requirements

### Requirement: Botón de números sin WhatsApp
La ventana manual SHALL ofrecer un botón "ℹ️" que abre un modal "Números sin WhatsApp" con el total y los últimos 4 dígitos enmascarados (`**** 1234`) de los teléfonos con estado `no_whatsapp` en el archivo local `resultados.csv`, deduplicados por sus últimos 10 dígitos. El archivo MUST leerse como CSV estándar (campos entre comillas con comas, comillas dobles o saltos de línea). Abrir el modal MUST NOT enviar interacciones.

#### Scenario: Hay números sin WhatsApp
- **WHEN** el agente hace clic en el botón ℹ️ y `resultados.csv` contiene filas con estado `no_whatsapp`
- **THEN** el modal muestra "Total: N" y una píldora por número enmascarado
- **AND** no se envía ninguna solicitud a la API de interacciones

#### Scenario: Abrir el modal varias veces
- **WHEN** el agente abre y cierra el modal tres veces
- **THEN** no se registra ninguna interacción en el CRM

#### Scenario: Campos con comas y saltos de línea
- **WHEN** `resultados.csv` contiene una fila con `response` entre comillas que incluye comas y saltos de línea, y otra con `product` entre comillas que incluye una coma
- **THEN** el estado y el teléfono de cada fila se leen de sus columnas correctas
- **AND** el texto de `response` no genera filas ni teléfonos adicionales

#### Scenario: No hay números sin WhatsApp
- **WHEN** el archivo no existe, no tiene las columnas `phone` y `status`, o no tiene filas `no_whatsapp`
- **THEN** el modal indica que no hay números marcados, no muestra el botón de registro y no se envía ninguna interacción

#### Scenario: Cerrar el modal
- **WHEN** el agente hace clic en "×" o fuera del modal
- **THEN** el modal se cierra

## ADDED Requirements

### Requirement: Registro explícito de consulta de números sin WhatsApp
Solo cuando el ajuste remoto del CLI `noWhatsappConsultRegistration` (capacidad `v3/cli-remote-settings`) vale `true`, el modal SHALL mostrar un botón "Registrar consulta (N)", donde N es el número de teléfonos listados aún no registrados en ese equipo para el agente, la campaña y el día local actuales. Al pulsarlo, MUST enviar en una sola solicitud `POST /interactions` una interacción por teléfono pendiente, hasta 200, y SHALL deshabilitarse mientras la solicitud está en curso.

#### Scenario: Ajuste desactivado o no disponible
- **WHEN** `noWhatsappConsultRegistration` es `false`, no está definido o no se pudo obtener
- **THEN** el modal no muestra el botón "Registrar consulta" y no se envía ninguna interacción `Consulta No Whatsapp`

#### Scenario: Solicitud de registro con el ajuste desactivado
- **WHEN** se invoca el registro desde la página mientras el ajuste vale `false`
- **THEN** el CLI rechaza la solicitud sin llamar a la API de interacciones

#### Scenario: Registro de pendientes
- **WHEN** el ajuste vale `true`, el modal lista 5 números, 2 ya registrados hoy en esa campaña, y el agente pulsa "Registrar consulta (3)"
- **THEN** se envía un lote con 3 interacciones con subdictamen `Consulta No Whatsapp`, `contactable: false`, `credit_id` vacío, teléfono de 10 dígitos, `inoutbound: inbound`, canal `whatsapp` y comentario `no_whatsapp_info_registered`

#### Scenario: Doble clic
- **WHEN** el agente pulsa el botón dos veces seguidas
- **THEN** solo se envía un lote

#### Scenario: Todo registrado
- **WHEN** todos los números listados ya se registraron hoy en esa campaña
- **THEN** el modal muestra "Consulta ya registrada hoy" y no ofrece el botón activo

#### Scenario: Más de 200 pendientes
- **WHEN** hay 250 números pendientes y el agente pulsa el botón
- **THEN** se envían los primeros 200 y, tras el éxito, el botón muestra "Registrar consulta (50)"

### Requirement: Persistencia de consultas registradas
Con el registro habilitado, tras una respuesta 2xx de la API de interacciones la ventana manual MUST guardar los teléfonos enviados, agrupados por agente, campaña y fecha local, en un archivo del directorio de datos del CLI que sobrevive a reinicios. Si la respuesta no es 2xx o hay error de red, MUST NOT marcarlos y SHALL mostrar el error en el modal. Las entradas de más de 7 días SHALL descartarse. Con el registro deshabilitado el archivo SHALL NOT crearse ni modificarse.

#### Scenario: Registro deshabilitado
- **WHEN** `noWhatsappConsultRegistration` no vale `true` y el agente abre el modal
- **THEN** no se crea ni modifica el archivo de registro

#### Scenario: Reinicio del CLI el mismo día
- **WHEN** el agente registró la consulta, reinicia ANA y vuelve a abrir el modal ese mismo día
- **THEN** los números registrados no cuentan como pendientes

#### Scenario: Día siguiente
- **WHEN** el agente abre el modal al día local siguiente con los mismos números
- **THEN** todos los números vuelven a contar como pendientes

#### Scenario: Error del CRM
- **WHEN** `POST /interactions` responde con error o falla la red
- **THEN** el modal muestra "❌ No se pudo registrar" con el estado, los números siguen pendientes y el botón vuelve a habilitarse

#### Scenario: Archivo de registro dañado
- **WHEN** el archivo de registro no existe o no es JSON válido
- **THEN** todos los números cuentan como pendientes y el siguiente registro exitoso reescribe el archivo
