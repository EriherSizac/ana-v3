# Spec Delta

## ADDED Requirements

### Requirement: Lectura de la base CRM
El navegador SHALL decodificar el archivo como UTF-8 y, ante bytes inválidos, como Windows-1252 (mostrando la codificación), quitar el BOM, detectar el delimitador `,`, `;` o tabulador en el encabezado y leer campos RFC 4180. Conserva todas las columnas (p. ej. `pago_minimo.1`); un encabezado repetido se renombra `nombre.N`. Los límites se miden sobre el texto en UTF-8.

#### Scenario: Exporte de Excel en Windows-1252
- **WHEN** el archivo trae `Espíritu` codificado en Windows-1252
- **THEN** la página muestra "Codificación: Windows-1252" y el nombre se lee `Espíritu`

#### Scenario: Delimitador punto y coma
- **WHEN** el encabezado es `id_credito;nombre_cliente;telefono_1`
- **THEN** la página detecta 3 columnas

### Requirement: Varias columnas de teléfono
Además de los alias de "Columna de teléfono", `telefono`, `telefono_N` y `phone_N` SHALL contar como columnas de teléfono en ambas flotas (y en la validación de `POST /admin/campaigns/{campaign}/contacts` de v3); la página lista las detectadas. Una fila es válida si alguna tiene 10 o más dígitos; el duplicado se mide con el primer teléfono válido. Los archivos v3 conservan todas las columnas.

#### Scenario: Base CRM para v3
- **WHEN** el CSV solo tiene `telefono_1`, `telefono_2` y `telefono_3` y la flota es `v3`
- **THEN** la página muestra esas columnas de teléfono y permite continuar

#### Scenario: Solo el segundo teléfono
- **WHEN** una fila tiene `telefono_1` vacío y `telefono_2=5512345678`
- **THEN** la fila es válida

### Requirement: Saltos de línea dentro de un campo
Un salto de línea dentro de un campo MUST NOT invalidar la fila (reemplaza la causa "Salto de línea dentro de un campo" de "Validación de filas"): CR/LF se convierten en un espacio y el campo se recorta al leer, y el backend v3 hace lo mismo al escribir la carga de administración y la publicación de "Mi asignación".

#### Scenario: Comentario multilínea
- **WHEN** un campo es `"\n*** 5520 SE CONTACTA\nPOR WHATSAPP"`
- **THEN** la fila es válida y el archivo entregado lo contiene como `*** 5520 SE CONTACTA POR WHATSAPP`

### Requirement: Pegar desde Excel
El paso 2 SHALL ofrecer pestañas "Archivo" y "Pegar". "Pegar" tiene un área de texto para un rango copiado de Excel (encabezado en la primera fila, tabuladores, comillas de Excel) y "Usar datos pegados", que lo procesa con las mismas reglas, límites, validación, vista previa y entrega que un archivo, mostrando filas y columnas leídas o el error inline.

#### Scenario: Rango pegado
- **WHEN** el líder pega 3 filas con encabezado de la base CRM y pulsa "Usar datos pegados"
- **THEN** la página muestra "3 filas · 76 columnas" y la validación de las 3 filas

#### Scenario: Pegado demasiado grande
- **WHEN** el texto pegado supera 4 MB con flota `v3`
- **THEN** la página muestra "El texto pegado supera 4 MB para v3" y no lo procesa

### Requirement: Identificadores y variables de la base CRM
La vista previa y "Mi asignación" SHALL mostrar `nombre_cliente` como nombre con espacios colapsados solo al mostrar (el archivo conserva el valor). `{{columna.N}}` resuelve esa columna, también dentro de expresiones (`{{pago_minimo.1*2}}`), en ANA Admin, el backend v3 y el CLI.

#### Scenario: Variable con punto
- **WHEN** la plantilla es `Paga {{pago_minimo.1}}` y la fila tiene `pago_minimo.1=377.3`
- **THEN** la vista previa muestra `Paga 377.3`

### Requirement: Teléfono de envío en v4
En v4 la columna elegida SHALL tener por defecto el primer alias de v4 o la primera `telefono_N`. Si es `telefono_N`, cada fila usa ese valor o la siguiente `telefono_N` con 10 dígitos; el CSV subido agrega al final `telefono_envio` con el teléfono resuelto y el presign usa `phoneColumn:"telefono_envio"`.

#### Scenario: Fallback al segundo teléfono
- **WHEN** la columna elegida es `telefono_1` y una fila tiene `telefono_1` vacío y `telefono_2=5598765432`
- **THEN** el CSV a v4 tiene `telefono_envio=5598765432` en esa fila
