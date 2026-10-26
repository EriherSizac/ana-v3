# Spec Delta

## MODIFIED Requirements

### Requirement: Interpolación de variables con llaves simples
Al preparar el mensaje de cada contacto, el CLI SHALL reemplazar cada marcador `{variable}` (caracteres de palabra) que no forme parte de un marcador `{{...}}` por, en orden: el campo mapeado del contacto con ese nombre (excepto `message`), la columna original con ese nombre, o la primera columna cuyo nombre contenga el texto de la variable. Si no hay coincidencia, el marcador MUST quedar sin cambios.

#### Scenario: Variable simple
- **WHEN** el mensaje es `Hola {first_name}` y la columna `first_name` vale `Ana`
- **THEN** el mensaje a enviar es `Hola Ana`

#### Scenario: Coincidencia parcial
- **WHEN** el mensaje contiene `{cliente}` y existe la columna `nombre_cliente`
- **THEN** el marcador se reemplaza con el valor de `nombre_cliente`

#### Scenario: Variable inexistente
- **WHEN** el mensaje contiene `{foo}` y ninguna columna coincide
- **THEN** el texto `{foo}` se envía literal

#### Scenario: Marcador con llaves dobles
- **WHEN** el mensaje contiene `{{name}}` y la columna `name` vale `Juan`
- **THEN** el mensaje enviado contiene `Juan`, sin llaves residuales

#### Scenario: Llaves simples y dobles en la misma plantilla
- **WHEN** el mensaje es `Hola {first_name}, debes {{total_balance}}` con `first_name` = `Ana` y `total_balance` = `1500`
- **THEN** el mensaje enviado es `Hola Ana, debes 1500`

### Requirement: Variables estándar con llaves dobles
Al preparar el mensaje, el CLI SHALL reemplazar `{{phone}}`, `{{name}}`, `{{first_name}}`, `{{last_name}}`, `{{credit}}`, `{{discount}}` y `{{product}}` por los campos homónimos del contacto, y `{{total_balance}}` y `{{total_balanc}}` por el campo `total_balance` o, si está vacío, por `total_balanc`; un campo ausente MUST reemplazarse por cadena vacía. Cualquier otro `{{clave}}` sin operadores SHALL tomar el campo mapeado homónimo o, si no existe, la columna original del CSV con ese nombre.

#### Scenario: Producto
- **WHEN** la plantilla contiene `{{product}}` y el contacto no tiene `product`
- **THEN** el marcador se reemplaza por cadena vacía

#### Scenario: Saldo desde la columna del backend
- **WHEN** la plantilla contiene `{{total_balance}}` y el CSV trae la columna `total_balance` con `1500`
- **THEN** el marcador se reemplaza por `1500`

#### Scenario: Alias heredado del saldo
- **WHEN** la plantilla contiene `{{total_balanc}}` y el contacto solo tiene `total_balanc` = `850`
- **THEN** el marcador se reemplaza por `850`

#### Scenario: Columna original mapeada
- **WHEN** la plantilla contiene `{{contact_name}}` y el CSV trae la columna `contact_name` con `Juan Pérez`
- **THEN** el marcador se reemplaza por `Juan Pérez`

#### Scenario: Clave no estándar inexistente
- **WHEN** la plantilla contiene `{{monto}}` y no existe campo ni columna `monto`
- **THEN** el texto `{{monto}}` se envía literal

## ADDED Requirements

### Requirement: Interpolación en una sola pasada
El CLI SHALL interpolar el mensaje recorriendo la plantilla una sola vez, de izquierda a derecha, reconociendo en cada posición primero un marcador `{{...}}` y después uno `{variable}`. Los valores insertados MUST NOT volver a interpretarse como marcadores, y las expresiones matemáticas con llaves dobles SHALL conservar su comportamiento.

#### Scenario: Valor que contiene llaves
- **WHEN** la plantilla es `Hola {{name}}` y `name` vale `{first_name}`
- **THEN** el mensaje enviado es `Hola {first_name}` sin una segunda sustitución

#### Scenario: Expresión matemática intacta
- **WHEN** la plantilla contiene `{{total_balance * 0.5}}` y `total_balance` vale `1000`
- **THEN** se envía `500`

#### Scenario: Llave suelta
- **WHEN** la plantilla contiene `Total: {` o un `}` aislado que no forma un marcador válido
- **THEN** esos caracteres se envían sin cambios
