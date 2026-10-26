# Spec Delta

## MODIFIED Requirements

### Requirement: Acuse, reporte y limpieza
Antes de enviar cada job, ya cumplido el ritmo, el main MUST reservarlo con `POST /jobs/claim` y no enviarlo si la reserva falla. Tras el job SHALL enviar `POST /jobs/ack` con `sent`, `no_whatsapp` o `error`, reintentándolo hasta 3 veces si falla, y reportar sin bloquear a `POST /interactions/report`. Al terminar un archivo, si no quedan jobs pendientes ni reservados de él, MUST pedir `POST /uploads/delete` del CSV. Fallos de reporte o borrado se ignoran.

#### Scenario: Lote completo
- **WHEN** se procesan todos los jobs de un archivo
- **THEN** cada job queda marcado con su resultado, el CRM recibe cada interacción y el CSV se borra de S3

#### Scenario: Reserva rechazada
- **WHEN** la reserva de un job responde 409 porque fue reasignado
- **THEN** ese mensaje no se envía y el lote sigue con el siguiente job

#### Scenario: Acuse con red intermitente
- **WHEN** el primer `POST /jobs/ack` falla por red y el segundo intento responde 200
- **THEN** el job queda con su resultado y no pasa a revisión

### Requirement: Vista Mi asignación
La vista SHALL mostrar pestañas "Pendientes (N)" (jobs no directos pendientes, `leased` o sin estado), "Por revisar (N)" (`sending` o `review`, de solo lectura) y "Enviados (N)" (enviado, sin WhatsApp, error o descartado, más reciente primero) con columnas Nombre, Crédito, Teléfono enmascarado y, en historial, Resultado ("Enviado", "Sin WhatsApp", "Error", "Descartado"). Al montarse MUST hidratarse con la última asignación del main sin esperar al siguiente ciclo.

#### Scenario: Sin pendientes
- **WHEN** el agente no tiene jobs pendientes
- **THEN** se muestra "Sin contactos pendientes. Cuando tu líder reparta una campaña (o subas un CSV propio), aparecerán aquí."

#### Scenario: Historial
- **WHEN** el agente abre "Enviados"
- **THEN** ve cada contacto procesado con su resultado y sin casillas de selección

#### Scenario: Contacto interrumpido
- **WHEN** el agente tiene un job en `review`
- **THEN** lo ve en "Por revisar" con el aviso "Se interrumpió durante el envío; tu líder decide si se reenvía." y sin casilla de selección
