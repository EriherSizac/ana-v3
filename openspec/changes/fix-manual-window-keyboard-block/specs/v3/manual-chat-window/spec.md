# Spec Delta

## MODIFIED Requirements

### Requirement: Bloqueo de teclado y menú contextual
La ventana manual SHALL aplicar, desde antes de cargar WhatsApp y en cada recarga, una política de teclado de denegación por defecto: teclas de función (F1–F12) salvo F5 y combinaciones con Ctrl, Cmd o Alt se cancelan, salvo las excepciones de escritura de esta especificación. DevTools, ver código fuente, guardar, imprimir, abrir archivo y navegar atrás/adelante MUST bloquearse siempre. El menú contextual del navegador MUST quedar bloqueado en toda la página.

#### Scenario: Intento de abrir DevTools
- **WHEN** el agente presiona F12, Ctrl+Shift+I, Ctrl+Shift+J o Ctrl+Shift+C, incluso con el foco en el cuadro de mensaje
- **THEN** el evento se cancela y DevTools no se abre

#### Scenario: Atajos del navegador siempre bloqueados
- **WHEN** el agente presiona Ctrl+U, Ctrl+S, Ctrl+P, Ctrl+O, Alt+Flecha izquierda o Alt+Flecha derecha
- **THEN** el evento se cancela y la ventana sigue en WhatsApp Web

#### Scenario: Pegar texto en el cuadro de mensaje
- **WHEN** el agente presiona Ctrl+V en el cuadro de escritura
- **THEN** el pegado se permite normalmente

#### Scenario: Atajos de WhatsApp Web
- **WHEN** el agente presiona una combinación con Ctrl, Cmd o Alt que no es una excepción de escritura (por ejemplo Ctrl+Alt+N o Ctrl+Alt+Retroceso con un teclado US)
- **THEN** la combinación se cancela y WhatsApp no ejecuta el atajo

#### Scenario: Copiar texto
- **WHEN** el foco no está en un campo editable y el agente presiona Ctrl+C, Ctrl+A o Ctrl+Z
- **THEN** la combinación se cancela
- **AND** dentro de un campo editable esas combinaciones se rigen por el requisito "Atajos de edición en campos editables"

#### Scenario: Recargar con F5
- **WHEN** el agente presiona F5
- **THEN** la página se recarga y las protecciones y restricciones se reaplican al terminar la carga

## ADDED Requirements

### Requirement: Escritura con AltGr
La ventana manual MUST permitir que una combinación AltGr (reportada como Ctrl+Alt o con estado `AltGraph`, sin Cmd) inserte su carácter cuando produce un carácter imprimible distinto de la letra o dígito de la tecla física, o una tecla muerta. Ese evento SHALL NOT llegar a los manejadores de teclado de WhatsApp Web.

#### Scenario: Arroba en teclado latinoamericano
- **WHEN** con distribución Español (Latinoamérica) el agente presiona AltGr+Q en el cuadro de mensaje
- **THEN** se escribe `@`

#### Scenario: Caracteres AltGr en teclado español
- **WHEN** con distribución Español (España) el agente presiona AltGr+2, AltGr+3 y AltGr+E
- **THEN** se escriben `@`, `#` y `€`

#### Scenario: AltGr no dispara atajos de WhatsApp
- **WHEN** el agente escribe `€` con AltGr+E en un chat abierto
- **THEN** se inserta `€` y el chat no se archiva ni cambia de estado

#### Scenario: Ctrl+Alt sin carácter
- **WHEN** la combinación Ctrl+Alt+E produce la letra `e` (teclado US)
- **THEN** la combinación se cancela

### Requirement: Atajos de edición en campos editables
Con el foco en un campo editable (cuadro de mensaje, búsqueda o inputs de los modales propios), la ventana manual MUST permitir Ctrl/Cmd con V, Shift+V, C, X, A, Z, Y y Shift+Z, y Ctrl con flechas, Inicio, Fin, Retroceso y Supr (con o sin Shift), siempre sin Alt.

#### Scenario: Copiar y deshacer en el mensaje
- **WHEN** el agente selecciona texto en su borrador, presiona Ctrl+C, Ctrl+X y luego Ctrl+Z
- **THEN** el texto se copia, se corta y el corte se deshace

#### Scenario: Seleccionar todo el borrador
- **WHEN** el foco está en el cuadro de mensaje y el agente presiona Ctrl+A
- **THEN** se selecciona todo el borrador, no la página

#### Scenario: Borrar palabra
- **WHEN** el foco está en el cuadro de mensaje y el agente presiona Ctrl+Retroceso
- **THEN** se borra la palabra anterior

### Requirement: Códigos Alt del teclado numérico
La ventana manual MUST permitir Alt (sin Ctrl ni Cmd) junto con dígitos del teclado numérico, y las pulsaciones de teclas modificadoras solas (Ctrl, Alt, AltGr, Shift, Cmd), para que los códigos Alt de Windows inserten su carácter.

#### Scenario: Arroba con código Alt
- **WHEN** el agente mantiene Alt y teclea 6 y 4 en el teclado numérico con el foco en el cuadro de mensaje
- **THEN** se escribe `@`
