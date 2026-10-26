# template-rendering Specification

## Purpose
Reglas de interpolación de plantillas que la app web de v3 (`v3/lib/template.ts`) aplica en el servidor a cada contacto antes de enviarle el mensaje por WhatsApp. El CLI (`v3/cli-whatsapp/message-utils.js`) implementa la misma lógica (variables estándar, expresiones matemáticas, `\n` literal) con una sola diferencia: allí `{{total_balance}}` también es variable estándar; esa variante se documenta en su propio spec.

## Requirements

### Requirement: Sintaxis de variables
Una variable SHALL escribirse como `{{nombre}}`, con dobles llaves, y su nombre MUST coincidir exactamente con la clave del contacto, distinguiendo mayúsculas de minúsculas. En la ruta genérica se recortan los espacios internos, de modo que `{{ nombre }}` equivale a `{{nombre}}`. No existe sintaxis de valores por defecto ni de filtros de formato.

#### Scenario: Reemplazo simple
- **WHEN** la plantilla es `Hola {{first_name}}` y el contacto tiene `first_name` = `Ana`
- **THEN** el mensaje resultante es `Hola Ana`

#### Scenario: Mayúsculas distintas
- **WHEN** la plantilla usa `{{First_Name}}` y el contacto solo tiene `first_name`
- **THEN** el texto `{{First_Name}}` queda sin reemplazar

#### Scenario: Espacios dentro de las llaves
- **WHEN** la plantilla usa `{{ product }}` y el contacto tiene `product` = `Laptop HP`
- **THEN** el resultado contiene `Laptop HP`

### Requirement: Variables estándar
Las variables `{{phone}}`, `{{name}}`, `{{credit}}`, `{{discount}}`, `{{first_name}}`, `{{last_name}}`, `{{total_balanc}}` y `{{product}}` SHALL reemplazarse siempre, usando cadena vacía cuando el contacto no tiene valor. `{{total_balanc}}` MUST tomar el valor de `total_balanc` y, si está vacío, el de `total_balance`.

#### Scenario: Variable estándar sin dato
- **WHEN** la plantilla contiene `Descuento: {{discount}}` y el contacto no tiene `discount`
- **THEN** el resultado es `Descuento: ` (vacío)

#### Scenario: Alias de balance
- **WHEN** el contacto tiene `total_balance` = `850` y no tiene `total_balanc`
- **THEN** `{{total_balanc}}` se reemplaza por `850`

### Requirement: Variables no estándar
Cualquier otra variable `{{clave}}` SHALL reemplazarse con el valor de la clave homónima del contacto si esa clave existe (cadena vacía si su valor es vacío). Si la clave no existe en el contacto, el marcador MUST quedar literal en el mensaje. Desde la app web, los contactos solo contienen `id`, `phone`, `name` y los campos estándar, porque la importación CSV descarta columnas no reconocidas.

#### Scenario: Variable inexistente
- **WHEN** la plantilla contiene `{{monto}}` y el contacto no tiene la clave `monto`
- **THEN** el mensaje enviado contiene literalmente `{{monto}}`

#### Scenario: Clave interna del contacto
- **WHEN** la plantilla contiene `{{id}}` en un envío desde la UI
- **THEN** se reemplaza por el identificador interno que la UI asignó al contacto

### Requirement: Expresiones matemáticas
Si el contenido entre llaves contiene alguno de `+ - * / ( ) ^ %`, el sistema SHALL tratarlo como expresión: cada clave del contacto se sustituye por su valor numérico (comas convertidas en puntos, lectura tolerante a texto final) y solo se evalúa si queda únicamente con dígitos, `+ - * / ( ) . %` y espacios. Un resultado entero MUST mostrarse sin decimales y uno no entero con 2 decimales. Si no se puede evaluar, el marcador normalmente queda literal.

#### Scenario: Descuento calculado
- **WHEN** la plantilla es `{{credit*0.9}}` y `credit` = `5000`
- **THEN** el resultado es `4500`

#### Scenario: Resultado decimal
- **WHEN** la plantilla es `{{total_balanc/3}}` y `total_balanc` = `100`
- **THEN** el resultado es `33.33`

#### Scenario: Coma como separador
- **WHEN** la plantilla es `{{credit*2}}` y `credit` = `1,5`
- **THEN** el resultado es `3`

#### Scenario: Separador de miles con coma
- **WHEN** la plantilla es `{{credit*1}}` y `credit` = `1,500`
- **THEN** el valor se interpreta como `1.5` y el resultado es `1.50`

#### Scenario: Valor con sufijo de texto
- **WHEN** la plantilla es `{{discount*2}}` y `discount` = `10%`
- **THEN** el resultado es `20`

#### Scenario: Variable faltante o no numérica en la expresión
- **WHEN** la plantilla es `{{monto*2}}` y el contacto no tiene `monto`, o su valor no es numérico (por ejemplo `$1500`)
- **THEN** el marcador `{{monto*2}}` queda literal en el mensaje

#### Scenario: Operador no soportado o división entre cero
- **WHEN** la plantilla es `{{credit^2}}` o `{{credit/0}}`
- **THEN** el marcador queda literal en el mensaje

#### Scenario: Nombre con guion
- **WHEN** la plantilla es `{{fecha-pago}}`
- **THEN** se interpreta como la resta `fecha - pago` y no como una variable con guion

### Requirement: Saltos de línea literales
Tras reemplazar variables, toda secuencia literal de barra invertida seguida de `n` (`\n`) en el resultado SHALL convertirse en un salto de línea real. Los saltos de línea reales de la plantilla MUST conservarse.

#### Scenario: Secuencia escapada
- **WHEN** la plantilla es `Hola\nAdiós` escrita con barra invertida literal
- **THEN** el mensaje resultante tiene `Hola` y `Adiós` en líneas distintas

### Requirement: Renderizado por contacto
La plantilla SHALL renderizarse en el servidor de forma independiente para cada contacto de la campaña, inmediatamente antes de su envío, sin vista previa en la UI. Un error de renderizado MUST no detener la campaña; ese contacto se cuenta como fallido.

#### Scenario: Campaña de varios contactos
- **WHEN** se envía `Hola {{name}}` a contactos llamados `Juan` y `María`
- **THEN** Juan recibe `Hola Juan` y María recibe `Hola María`
