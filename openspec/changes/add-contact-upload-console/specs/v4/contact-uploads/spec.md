# Spec Delta

## Purpose

Registrar en el backend v4 el resultado de cada CSV de contactos procesado por el trigger de carga (filas, jobs y reparto por agente) y permitir a líderes y administradores consultar ese historial por campaña.

## ADDED Requirements

### Requirement: Registro de cargas procesadas
Tras escribir los jobs de un CSV con campaña, el trigger SHALL guardar un registro con `campaign`, `srcKey`, `fileName`, `uploadedBy` (operador de la metadata firmada), `uploadedAt` (fecha del objeto S3), `mode` (`self`, `distribute` o `assignments`), `totalRows`, `validRows`, `jobs`, `perAgent` (`{operatorId: jobs}`) y `status:"processed"`, conservado 180 días.

#### Scenario: Reparto explícito
- **WHEN** se procesa un CSV de `didi_vip` con 100 filas, 98 con teléfono y `assignments:{"ana.lopez":1,"luis":1}`
- **THEN** el registro tiene `mode:"assignments"`, `validRows:98`, `jobs:98` y `perAgent:{"ana.lopez":49,"luis":49}`

### Requirement: Registro de cargas rechazadas
Cuando el trigger ignora un CSV con campaña en su metadata (tamaño mayor a 10 MB, más de 50 000 filas o sin operador), SHALL guardar el registro con `status:"rejected"`, `reason` (`too_large`, `too_many_rows`, `missing_operator`) y sin jobs.

#### Scenario: CSV con demasiadas filas
- **WHEN** se sube un CSV de `didi_vip` con 60 000 filas
- **THEN** no se crean jobs y el historial muestra la carga con `status:"rejected"` y `reason:"too_many_rows"`

### Requirement: Registro idempotente
El registro SHALL identificarse por campaña y `srcKey`, de modo que un evento S3 repetido para el mismo objeto actualice el mismo registro en lugar de crear otro.

#### Scenario: Evento duplicado
- **WHEN** S3 entrega dos veces el evento de creación del mismo objeto
- **THEN** el historial contiene una sola entrada para ese `srcKey`

### Requirement: Consulta del historial de cargas
El sistema SHALL exponer `GET /uploads/history?campaign=<c>` (JWT) que responde 200 con `{"campaign","items":[...]}`, las 50 cargas más recientes por `uploadedAt` descendente, o con `srcKey=<k>` solo esa carga; se permite a admins y a usuarios con `ana:contacts:list:upload` sobre campañas propias (o `*`), con chequeo independiente de `PERMISSIONS_ENFORCED`.

#### Scenario: Líder de la campaña
- **WHEN** un líder de `didi_vip` consulta `GET /uploads/history?campaign=didi_vip`
- **THEN** recibe las cargas de `didi_vip` de la más reciente a la más antigua

#### Scenario: Campaña ajena
- **WHEN** un líder de `didi_vip` consulta `campaign=zendere`
- **THEN** el sistema responde 403 con `{"error":"sin permiso"}`

#### Scenario: Carga aún no procesada
- **WHEN** se consulta con `srcKey` de un objeto que el trigger todavía no procesa
- **THEN** el sistema responde 200 con `items` vacío
