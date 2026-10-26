# Spec Delta

## Purpose

Autenticar a los usuarios de ANA Admin contra el pool de Cognito compartido de Pernexium, compartiendo la sesión con las demás apps del apex por cookie de dominio, y verificar en el servidor (BFF) la identidad de cada solicitud.

## ADDED Requirements

### Requirement: Sesión compartida por cookie de dominio
La app SHALL guardar los tokens de Cognito del pool `us-east-2_UepfOyKpd` en cookies (no en `localStorage`) con `path=/`, `sameSite=lax` y expiración de 1 día; en producción con `domain=.pernexium.com.mx` y `secure`, y en desarrollo sin `domain` y sin `secure`. Pool, client id y dominio MUST venir de variables de entorno públicas, sin valores fijos en el código.

#### Scenario: Sesión iniciada en otra app del apex
- **WHEN** un usuario ya inició sesión en otra app Pernexium que usa el mismo pool, App Client y configuración de cookie, y abre `https://ana-admin.pernexium.com.mx`
- **THEN** la app reconoce la sesión sin pedir credenciales

#### Scenario: Desarrollo local
- **WHEN** la app corre en `http://localhost` con `NODE_ENV=development`
- **THEN** las cookies se escriben sin `domain` ni `secure` y el inicio de sesión funciona

### Requirement: Pantalla de login por username
La página `/login` SHALL usar fondo azul (`pernexium-gradient` o `primary`) con texto `primary-foreground`, y pedir un campo "Usuario" que acepte el username tal cual (sin `type="email"` ni validación de correo) y un campo de contraseña con mostrar/ocultar. No MUST ofrecer alta de usuarios ni recuperación de contraseña.

#### Scenario: Username que no es correo
- **WHEN** el usuario escribe `erick.silva` y su contraseña y envía el formulario
- **THEN** la app intenta el inicio de sesión con ese username sin mostrar errores de formato

#### Scenario: Credenciales incorrectas
- **WHEN** Cognito rechaza el usuario o la contraseña
- **THEN** la página muestra un mensaje inline "Usuario o contraseña incorrectos" sin usar diálogos nativos del navegador

### Requirement: Challenges de inicio de sesión del pool
La app SHALL completar los pasos adicionales que pida el pool: código TOTP, código SMS, selección de método MFA, alta de TOTP (mostrando el secreto y URI para la app autenticadora) y nueva contraseña obligatoria del primer acceso. Cualquier otro paso no soportado MUST mostrar un mensaje inline y no dejar sesión a medias.

#### Scenario: MFA TOTP
- **WHEN** tras usuario y contraseña el pool pide un código TOTP
- **THEN** la página muestra un campo de 6 dígitos y, con el código correcto, completa la sesión

#### Scenario: Nueva contraseña obligatoria
- **WHEN** el pool responde que el usuario debe definir una nueva contraseña
- **THEN** la página pide la nueva contraseña y su confirmación y, al aceptarse, completa la sesión

### Requirement: Chequeo de sesión al montar el login
Al montar `/login`, la app SHALL comprobar si existe un id token válido en la sesión y, si existe, redirigir sin mostrar el formulario al destino del parámetro `next` cuando sea una ruta relativa interna, o a `/` en cualquier otro caso.

#### Scenario: Usuario ya autenticado por SSO
- **WHEN** un usuario con sesión vigente abre `/login?next=/agentes`
- **THEN** la app redirige a `/agentes`

#### Scenario: Destino externo
- **WHEN** el parámetro es `next=https://ejemplo.com`
- **THEN** la app ignora el destino y redirige a `/`

### Requirement: Gate de rutas protegidas
Toda ruta distinta de `/login` SHALL resolver la sesión al montar; mientras resuelve MUST mostrar un Skeleton y, si no hay sesión, redirigir a `/login?next=<ruta actual>`.

#### Scenario: Sin sesión
- **WHEN** un usuario sin sesión abre `/agentes`
- **THEN** la app redirige a `/login?next=%2Fagentes` sin mostrar datos de la página

### Requirement: Cierre de sesión
El menú de usuario SHALL ofrecer "Cerrar sesión", que elimina los tokens de la cookie compartida y redirige a `/login`. Como la sesión es compartida, la confirmación MUST advertir que también se cerrará en las demás apps Pernexium del mismo navegador.

#### Scenario: Cerrar sesión
- **WHEN** el usuario confirma "Cerrar sesión" en el `ConfirmDialog`
- **THEN** la cookie de sesión queda eliminada y la app muestra `/login`

### Requirement: Verificación del id token en el BFF
Cada route handler del BFF bajo `/api/` SHALL exigir `Authorization: Bearer <id token>` y verificar firma (JWKS del pool), emisor, `token_use=id`, expiración y que `aud` pertenezca a la allowlist de client ids configurada; la identidad es el claim `cognito:username`. Sin token o con token inválido MUST responder 401 sin llamar a ningún backend.

#### Scenario: Token válido
- **WHEN** el navegador llama a `GET /api/me` con un id token vigente emitido por un App Client de la allowlist
- **THEN** el BFF procesa la solicitud con el username del token

#### Scenario: Token de otro App Client
- **WHEN** el id token es válido pero su `aud` no está en la allowlist
- **THEN** el BFF responde 401 con `{"error":{"code":"unauthenticated","message":"Sesión inválida"}}`

#### Scenario: Access token en lugar de id token
- **WHEN** se envía un access token de Cognito
- **THEN** el BFF responde 401 porque `token_use` no es `id`

### Requirement: Renovación del token en el cliente
Ante un 401 del BFF, el cliente SHALL forzar una renovación de la sesión y reintentar la solicitud una sola vez; si vuelve a fallar o no hay sesión renovable, MUST redirigir a `/login?next=<ruta actual>`.

#### Scenario: Token expirado con refresh válido
- **WHEN** una llamada recibe 401 porque el id token expiró y el refresh token sigue vigente
- **THEN** el cliente renueva los tokens, repite la llamada y el usuario no ve error
