# Spec Delta

## MODIFIED Requirements

### Requirement: Consulta periódica de jobs
Con token presente y sin envío en curso, el poller SHALL consultar `GET /jobs/poll` cada 5 segundos (esperando 2 s si no hay token o hay envío en curso) y publicar al renderer todos los jobs del operador, pendientes e historial. Un 401 MUST disparar la renovación del token y conservar la última asignación publicada; otra respuesta no exitosa o un error de red se ignoran hasta el siguiente ciclo sin vaciar la asignación. El poller se detiene al cerrar sesión, al expirar la sesión o al salir.

#### Scenario: Jobs nuevos
- **WHEN** el líder reparte contactos al agente
- **THEN** en máximo 5 segundos aparecen en "Mi asignación"

#### Scenario: Respuesta 401
- **WHEN** el backend rechaza el token del poller
- **THEN** "Mi asignación" conserva los contactos ya mostrados y el poller reintenta con un token renovado

#### Scenario: Backend caído
- **WHEN** `GET /jobs/poll` responde 500 o falla la red
- **THEN** la asignación publicada no cambia hasta la siguiente consulta exitosa
