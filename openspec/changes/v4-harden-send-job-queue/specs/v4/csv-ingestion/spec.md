# Spec Delta

## MODIFIED Requirements

### Requirement: Presign de CSV con metadata firmada
El sistema SHALL responder 200 `{url,key,maxBytes,metadata,eligibleAgents?}` con un PUT prefirmado (300 s, `Content-Type: text/csv`) a `csv-uploads/<usuario>/<epochMs>_<filename>` (saneado, default `upload.csv`; `.`/`..` → 400). La metadata MUST incluir `operatorid`, `template` (default `{mensaje}`), `countrycode` (`52`), `phonecolumn` (`telefono`), `campaignid` = la key sin `csv-uploads/`, `label` (`campaignId` del cliente, ≤ 100), `distribute` (`1`/`0`), `campaign` y `assignments` si aplica.

#### Scenario: Preview del reparto
- **WHEN** un líder pide presign con `distribute: true` sin `assignments`
- **THEN** la respuesta incluye `eligibleAgents` con los agentes que recibirían los jobs y `maxBytes: 10485760`

#### Scenario: Identificador del cliente
- **WHEN** el desktop pide presign con `campaignId: "cartera-52"`
- **THEN** la metadata trae `label: "cartera-52"` y `campaignid` igual a la key sin el prefijo `csv-uploads/`

> Nota: `maxBytes` es informativo; la URL prefirmada no limita el tamaño del archivo subido.

### Requirement: Forma del job generado
Cada job MUST escribirse en `ana-backend-jobs-<stage>` con `operatorId` destino, `jobId = "<campaignId>#<índice>"` usando el `campaignid` generado por el servidor, `campaignId`, `label` (si existe), `campaign` (omitido si vacío), `phone`, `template`, `row` normalizada, `countryCode`, `srcKey` = key del CSV, `status: "pending"`, `attempts: 0` y `ttl` a 7 días.

#### Scenario: Dos CSV con el mismo campaignId
- **WHEN** dos subidas envían el mismo `campaignId` de cliente (por ejemplo, el mismo `cartera.csv` con la misma lada) para el mismo agente
- **THEN** cada subida genera sus propios jobs y ninguno sobrescribe a los de la otra, aunque los de la primera ya estén enviados

> Nota: `srcKey` se conserva en cada job como referencia de la carga aunque el objeto ya se haya borrado.

## ADDED Requirements

### Requirement: Escritura completa de jobs
El trigger SHALL reintentar los items no procesados de cada escritura por lotes hasta 6 veces con espera exponencial. Si después quedan jobs sin escribir MUST registrar `evt:"csv_jobs_partial"` con la key, los escritos y los faltantes, y terminar sin lanzar error.

#### Scenario: Limitación temporal de DynamoDB
- **WHEN** una escritura por lotes devuelve 10 items no procesados y el reintento los acepta
- **THEN** todos los jobs del CSV quedan escritos

### Requirement: Procesamiento único por objeto
Antes de escribir jobs, el trigger MUST registrar de forma condicional que el objeto (`srcKey`) fue procesado; si ya estaba registrado SHALL ignorar el evento y registrar `evt:"csv_duplicate_event"`, sin escribir jobs.

#### Scenario: Evento S3 duplicado
- **WHEN** S3 entrega dos veces el evento del mismo CSV después de que un agente ya envió algunos de sus jobs
- **THEN** el segundo evento no escribe nada y los jobs enviados conservan su estado

### Requirement: Borrado del CSV procesado
Tras escribir todos los jobs de un CSV, el trigger SHALL borrar el objeto de S3; si quedaron jobs sin escribir MUST conservarlo para diagnóstico. El bucket MUST expirar cualquier objeto de `csv-uploads/` a los 7 días como respaldo.

#### Scenario: Carga repartida
- **WHEN** un líder sube un CSV que se reparte entre tres agentes y el trigger escribe todos los jobs
- **THEN** el CSV deja de existir en S3 aunque ningún agente haya enviado todavía

#### Scenario: Escritura parcial
- **WHEN** quedan jobs sin escribir tras los reintentos
- **THEN** el CSV se conserva hasta su expiración a los 7 días

### Requirement: CSV ilegible
Si el CSV no se puede parsear, el trigger SHALL registrar `evt:"csv_rejected"` con `reason:"parse_error"` y la key, no crear jobs y MUST terminar sin lanzar error para que el evento no se reintente.

#### Scenario: Comillas sin cerrar
- **WHEN** se sube un CSV con una comilla sin cerrar
- **THEN** no se crea ningún job y el log contiene `csv_rejected` con `parse_error`
