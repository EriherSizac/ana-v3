# Spec Delta

## MODIFIED Requirements

### Requirement: Aprobación de envío
El agente SHALL aprobar con "Enviar a N contacto(s)", deshabilitado sin selección o con envío en curso. Por cada archivo con jobs seleccionados MUST mostrarse su plantilla editable (la de su primer job; si no trae, marcada "(obligatorio: el líder no fijó uno)") y cada job se envía con la de su archivo. La aprobación MUST bloquearse si alguna queda vacía o usa variables ausentes en las columnas o alias de su archivo. Solo se envían jobs aún pendientes.

#### Scenario: Aprobación exitosa
- **WHEN** el agente selecciona 10 contactos y pulsa enviar
- **THEN** se muestra "Envío iniciado." en cuanto el envío arranca, sin esperar a que termine el lote, y lo no seleccionado queda pendiente

#### Scenario: Envío ya en curso
- **WHEN** se aprueba mientras otro lote se envía
- **THEN** se muestra "Error: Ya hay un envío en curso"

#### Scenario: Selección ya procesada
- **WHEN** ninguno de los seleccionados sigue pendiente
- **THEN** se muestra "Error: Sin envíos seleccionados"

#### Scenario: Dos archivos con plantillas distintas
- **WHEN** el agente selecciona contactos de dos cargas y edita solo la plantilla de la primera
- **THEN** los contactos de la primera reciben la plantilla editada y los de la segunda la de su propia carga

#### Scenario: Variable inexistente en un archivo
- **WHEN** la plantilla de un archivo usa `{apodo}` y ese archivo no tiene la columna ni un alias
- **THEN** se muestra la variable desconocida bajo ese archivo y "Enviar" queda deshabilitado

### Requirement: Búsqueda y selección
La búsqueda SHALL filtrar por nombre, crédito (`credit`, `credito`, `credit_id`, `id_credito`) o, con al menos 2 dígitos, por dígitos del teléfono. Todo job nuevo MUST quedar seleccionado por defecto y la selección se conserva entre ciclos, descartando los jobs que dejaron de estar pendientes. La casilla general marca o desmarca solo lo filtrado; clic en la fila alterna la selección.

#### Scenario: Búsqueda por últimos dígitos
- **WHEN** el agente escribe "1922"
- **THEN** la tabla muestra solo los contactos cuyo teléfono contiene esos dígitos

#### Scenario: Sin coincidencias
- **WHEN** la búsqueda no encuentra nada
- **THEN** se muestra "Sin coincidencias para “<texto>”."

#### Scenario: Contador tras enviar
- **WHEN** se envían 5 de 10 contactos seleccionados
- **THEN** el contador muestra 5 seleccionados de 5 pendientes

### Requirement: Progreso del envío
El main SHALL emitir progreso con fases `idle`, `sending`, `waiting` y `fileDone`, con total, hechos, enviados, fallidos, tiempo de espera y último teléfono. Una tarjeta flotante MUST mostrarse en cualquier pestaña con "Enviando", "En pausa" o "Lote completado", la barra, "Enviados", "Fallidos", "Pausa anti-bloqueo · siguiente en Xm Ys" y "Último: <teléfono enmascarado como `***` + últimos 4 dígitos>"; se puede ocultar y reaparece con el siguiente lote.

#### Scenario: Pausa visible
- **WHEN** el envío espera por el ritmo
- **THEN** la tarjeta muestra "En pausa" y la cuenta regresiva

#### Scenario: Teléfono enmascarado
- **WHEN** el último envío fue a `5215512341922`
- **THEN** la tarjeta muestra "Último: ***1922"
