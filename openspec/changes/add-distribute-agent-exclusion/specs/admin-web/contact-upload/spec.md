# Spec Delta

## ADDED Requirements

### Requirement: Quitar agentes del reparto
En modo "Repartir", la página SHALL listar los destinatarios habilitados con un control "Quitar" (X) por cada uno y, para los quitados, "Reagregar" (+), además de "Reagregar todos". El plan MUST repartir solo entre los no quitados con la misma regla `i mod n`; sin ninguno, la vista previa MUST bloquearse con "Reagrega al menos un agente". "Asignar a un agente" no usa la lista.

#### Scenario: Quitar a un agente
- **WHEN** los habilitados son `ana`, `beto`, `carla`, el usuario quita a `beto` y previsualiza 10 filas válidas
- **THEN** la vista previa reparte 5 a `ana` y 5 a `carla` y no muestra a `beto`

#### Scenario: Reagregar
- **WHEN** el usuario pulsa "Reagregar beto"
- **THEN** `beto` vuelve a contar en el reparto y la vista previa anterior se descarta

#### Scenario: Quitar a todos
- **WHEN** el usuario quita a todos los habilitados
- **THEN** el botón "Vista previa" queda deshabilitado con el aviso "Reagrega al menos un agente"

#### Scenario: Cambio de destino
- **WHEN** el usuario cambia de campaña, flota o "Incluir supervisores"
- **THEN** la lista vuelve a incluir a todos los habilitados

### Requirement: Verificación del plan con exclusiones
Al confirmar, la página SHALL enviar los usuarios quitados como `excluded`; el BFF MUST recalcular el plan con los habilitados vigentes menos `excluded` y responder 409 si difiere del previsualizado, y 400 si `excluded` no es una lista de usernames.

#### Scenario: Entrega sin el agente quitado
- **WHEN** se confirma una carga v3 con `excluded: ["beto"]` y un plan entre `ana` y `carla`
- **THEN** el BFF entrega archivos solo para `ana` y `carla`

#### Scenario: Plan que no corresponde a las exclusiones
- **WHEN** la solicitud trae `excluded: ["beto"]` pero el plan incluye a `beto`
- **THEN** el BFF responde 409 sin entregar
