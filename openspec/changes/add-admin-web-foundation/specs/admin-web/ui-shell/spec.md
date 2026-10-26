# Spec Delta

## Purpose

Dar a ANA Admin el layout, la navegación y las reglas visuales y de interacción obligatorias del sistema de diseño Pernexium (`docs/design-system.md`), de forma consistente en todas sus páginas.

## ADDED Requirements

### Requirement: Tokens y tipografía del sistema de diseño
La app SHALL usar exclusivamente la paleta de tokens del sistema de diseño (`primary`, `secondary`, `error`, `neutral`, `text` con sus variantes), Jost para encabezados e Inter para el cuerpo. El build MUST NOT generar clases de la paleta Tailwind por defecto (p. ej. `bg-blue-500`, `text-gray-700`) y el código MUST NOT contener colores hex en JSX.

#### Scenario: Clase de color por defecto
- **WHEN** un componente usa `bg-blue-500`
- **THEN** el chequeo de estilos de CI falla indicando el archivo y la clase

#### Scenario: Encabezado de página
- **WHEN** se renderiza el `h1` de cualquier página
- **THEN** usa Jost peso 700 y color de token

### Requirement: Header y navegación
Las páginas autenticadas SHALL mostrar un header sticky con `pernexium-gradient`, la marca `PERNEXIUM` y la sub-marca `ANA Admin` en pill blanca translúcida, navegación en pills (activa: fondo blanco y texto `primary`), menú hamburguesa por debajo de `md` y menú de usuario con su username y "Cerrar sesión".

#### Scenario: Pantalla móvil
- **WHEN** el ancho es menor a 768 px
- **THEN** la navegación se colapsa en un botón hamburguesa con `aria-label` y se abre como panel

### Requirement: Contenedor de página
Cada página SHALL envolver su contenido en `<main>` con `mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8 lg:py-10` (o `max-w-4xl` con el mismo padding para formularios), un único `h1` y una descripción `text-sm text-text-light`, y las tablas MUST ir dentro de `overflow-x-auto`.

#### Scenario: Tabla ancha en móvil
- **WHEN** una tabla de 900 px se ve en un ancho de 375 px
- **THEN** la tabla se desplaza horizontalmente sin romper el layout de la página

### Requirement: Estados de carga con Skeleton
Todo estado de carga de página, tabla o panel SHALL mostrarse con `Skeleton` del tamaño aproximado del contenido real, con `aria-hidden="true"`, y MUST NOT mostrarse texto plano tipo "Cargando…".

#### Scenario: Tabla cargando
- **WHEN** una tabla espera datos del BFF
- **THEN** se muestran filas Skeleton en lugar de la tabla vacía o de un texto de carga

### Requirement: Confirmaciones con ConfirmDialog
Toda confirmación y toda acción destructiva SHALL pedirse con `ConfirmDialog` (`role="dialog"`, `aria-modal="true"`, cierre por Escape, clic en backdrop o Cancelar, deshabilitado mientras carga). El código MUST NOT usar `alert()`, `confirm()` ni `prompt()`.

#### Scenario: Uso de diálogo nativo
- **WHEN** un archivo de `admin-web/src` llama a `window.confirm`
- **THEN** el lint de CI falla

#### Scenario: Confirmación en curso
- **WHEN** el usuario confirma y la acción está en progreso
- **THEN** los botones del diálogo quedan deshabilitados hasta que la acción termina

### Requirement: Selectores con búsqueda
Todo selector de valores SHALL ser un dropdown con filtrado por texto (`SearchableSelect` para un valor, `SearchableMultiselect` con `FilterPill` para varios) que solo acepta opciones de la lista. El código MUST NOT usar `<select>` nativo.

#### Scenario: Elegir campaña
- **WHEN** el usuario escribe `didi` en el selector de campaña
- **THEN** la lista se filtra a las campañas que contienen `didi` y no se puede enviar un texto que no sea una opción

#### Scenario: Uso de select nativo
- **WHEN** un componente de `admin-web/src` renderiza `<select>`
- **THEN** el lint de CI falla

### Requirement: Mensajes inline y toasts
Los errores y avisos no bloqueantes SHALL mostrarse como mensajes inline (`rounded-xl` con estilo de error o de éxito) o como `Toast` no modal que se cierra solo o con `×`, en español y sin emojis.

#### Scenario: Error de una acción
- **WHEN** el BFF responde un error a una acción del usuario
- **THEN** la página muestra el `message` del error en un mensaje inline o toast junto a la acción

### Requirement: Accesibilidad básica
Los botones de solo icono SHALL tener `aria-label`, los controles interactivos MUST tener foco visible (`ring-secondary`) y orden de tabulación natural, y los modales y dropdowns MUST cerrarse con Escape.

#### Scenario: Navegación por teclado
- **WHEN** el usuario recorre el header con Tab
- **THEN** cada control recibe foco visible en el orden en que aparece

### Requirement: Páginas de sistema
La app SHALL tener páginas "Sin acceso" (403), "No encontrado" (404) y "Error" (500) con el layout estándar y una acción para volver al inicio o cerrar sesión, sin exponer detalles técnicos.

#### Scenario: Ruta inexistente
- **WHEN** el usuario abre `/no-existe`
- **THEN** la app muestra "No encontrado" con un enlace al inicio
