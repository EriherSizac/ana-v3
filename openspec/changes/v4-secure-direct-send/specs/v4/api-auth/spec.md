# Spec Delta

## MODIFIED Requirements

### Requirement: Autenticación por API key en POST /send
La ruta `POST /send` SHALL publicarse sin authorizer Cognito y MUST autenticarse comparando en tiempo constante el header `x-api-key` con `SEND_API_KEY` o, solo durante una rotación, con `SEND_API_KEY_NEXT`, ambas provistas por un almacén de secretos al desplegar. Si ninguna está configurada o el header no coincide con alguna, MUST responder 401 `{"error":"no autorizado"}` (fail-closed). Ningún archivo versionado del repositorio SHALL contener el valor de una key.

#### Scenario: Key incorrecta
- **WHEN** se llama `POST /send` con un `X-Api-Key` distinto al configurado
- **THEN** el sistema responde 401 con `{"error":"no autorizado"}`

#### Scenario: Key no configurada en el backend
- **WHEN** `SEND_API_KEY` está vacía en el entorno de la Lambda
- **THEN** toda llamada a `POST /send` responde 401, aunque traiga un header `X-Api-Key`

#### Scenario: Rotación en curso
- **WHEN** `SEND_API_KEY_NEXT` está configurada y un integrador envía esa key
- **THEN** la solicitud se autentica igual que con `SEND_API_KEY`

#### Scenario: Key retirada
- **WHEN** termina la rotación y un integrador sigue enviando la key anterior
- **THEN** el sistema responde 401 con `{"error":"no autorizado"}`

## ADDED Requirements

### Requirement: Límite de tasa en POST /send
La ruta `POST /send` MUST tener un límite de tasa en API Gateway de 5 solicitudes por segundo con ráfaga de 10; las solicitudes que lo excedan SHALL rechazarse con 429 sin invocar la Lambda ni encolar jobs.

#### Scenario: Ráfaga excesiva
- **WHEN** un integrador envía 50 solicitudes en un segundo
- **THEN** las que exceden el límite reciben 429 y no se crea ningún job por ellas
