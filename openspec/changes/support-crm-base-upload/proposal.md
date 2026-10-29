# Proposal

## Why

Los líderes cargan contactos desde la base que exporta el CRM de Pernexium (76 columnas, `id_credito`, `nombre_cliente`, `telefono_1..3`, comentarios con saltos de línea, exportes de Excel en Windows-1252), pero la sección Contactos de ANA Admin la rechaza: v3 exige `phone_number`/`contact_phone`/`contact_pho`/`phone`, las filas con saltos de línea dentro de un campo se marcan inválidas y el archivo se lee solo como UTF-8 con coma. Hoy hay que limpiar la base a mano antes de cada carga; además no hay forma de pegar un rango copiado de Excel.

## What Changes

- **Lectura robusta** (ANA Admin, ambas flotas): bytes del archivo decodificados como UTF-8 y, si hay bytes inválidos, como Windows-1252 (la página muestra la codificación detectada); BOM eliminado; delimitador `,`, `;` o tabulador detectado en el encabezado; campos RFC 4180 (comillas, comas, comillas dobles y saltos de línea dentro de comillas); se conservan todas las columnas, incluidas `pago_minimo.1/.2/.3`, y los encabezados repetidos se renombran con sufijo `.N`.
- **Saltos de línea dentro de un campo**: dejan de invalidar la fila; CR/LF dentro de un campo se convierten en un espacio (y se recorta) al leer y al escribir los archivos v3 (carga de administración y publicación de "Mi asignación").
- **Varios teléfonos**: `telefono`, `telefono_N` y `phone_N` cuentan como columnas de teléfono además de los alias actuales. En v3 una fila es válida si alguna columna de teléfono tiene 10 o más dígitos y el archivo por agente conserva todas las columnas para que el agente elija en "Mi asignación". En v4 el líder elige la columna (por defecto `telefono_1` si no hay alias) y, si es `telefono_N`, cada fila usa la siguiente `telefono_N` no vacía; el CSV a v4 lleva la columna `telefono_envio` con el teléfono resuelto.
- **Pegar desde Excel**: pestañas "Archivo" / "Pegar" en el paso 2; el texto pegado (TSV con encabezado) pasa por la misma validación, vista previa y entrega, con los mismos límites de tamaño y filas.
- **Identificadores**: vista previa y "Mi asignación" muestran `nombre_cliente` como nombre (espacios repetidos colapsados solo al mostrar) y `id_credito` como crédito; el CLI v3 y v4 ya mapean `id_credito` a crédito.
- **Variables con punto**: `{{pago_minimo.1}}` resuelve la columna; dentro de expresiones (`{{pago_minimo.1*0.8}}`) el nombre con sufijo `.N` se toma completo cuando existe esa columna (antes se calculaba `pago_minimo` seguido de `.1`). Mismo cambio en el CLI v3 para mantener la semántica idéntica.
- **Duplicados por crédito**: la validación (navegador, BFF y carga de administración v3) detecta duplicados por `id_credito` (y alias) con causa "Crédito duplicado"; el mismo teléfono en créditos distintos se permite (un cliente, varios créditos) y las filas sin crédito siguen deduplicándose por teléfono. "Mi asignación" publica un teléfono una vez por crédito.
- Fixture de prueba `admin-web/test/fixtures/contacts/crm-base.example.csv` con el encabezado exacto y datos ficticios.

Fuera de alcance: mapear la base CRM a las columnas estándar (`first_name`, `total_balance`), validar el formato de fechas o montos, cambios en el trigger CSV de v4 o en el desktop, y deduplicar contra cargas anteriores.

## Capabilities

### New Capabilities

_Ninguna._

### Modified Capabilities

- `admin-web/contact-upload` (creada por `add-contact-upload-console`): se agregan lectura de la base CRM, varias columnas de teléfono (también aceptadas por la carga de administración de v3), normalización de saltos de línea, duplicados por crédito, pegado desde Excel, variables con sufijo `.N` y teléfono de envío en v4. Solo requisitos ADDED para no chocar con los cambios pendientes.

## Impact

- admin-web: `src/lib/contacts/csv.ts` (decodificación, delimitador, teléfonos), `src/lib/contacts/plan.ts` (archivos v3 y CSV v4), `src/components/contacts/ContactsUploadView.tsx` (pestañas y pegado), `src/lib/workspace/*` y `MyAssignmentView.tsx` (nombre y variables), BFF `src/server/contacts/delivery.ts`; pruebas vitest y fixture.
- v3/ana-backend: `src/lib/contactsCsv.ts`, `src/handlers/adminContacts.ts`, `src/lib/publication.ts`, `src/lib/templateRender.ts`; requiere deploy del stack (`sls deploy`) para aceptar `telefono_N`, rechazar créditos duplicados en la carga de administración y publicar un teléfono por crédito.
- v3/cli-whatsapp: `template-utils.js` (variables con sufijo `.N` en expresiones); entra en el siguiente release del CLI, no es requisito para este cambio.
- v4/backend: sin cambios de código (usa `phoneColumn` explícito y `csv-parse`; el trigger no deduplica por teléfono); se agrega una prueba.
- Orden de archivo: después de `add-contact-upload-console`, `add-supervisor-contact-access`, `add-agent-workspace` y `link-review-contacts-to-uploads`.
