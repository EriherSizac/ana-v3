# template-interpolation Specification

## Purpose
Describe el motor de plantillas de la app de escritorio v4 (compartido por el envío real en el proceso main y la vista previa del renderer): sintaxis `{campo}` y `{{campo}}`, formato de moneda MXN, modificadores, expresiones aritméticas, columna de mensaje por contacto, alias de columnas, normalización de teléfonos y el editor de plantillas con chips, constructor de ecuaciones y vista previa con formato de WhatsApp.

> Nota: el formato de moneda de un campo simple solo elimina caracteres no numéricos, por lo que un valor con coma decimal ("1234,56") se interpreta como 123456; las expresiones aritméticas sí reconocen la coma decimal.

## Requirements

### Requirement: Sintaxis de placeholders
La plantilla SHALL reemplazar `{campo}` y también `{{campo}}` (plantillas heredadas de v3) por el valor de la columna, ignorando espacios internos. Un campo simple ausente o nulo MUST reemplazarse por cadena vacía. Un placeholder que no es campo simple ni expresión evaluable SHALL dejarse visible tal cual.

#### Scenario: Doble llave heredada
- **WHEN** la plantilla es "Hola {{nombre}}" y la fila trae nombre "Ana"
- **THEN** el mensaje es "Hola Ana", sin llaves sobrantes

#### Scenario: Campo inexistente
- **WHEN** la plantilla usa `{apodo}` y la fila no lo trae
- **THEN** el placeholder se reemplaza por cadena vacía

#### Scenario: Placeholder inválido
- **WHEN** la plantilla contiene `{saldo $$}`
- **THEN** el texto `{saldo $$}` se conserva en el mensaje

### Requirement: Formato de moneda
Los campos cuyo nombre contiene `balance`, `amount`, `saldo` o `monto` (sin distinguir mayúsculas) SHALL formatearse como moneda MXN con locale `es-MX`. Los modificadores `:dinero`, `:money` o `:$` MUST forzar el formato y `:num`, `:numero` o `:plain` desactivarlo. Un valor sin dígitos se devuelve tal cual.

#### Scenario: Saldo automático
- **WHEN** la plantilla es `{saldo}` y el valor es "1234.5"
- **THEN** el mensaje muestra "$1,234.50"

#### Scenario: Forzar número plano
- **WHEN** la plantilla es `{saldo:num}` y el valor es "1234.5"
- **THEN** el mensaje muestra "1234.5"

### Requirement: Expresiones aritméticas
Un placeholder con `+ - * / ( ) %` SHALL evaluarse sustituyendo cada columna por su valor numérico (aceptando "1,234.56" y "1234,56"). La expresión MUST evaluarse solo si tras sustituir queda reducida a dígitos, operadores, puntos y espacios. El resultado entero se muestra sin decimales, el fraccionario con 2 decimales, o como MXN si aplica formato.

#### Scenario: Descuento calculado
- **WHEN** la plantilla es `{saldo*0.9:dinero}` y saldo es "1000"
- **THEN** el mensaje muestra "$900.00"

#### Scenario: Columna no numérica
- **WHEN** la expresión usa una columna con texto o inexistente
- **THEN** el placeholder se conserva visible

### Requirement: Columna de mensaje por contacto
Si el placeholder es `{message}` o `{mensaje}` y su valor contiene `{`, el valor SHALL interpolarse a su vez con el resto de la fila, MUST excluirse a sí mismo para no recursar.

#### Scenario: Mensaje personalizado en el CSV
- **WHEN** la plantilla es `{mensaje}` y la fila trae mensaje "Hola {{first_name}}" y first_name "Luis"
- **THEN** el mensaje enviado es "Hola Luis"

### Requirement: Alias de columnas
La normalización de filas SHALL rellenar cada grupo de alias con el primer valor no vacío: teléfono (`phone`, `phone_number`, `contact_phone`, `contact_pho`, `telefono`), nombre, nombre de pila, apellido, crédito, descuento, saldo (`total_balance`, `total_balanc`, `balance`, `saldo`), producto y mensaje. Si falta `name` MUST construirse con nombre de pila y apellido, y `nombre` se copia de `name`.

#### Scenario: CSV v3 con plantilla v4
- **WHEN** el CSV trae `total_balance` y la plantilla usa `{saldo}`
- **THEN** la vista previa y el envío muestran el saldo

### Requirement: Normalización de teléfono
El teléfono SHALL reducirse a dígitos, quitar un prefijo `00`, convertir `521` seguido de 10 dígitos (13 en total) a `52` + 10 dígitos, y anteponer la lada si no empieza con ella. Solo MUST aceptarse un resultado de 11 a 15 dígitos; el número real lo resuelve WhatsApp.

#### Scenario: Número local mexicano
- **WHEN** el teléfono es "55 1234 5678" con lada 52
- **THEN** se consulta WhatsApp con "525512345678"

#### Scenario: Celular legado con 1
- **WHEN** el teléfono es "+52 1 55 1234 5678"
- **THEN** se normaliza a "525512345678"

> Nota: no se eliminan prefijos nacionales como `044`/`045` ni un `1` sin lada; "0445512345678" se convierte en "520445512345678", WhatsApp no lo resuelve y el contacto se reporta al CRM como sin WhatsApp. La detección de lada es por prefijo de texto, de modo que un número de otro país siempre recibe la lada configurada.

### Requirement: Editor de plantillas
El editor SHALL ofrecer botones de formato WhatsApp que envuelven la selección (`*negrita*`, `_cursiva_`, `~tachado~`, triple comilla invertida, o "texto" si no hay selección), salto de línea, un chip por columna que inserta `{columna}` y un botón `$` que inserta `{columna:dinero}`. El botón "fx" MUST abrir un constructor variable-operador-valor que solo inserta si el valor es número o columna.

#### Scenario: Insertar columna
- **WHEN** el usuario pulsa el chip "saldo"
- **THEN** se inserta `{saldo}` en la posición del cursor

#### Scenario: Ecuación inválida
- **WHEN** el valor del constructor no es número ni columna
- **THEN** "Insertar" queda deshabilitado y se muestra "valor: número o columna del CSV"

### Requirement: Vista previa
La vista previa SHALL interpolar la plantilla con la fila de muestra usando el mismo motor del envío y renderizar negrita, cursiva, tachado y monoespaciado sin anidación, como texto escapado. Sin fila de muestra MUST mostrar la plantilla sin reemplazar con el título "Vista previa (sin CSV: variables sin reemplazar)".

#### Scenario: Preview con CSV
- **WHEN** hay CSV cargado
- **THEN** el título es "Vista previa (primer contacto del CSV)" y muestra el mensaje del primer contacto

> Nota: en "Mi asignación" la vista previa usa la fila del job sin normalizar alias, mientras que en "Campañas" se normaliza; en el envío real la fila ya llega normalizada desde el backend.
