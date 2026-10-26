# ANA - Guía rápida para agentes

## Teclado en la ventana manual

- **AltGr funciona**: puedes escribir `@`, `#`, `\`, `~`, `€`, `[`, `]`, `{`, `}` y `|` con AltGr en teclados en español (Latinoamérica o España).
- **Códigos Alt funcionan**: mantén Alt y teclea el código en el teclado numérico (por ejemplo Alt+64 = `@`).
- **Copiar, cortar, pegar, deshacer, rehacer y seleccionar todo** (Ctrl+C, Ctrl+X, Ctrl+V, Ctrl+Z, Ctrl+Y, Ctrl+A), así como Ctrl+flechas, Ctrl+Inicio/Fin y Ctrl+Retroceso/Supr, funcionan **solo dentro del cuadro de mensaje** y de los campos de texto de ANA (búsqueda, "Subir gestión", historial).
- **Los atajos de WhatsApp Web están desactivados** (nuevo chat, archivar, eliminar, fijar, silenciar, etc.), igual que DevTools, F1–F12 (salvo F5 para recargar), Ctrl+U/S/P/O y Alt+←/→.

## Números sin WhatsApp

- El botón **ℹ️** de la ventana manual abre el modal "Números sin WhatsApp" con el total y los últimos 4 dígitos de los números que el envío automático marcó como `no_whatsapp`.
- El modal es **solo de consulta**: abrirlo no registra nada en el CRM.
- El botón **"Registrar consulta (N)"** solo aparece si se habilita desde la administración; registra una sola vez por número, campaña y día.

## Registro de "Consulta No Whatsapp"

El botón para registrar en el CRM el subdictamen **"Consulta No Whatsapp"** en
el modal "Números sin WhatsApp" de la ventana manual se controla desde
**ANA Admin → Configuración → "Registrar consulta de números sin WhatsApp"**
(solo usuarios con rol Developer). Por defecto está **Desactivado**.

- El CLI lee la configuración al iniciar sesión y cada 5 minutos; un cambio
  se aplica en hasta 5 minutos sin reiniciar.
- Si el CLI no puede consultar el backend, conserva el último valor leído; si
  nunca pudo leerlo en esa ejecución, usa el valor por defecto (desactivado).
- Requiere el CLI con inicio de sesión de Pernexium (usuario y contraseña);
  las versiones anteriores siempre usan el valor por defecto.
