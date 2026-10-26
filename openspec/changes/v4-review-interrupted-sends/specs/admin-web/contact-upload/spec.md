# Spec Delta

## ADDED Requirements

### Requirement: Contactos por revisar en cargas v4
El detalle de una carga v4 del historial SHALL mostrar la sección "Por revisar" con los jobs `review` y `discarded` de esa carga (v4 `GET /jobs/review` con su `srcKey`), agrupados por agente, con nombre, crédito, teléfono enmascarado, momento de la interrupción y estado; sin items muestra "Sin contactos por revisar".

#### Scenario: Carga con interrumpidos
- **WHEN** un líder abre el detalle de una carga v4 con 3 jobs por revisar de dos agentes
- **THEN** ve los 3 contactos agrupados por agente con su teléfono enmascarado

### Requirement: Resolver contactos por revisar v4
Para contactos `review`, la consola SHALL ofrecer "Descartar" y "Reenviar a…" (el mismo agente u otro agente habilitado de la campaña en el roster v4), individual o en lote, con `ConfirmDialog` que advierta "Este contacto pudo haber recibido el mensaje. Reenviarlo puede duplicarlo."; al confirmar MUST llamar v4 `POST /jobs/review/resolve` con el token del usuario y mostrar el resultado por contacto.

#### Scenario: Reenviar a otro agente
- **WHEN** el supervisor elige "Reenviar a…" `ana.lopez` para 2 contactos y confirma
- **THEN** los contactos aparecen como "Reenviado a ana.lopez" y `ana.lopez` los recibe como pendientes

#### Scenario: Destino deshabilitado
- **WHEN** el supervisor abre "Reenviar a…"
- **THEN** la lista solo contiene agentes habilitados de la campaña

### Requirement: Por revisar por campaña en v4
La consola SHALL ofrecer una vista "Por revisar (v4)" por campaña que liste todos los jobs por revisar de la campaña, incluidos los de envío directo (sin carga), con las mismas acciones de resolución.

#### Scenario: Envío directo interrumpido
- **WHEN** un job de `POST /send` quedó por revisar
- **THEN** aparece en la vista por campaña marcado "Envío directo" y se puede descartar o reenviar
