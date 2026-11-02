# Spec Delta

## MODIFIED Requirements

### Requirement: Sesión compartida por cookie de dominio
La app SHALL guardar los tokens de Cognito del pool `us-east-2_UepfOyKpd` en cookies (no en `localStorage`) con `path=/`, `sameSite=lax` y expiración de 30 días, igual que el login central. Cuando el host de la página es `pernexium.com.mx` o termina en `.pernexium.com.mx` y se sirve por https, la cookie MUST llevar `domain=.pernexium.com.mx` y `secure`; en cualquier otro host (localhost, previews) MUST escribirse sin `domain`, con `secure` solo sobre https. Pool y client id MUST venir de variables de entorno públicas.

#### Scenario: Sesión iniciada en otra app del apex
- **WHEN** un usuario ya inició sesión en el login central u otra app Pernexium que usa el mismo pool, App Client y configuración de cookie, y abre `https://ana-admin.pernexium.com.mx`
- **THEN** la app reconoce la sesión sin pedir credenciales

#### Scenario: Desarrollo local
- **WHEN** la app corre en `http://localhost`
- **THEN** las cookies se escriben sin `domain` ni `secure` y la sesión del login central local se comparte

#### Scenario: Preview fuera del apex
- **WHEN** la app corre en `https://<rama>.<app>.amplifyapp.com`
- **THEN** las cookies se escriben sin `domain` (nunca con el dominio del apex)

### Requirement: Chequeo de sesión al montar el login
Al montar `/login`, la app SHALL comprobar si existe un id token válido en la sesión. Si existe, MUST redirigir sin mostrar nada más al destino del parámetro `next` cuando sea una ruta relativa interna, o a `/` en cualquier otro caso. Si no existe, MUST mandar al login central (`<LOGIN_URL>/?redirect=<URL absoluta de vuelta>`, codificada) donde la URL de vuelta es el origen de la app más ese mismo destino saneado. La app MUST NOT mostrar un formulario de credenciales propio.

#### Scenario: Usuario ya autenticado por SSO
- **WHEN** un usuario con sesión vigente abre `/login?next=/agentes`
- **THEN** la app redirige a `/agentes`

#### Scenario: Destino externo
- **WHEN** el parámetro es `next=https://ejemplo.com`
- **THEN** la app ignora el destino y usa `/`

#### Scenario: Sin sesión
- **WHEN** un usuario sin sesión abre `https://ana-admin.pernexium.com.mx/login?next=%2Fagentes`
- **THEN** el navegador va a `https://login.pernexium.com.mx/?redirect=https%3A%2F%2Fana-admin.pernexium.com.mx%2Fagentes` sin mostrar campos de usuario ni contraseña

#### Scenario: Vuelta del login central
- **WHEN** el login central escribe la cookie del apex y regresa a `https://ana-admin.pernexium.com.mx/agentes`
- **THEN** el gate de rutas protegidas encuentra la sesión y muestra `/agentes`

### Requirement: Cierre de sesión
El menú de usuario SHALL ofrecer "Cerrar sesión", que elimina los tokens de la cookie compartida y lleva al navegador a `<LOGIN_URL>/logout?redirect=<origen de la app>`. Como la sesión es compartida, la confirmación MUST advertir que también se cerrará en las demás apps Pernexium del mismo navegador.

#### Scenario: Cerrar sesión
- **WHEN** el usuario confirma "Cerrar sesión" en el `ConfirmDialog`
- **THEN** la cookie de sesión queda eliminada y el navegador va a `https://login.pernexium.com.mx/logout?redirect=https%3A%2F%2Fana-admin.pernexium.com.mx`

## ADDED Requirements

### Requirement: URL del login central
La URL base del login central SHALL tomarse de la variable pública `NEXT_PUBLIC_LOGIN_URL` cuando esté definida; si no, MUST ser `https://login.pernexium.com.mx` en producción y `http://localhost:3100` fuera de producción.

#### Scenario: Producción sin variable
- **WHEN** la app se construye para producción sin `NEXT_PUBLIC_LOGIN_URL`
- **THEN** `/login` y "Cerrar sesión" usan `https://login.pernexium.com.mx`

#### Scenario: Desarrollo
- **WHEN** la app corre con `next dev` sin `NEXT_PUBLIC_LOGIN_URL`
- **THEN** `/login` manda a `http://localhost:3100/?redirect=...`

### Requirement: Tope contra redirecciones en bucle
Si `/login` manda al login central más de 4 veces dentro de 30 segundos en la misma pestaña, la app SHALL dejar de redirigir y MUST mostrar un aviso inline de que no pudo leer la sesión, con un botón "Reintentar" que reinicia el conteo y vuelve a intentar.

#### Scenario: La cookie no llega
- **WHEN** el login central regresa a la app pero la app no encuentra sesión y `/login` ya redirigió 4 veces en los últimos 30 segundos
- **THEN** la app no redirige una quinta vez y muestra el aviso con "Reintentar"

#### Scenario: Reintentar
- **WHEN** el usuario pulsa "Reintentar"
- **THEN** el conteo se reinicia y la app vuelve a comprobar la sesión y a mandar al login central si sigue sin sesión

## REMOVED Requirements

### Requirement: Pantalla de login por username
**Reason**: El formulario de credenciales vive en el login central de Pernexium; ANA Admin ya no pide usuario ni contraseña.
**Migration**: Iniciar sesión en `https://login.pernexium.com.mx` (al que `/login` redirige automáticamente).

### Requirement: Challenges de inicio de sesión del pool
**Reason**: Los pasos de MFA (TOTP, SMS, selección, alta de TOTP) y la nueva contraseña obligatoria los resuelve el login central.
**Migration**: Ninguna en ANA Admin; el usuario completa esos pasos en el login central y regresa con la sesión lista.
