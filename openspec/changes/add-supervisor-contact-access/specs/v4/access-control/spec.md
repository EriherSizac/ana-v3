# Spec Delta

## ADDED Requirements

### Requirement: Rol de supervisor por nombre
Un rol cuyo `role_name` contiene "supervisor" tras normalizar a minúsculas y quitar diacríticos SHALL otorgar siempre `ana:contacts:list:upload` y `ana:contacts:list:distribute`, y `ana:campaign:message:send` salvo deny `-ana:campaign:message:send` de ese rol (local o inline). MUST NOT otorgar `ana:admin:agents:manage`; las campañas del usuario siguen saliendo de `campaign_name` de sus roles.

#### Scenario: Supervisor de campaña
- **WHEN** el usuario solo tiene el rol "Supervisor DIDI VIP" con `campaign_name` `DIDI_VIP`
- **THEN** `GET /me` incluye `ana:contacts:list:upload`, `ana:contacts:list:distribute` y `ana:campaign:message:send`, no incluye `ana:admin:agents:manage`, y `campaigns` es `["DIDI_VIP"]`

#### Scenario: Nombre en mayúsculas y con acento
- **WHEN** el rol se llama "SUPERVISÓR Zendere"
- **THEN** se trata como rol de supervisor

#### Scenario: Envío desactivado en el rol
- **WHEN** el rol "Supervisor DIDI VIP" guarda `-ana:campaign:message:send` en el almacén local
- **THEN** el acceso incluye carga y reparto pero no `ana:campaign:message:send`
