# Spec Delta

## ADDED Requirements

### Requirement: Sandbox del navegador de WhatsApp
El Chromium que usa el cliente de WhatsApp MUST lanzarse con su sandbox activo, sin `--no-sandbox` ni `--disable-setuid-sandbox`, tanto con el navegador empaquetado como en desarrollo.

#### Scenario: Arranque en build instalado
- **WHEN** la app instalada inicia WhatsApp
- **THEN** el proceso de Chromium corre sin los argumentos `--no-sandbox` ni `--disable-setuid-sandbox` y WhatsApp conecta normalmente
