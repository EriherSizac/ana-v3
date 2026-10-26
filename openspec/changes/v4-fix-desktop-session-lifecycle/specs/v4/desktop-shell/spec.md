# Spec Delta

## MODIFIED Requirements

### Requirement: Heartbeat del agente
Tras cargar `/me`, el renderer SHALL registrar en el main la primera campaña distinta de `*` del usuario (o la primera de la lista). El main MUST enviar `POST /agents/heartbeat` con esa campaña solo mientras WhatsApp esté en estado `connected`: al registrarla, cuando WhatsApp pasa a conectado y cada 5 minutos. Al cerrar sesión o expirar la sesión la campaña registrada SHALL olvidarse.

#### Scenario: Agente conectado
- **WHEN** el agente tiene campaña registrada y WhatsApp conectado
- **THEN** el backend recibe un heartbeat de esa campaña cada 5 minutos

#### Scenario: Sin campaña
- **WHEN** `/me` devuelve una lista de campañas vacía
- **THEN** no se registra campaña y no se envían heartbeats

#### Scenario: Atascado en QR
- **WHEN** el cliente de WhatsApp existe pero está mostrando QR o autenticando
- **THEN** no se envía heartbeat y el agente aparece inactivo tras 10 minutos
