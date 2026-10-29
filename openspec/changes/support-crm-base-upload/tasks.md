# Tasks

## 1. Parser y teléfonos (entrega 1)

- [x] 1.1 admin-web `src/lib/contacts/csv.ts`: decodificación UTF-8/Windows-1252, BOM, delimitador, encabezados repetidos, saltos de línea a espacio, columnas `telefono_N`, validación multi-teléfono; fixture `test/fixtures/contacts/crm-base.example.csv` y pruebas
- [x] 1.2 admin-web `ContactsUploadView.tsx`: lectura por bytes, codificación y columnas de teléfono detectadas
- [x] 1.3 v3/ana-backend: aceptar `telefono_N` en la carga de administración, filas lógicas con saltos de línea normalizados, publicación sin campos multilínea; pruebas (incluye parseo con `assignment-csv.js` del CLI)

## 2. Pegar desde Excel (entrega 2)

- [x] 2.1 Pestañas "Archivo" / "Pegar", "Usar datos pegados", límites sobre el texto pegado; pruebas de componente

## 3. Workspace y v4 (entrega 3)

- [x] 3.1 Variables `{{columna.N}}` (también en expresiones) en admin-web, v3/ana-backend y CLI; nombre `nombre_cliente` con espacios colapsados en vista previa y "Mi asignación"; pruebas
- [x] 3.2 v4: columna por defecto `telefono_1`, fallback por fila y columna `telefono_envio`; pruebas

## 4. Duplicados por crédito (entrega 4)

- [x] 4.1 admin-web `validateRows`: duplicado por crédito normalizado ("Crédito duplicado"), fallback por teléfono entre filas sin crédito; textos de la vista previa; pruebas (vista previa y BFF)
- [x] 4.2 v3/ana-backend: 400 `Crédito duplicado` en la carga de administración; la publicación deduplica por crédito+teléfono (y `phonesFor` de admin-web igual); pruebas
- [x] 4.3 v4: prueba de que el trigger CSV crea un job por fila con el mismo teléfono en créditos distintos

## 5. Cargas grandes y fechas (entrega 5)

- [x] 5.1 admin-web: pegado sin estado controlado (evento paste, resumen y muestra); `pipeline.ts` (sesión con progreso), `contacts.worker.ts` y `processor.ts` (fallback sin Worker); barra de progreso con fase, % y "Cancelar"; pruebas de lógica y de componente con Worker falso
- [x] 5.2 v3/ana-backend: `POST /admin/campaigns/{campaign}/contacts/presign`, carga con `sourceKey` (lectura de S3, reparto, conteos y hash, borrado), 1024 MB, CORS PUT y expiración de `uploads-incoming/` en `StorageBucket`; pruebas con aws-sdk-client-mock (presign, límite, objeto inexistente, plan distinto, equivalencia con la carga en línea)
- [x] 5.3 admin-web BFF: `POST /api/campaigns/{campaign}/uploads/presign`, `verifyLargePlan` y entrega por S3; límites v3 50 MB / 200 000 filas (4 MB en línea), v4 sin cambios; pruebas de rutas
- [x] 5.4 Fechas de Excel: `excelDates.ts` (admin-web y v3) en lectura, carga v3, `parseAssignmentCsv` de ambos lados (vista y publicación); pruebas
- [x] 5.5 "Mi asignación": filtros por columna junto a cada encabezado (valores, rango numérico, rango de fechas) además de la barra actual; chips, "Limpiar filtros" y persistencia comunes; pruebas
- [x] 5.6 "Mi asignación": aviso de plantilla sin campos personalizados (Mensaje con columnas sugeridas, Resumen y "Enviar de todos modos"); pruebas
