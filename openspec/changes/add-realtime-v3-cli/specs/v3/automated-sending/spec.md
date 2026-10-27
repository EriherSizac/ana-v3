# Spec Delta

## MODIFIED Requirements

### Requirement: Intervalo de polling
Cuando un poll no devuelve contactos, y también al terminar un ciclo con contactos, el CLI SHALL esperar con cuenta regresiva antes del siguiente poll: 30 segundos con el canal realtime inactivo (`v3/cli-realtime`) y 2 minutos con el canal activo; la espera MUST terminar antes si llega un aviso de asignación para la sesión. El ciclo MUST continuar indefinidamente hasta que el proceso se cierre.

#### Scenario: Sin asignaciones
- **WHEN** el backend responde 404 o un CSV sin filas de datos y el canal realtime está inactivo
- **THEN** el CLI imprime "No hay contactos asignados." y espera 30 segundos antes de volver a consultar

#### Scenario: Sin asignaciones con el canal activo
- **WHEN** el backend responde 404 y el canal realtime está activo
- **THEN** el CLI espera 2 minutos antes de volver a consultar, salvo que llegue `assignment.published` para su agente y campaña

#### Scenario: Asignación publicada durante la espera
- **WHEN** el CLI está esperando el siguiente poll y recibe `assignment.published` de su agente y campaña
- **THEN** termina la espera y consulta `GET /get/chats/...` en máximo 2 segundos
