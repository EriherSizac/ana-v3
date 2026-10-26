# Spec Delta

## Purpose

Permitir cambiar el comportamiento del CLI v3 sin publicar un release, mediante una configuración global guardada en el backend v3, editable solo por usuarios con rol Developer y leída por el CLI con valores seguros por defecto.

## ADDED Requirements

### Requirement: Catálogo de configuración del CLI
El sistema SHALL definir un catálogo cerrado de configuraciones con nombre, tipo y valor por defecto; inicialmente solo `noWhatsappConsultRegistration` (booleano, por defecto `false`), que indica si el CLI ofrece registrar en el CRM el subdictamen "Consulta No Whatsapp". Toda configuración fuera del catálogo MUST rechazarse al escribir e ignorarse al leer.

#### Scenario: Valor por defecto
- **WHEN** nunca se ha guardado configuración
- **THEN** la configuración efectiva es `{"noWhatsappConsultRegistration":false}`

### Requirement: Almacenamiento de la configuración
El sistema SHALL guardar la configuración en `config/cli-settings.json` del bucket `ana-backend-storage-{stage}` como `{"schemaVersion":1,"settings":{...},"updatedAt","updatedBy"}`, con solo las configuraciones del catálogo, fecha ISO 8601 UTC y `updatedBy` el username en minúsculas de quien guardó.

#### Scenario: Documento guardado
- **WHEN** `erick.silva` activa `noWhatsappConsultRegistration`
- **THEN** el objeto contiene `"settings":{"noWhatsappConsultRegistration":true}` y `"updatedBy":"erick.silva"`

### Requirement: Configuración efectiva
La configuración efectiva SHALL ser la de valores por defecto del catálogo reemplazada por los valores guardados válidos (del tipo correcto). Si el objeto no existe se usan los valores por defecto; si es ilegible o de otra `schemaVersion`, las lecturas MUST responder error en lugar de inventar valores.

#### Scenario: Valor con tipo incorrecto
- **WHEN** el objeto guardado tiene `"noWhatsappConsultRegistration":"true"` (texto)
- **THEN** la configuración efectiva usa `false`

### Requirement: Rol Developer
Las rutas de administración de la configuración SHALL permitirse solo a usuarios con algún `roleNames` de v4 `GET /me` que contenga `developer` sin distinguir mayúsculas ni acentos, resuelto como en la autorización de `/admin/*` de `v3/backend-api-security`; ser admin o líder no MUST bastar. Sin el rol responde 403.

#### Scenario: Administrador sin rol Developer
- **WHEN** un usuario con `isAdmin` y sin rol Developer llama a `POST /admin/cli-settings`
- **THEN** el sistema responde 403 con `{"success":false,"message":"Solo Developer"}`

### Requirement: Consulta de administración de la configuración
El sistema SHALL exponer `GET /admin/cli-settings` que responde 200 con `{"success":true,"data":{"settings","catalog":[{"key","type","default","description"}],"updatedAt","updatedBy"}}`, con `settings` efectivos y `updatedAt`/`updatedBy` nulos si nunca se guardó.

#### Scenario: Sin configuración guardada
- **WHEN** un Developer consulta la configuración y el objeto no existe
- **THEN** responde 200 con los valores por defecto y `updatedAt` nulo

### Requirement: Actualización de la configuración
El sistema SHALL exponer `POST /admin/cli-settings` con body `{"settings":{...}}` (parcial) que valida cada llave contra el catálogo y su tipo, guarda el resultado combinado con escritura condicional (hasta 3 reintentos, luego 409) y responde 200 con el mismo formato que la consulta; una llave desconocida o de tipo incorrecto MUST responder 400 sin escribir.

#### Scenario: Activar el registro de consulta
- **WHEN** un Developer envía `{"settings":{"noWhatsappConsultRegistration":true}}`
- **THEN** el sistema guarda el valor, registra autor y fecha y responde 200 con la configuración efectiva

#### Scenario: Llave desconocida
- **WHEN** el body incluye `{"settings":{"modoTurbo":true}}`
- **THEN** el sistema responde 400 con `{"success":false,"message":"Configuración desconocida: modoTurbo"}`

### Requirement: Lectura de la configuración por el CLI
El sistema SHALL exponer `GET /agent/settings`, autenticada como las rutas `/agent/*` de `v3/backend-api-security` (ID token del CLI siempre exigido), que responde 200 con `{"settings":{...},"updatedAt"}` con la configuración efectiva y 500 `{"error":"Configuración no disponible"}` si el objeto es ilegible.

#### Scenario: CLI autenticado
- **WHEN** un CLI con ID token válido llama a `GET /agent/settings`
- **THEN** recibe 200 con `{"settings":{"noWhatsappConsultRegistration":<valor efectivo>},"updatedAt":<fecha o null>}`

### Requirement: Consumo de la configuración en el CLI
El CLI SHALL consultar `GET /agent/settings` tras iniciar sesión y luego cada 5 minutos (timeout 5 s), guardando en memoria el último resultado exitoso y sin persistirlo en disco. Si nunca obtuvo una respuesta exitosa en la ejecución, MUST usar los valores por defecto del catálogo.

#### Scenario: Backend inalcanzable al arrancar
- **WHEN** el CLI arranca sin red hacia el backend
- **THEN** usa `noWhatsappConsultRegistration=false` y vuelve a intentar a los 5 minutos

#### Scenario: Fallo después de una lectura exitosa
- **WHEN** el CLI ya leyó `true` y una consulta posterior falla
- **THEN** conserva `true` hasta la siguiente lectura exitosa

#### Scenario: Cambio desde ANA Admin
- **WHEN** un Developer desactiva el flag
- **THEN** los CLIs en uso aplican `false` a más tardar 5 minutos después, sin reiniciar

### Requirement: Valor vigente disponible para las ventanas del CLI
El CLI SHALL exponer el valor vigente de cada configuración a sus ventanas (automatización, manual y monitor) y aplicarlo sin reiniciarlas cuando cambie; ninguna ventana MUST leer la configuración por su cuenta ni asumir un valor distinto del vigente.

#### Scenario: Ventana manual abierta durante el cambio
- **WHEN** la ventana manual está abierta y el valor cambia a `true`
- **THEN** la ventana usa `true` en la siguiente acción que dependa del flag
