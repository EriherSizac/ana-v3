# Spec Delta

## ADDED Requirements

### Requirement: Mensajes de estado del respaldo mostrados como texto
El overlay "Respaldando Chats" del respaldo masivo y las notificaciones del respaldo automático MUST mostrar como texto plano, nunca interpretado como HTML, los valores variables que muestran: título del chat tomado de WhatsApp, mensajes de error y estadísticas devueltas por el backend.

#### Scenario: Chat con nombre que contiene marcado HTML
- **WHEN** el respaldo masivo procesa un chat cuyo título es `<img src=x onerror=x()>`
- **THEN** el overlay muestra "Procesando: <img src=x onerror=x()>" como texto literal y no se ejecuta código

#### Scenario: Error con marcado HTML
- **WHEN** el respaldo masivo falla con un mensaje de error que contiene etiquetas HTML
- **THEN** el overlay muestra "Error: …" con las etiquetas como texto literal y conserva el botón "Cerrar"

#### Scenario: Estadísticas del backend no numéricas
- **WHEN** el respaldo automático responde con `stats.new_messages` que no es un número
- **THEN** la notificación "Chat respaldado (… nuevos mensajes)" muestra el valor como texto literal
