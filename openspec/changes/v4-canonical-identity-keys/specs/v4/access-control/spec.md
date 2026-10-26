# Spec Delta

## MODIFIED Requirements

### Requirement: Campañas del usuario
El sistema SHALL derivar `campaigns` como el conjunto de `campaign_name` de los roles del usuario sin espacios laterales, sin duplicados aunque difieran en mayúsculas y con la grafía del catálogo de campañas cuando exista coincidencia. El valor `*` en `campaigns` MUST interpretarse como acceso global a campañas en las rutas que lo comprueban.

#### Scenario: Usuario con dos roles de la misma campaña
- **WHEN** el usuario tiene dos roles con `campaign_name = "didi_vip"`
- **THEN** `campaigns` es `["didi_vip"]`

#### Scenario: Roles con distinta grafía
- **WHEN** el usuario tiene roles con `campaign_name` `"DIDI_VIP"` y `"didi_vip "` y el catálogo contiene `didi_vip`
- **THEN** `campaigns` es `["didi_vip"]`

## ADDED Requirements

### Requirement: Comparación de campañas sin distinguir mayúsculas
Toda ruta que compare una campaña recibida (body, query, metadata o roles) con las campañas del usuario o con el catálogo MUST compararlas sin espacios laterales y sin distinguir mayúsculas, y SHALL guardar y enviar al CRM la grafía del catálogo.

#### Scenario: Subida con otra grafía
- **WHEN** un líder con rol de `DIDI_VIP` pide presign con `campaign: "Didi_Vip"` y el catálogo tiene `didi_vip`
- **THEN** la subida se permite y los jobs y las interacciones usan `didi_vip`

#### Scenario: Heartbeat con otra grafía
- **WHEN** un agente de `didi_vip` envía heartbeat con `{"campaign":"DIDI_VIP"}`
- **THEN** el heartbeat se acepta y se registra en la campaña `didi_vip`
