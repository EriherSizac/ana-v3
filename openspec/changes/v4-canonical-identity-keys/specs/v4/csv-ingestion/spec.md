# Spec Delta

## MODIFIED Requirements

### Requirement: Borrado de CSV propio
`POST /uploads/delete` con `{key}` SHALL borrar el objeto solo si `key` empieza con `csv-uploads/<operador codificado>/`, con la misma codificación de operador que las llaves de media, y responder 200 `{"deleted":key}`; en otro caso MUST responder 403 `{"error":"key no permitida"}`.

#### Scenario: CSV ajeno
- **WHEN** un usuario intenta borrar `csv-uploads/otro/123_a.csv`
- **THEN** el sistema responde 403 `{"error":"key no permitida"}`

#### Scenario: Prefijo parecido
- **WHEN** el operador `a_b` intenta borrar `csv-uploads/a~40b/123_a.csv`
- **THEN** el sistema responde 403 `{"error":"key no permitida"}`

### Requirement: Selección de destinatarios
Los jobs SHALL asignarse por índice de fila válida `i` a `targets[i % N]`, donde `targets` es: la lista expandida por pesos si hay `assignments` (p. ej. `{a:2,b:1}` → `[a,a,b]`); si no, los agentes elegibles si `distribute = 1`; y el uploader cuando no hay reparto o la lista resultante queda vacía. Cada destinatario MUST convertirse al `operatorId` canónico, y los repetidos tras convertir SHALL unirse (sumando sus pesos).

#### Scenario: Reparto sin agentes elegibles
- **WHEN** `distribute = 1` y la API del Dashboard no devuelve agentes
- **THEN** todos los jobs quedan asignados al uploader

#### Scenario: Usernames con mayúsculas
- **WHEN** `assignments` es `{"Ana.Lopez":1,"ana.lopez":1,"luis":1}`
- **THEN** `ana.lopez` recibe dos tercios de los jobs y `luis` un tercio, todos en particiones canónicas
