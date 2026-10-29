# Design

## Decisiones

- **Lógica pura compartida por equivalencia**: `planPhones` (admin-web) replica `buildPublication` (v3); una prueba de admin-web pasa el payload real por JSON al `buildPublication` del backend y compara teléfono y mensaje por fila, así el servidor envía exactamente lo que muestra la vista previa.
- **`rowKey`** = `<source key>#<índice de fila 0-based en ese archivo>`, separado en el último `#`.
- **Compatibilidad**: sin `phoneMode` el backend usa `"all"` (comportamiento previo); admin-web siempre lo envía explícito.
- **Modo "first" y créditos repetidos**: un crédito en varias filas seleccionadas recibe un solo mensaje.
- **Antigüedad**: fecha del key `-contacts-YYYY-MM-DDTHH-mm-ss-SSSZ.csv` (UTC); si no es válida, `LastModified`; sin ninguna, no se considera antiguo. Antiguo si `now - fecha > 90 días`. La fecha del key gana para que reescrituras parciales no rejuvenezcan el archivo.
- **Orden**: una columna es numérica o de fecha solo si todos sus valores no vacíos lo son; si no, texto sin mayúsculas/acentos; vacíos al final; orden estable.
- **Selección fuera de filtros**: no se descarta automáticamente; se avisa "N fila(s) seleccionada(s) fuera de los filtros" con acción "Seleccionar solo los resultados".
