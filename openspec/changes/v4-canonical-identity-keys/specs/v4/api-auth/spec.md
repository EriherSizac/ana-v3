# Spec Delta

## MODIFIED Requirements

### Requirement: Identidad del operador desde el token
Cada handler autenticado SHALL tomar el identificador del operador (`operatorId`) del claim `cognito:username` del JWT y, si falta, del claim `sub`, sin espacios laterales y en minúsculas, y usarlo en todas las particiones, llaves y comparaciones. Si ninguno está presente, el handler MUST responder 401 con `{"error":"no autenticado"}`. El cliente no puede elegir su `operatorId` en ninguna ruta de escritura.

#### Scenario: Claim presente
- **WHEN** llega una solicitud autorizada con `cognito:username = "juan.perez"`
- **THEN** todos los datos leídos o escritos se particionan bajo `operatorId = "juan.perez"`

#### Scenario: Sin claims de usuario
- **WHEN** la solicitud llega a la Lambda sin `cognito:username` ni `sub`
- **THEN** el sistema responde 401 con `{"error":"no autenticado"}`

#### Scenario: Username con mayúsculas
- **WHEN** llega una solicitud con `cognito:username = "Ana.Lopez"`
- **THEN** sus datos se leen y escriben bajo `operatorId = "ana.lopez"`, el mismo que reciben los jobs que le reparte un líder como `ana.lopez`
