# Spec Delta

## MODIFIED Requirements

### Requirement: Registro de apertura de chat
Al abrir una conversación en su propia sesión, solo si la configuración remota vigente tiene `openChatInteraction` en `true` (por defecto `false`), la app SHALL notificar `POST /interactions/open` con el chatId, sin bloquear la UI e ignorando errores; con `false` MUST NOT notificar. La deduplicación por chat y día MUST quedar a cargo del backend; la app notifica en cada apertura.

#### Scenario: Reapertura del mismo chat
- **WHEN** con `openChatInteraction` en `true` el agente abre el mismo chat tres veces en el día
- **THEN** la app envía tres notificaciones y el backend decide cuántas registrar

#### Scenario: Viendo a otro agente
- **WHEN** un admin abre un chat de otro agente
- **THEN** no se notifica apertura

#### Scenario: Registro desactivado
- **WHEN** `openChatInteraction` es `false`, o nunca se pudo leer la configuración, y el agente abre un chat propio
- **THEN** no se llama `POST /interactions/open`
