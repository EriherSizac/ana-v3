# ANA - Guía rápida para agentes

## Inicio de sesión (desde la versión 1.0.47)

ANA ya no usa la "palabra del día": entras con tu **usuario y contraseña de
Pernexium** (los mismos de ANA v4; el usuario no es tu correo).

- **Primer inicio de sesión**: tu supervisor te da un usuario y una **contraseña
  temporal**. Al entrar, ANA te pide crear una **contraseña nueva** (dos veces).
- **Verificación en dos pasos (MFA)**: si tu usuario la tiene, ANA te pide el
  código de 6 dígitos de tu app autenticadora o del SMS. Si es obligatoria y aún
  no la configuraste, ANA muestra un **código QR y una clave** para registrarlos
  en tu app autenticadora y te pide el primer código.
- **Campaña**: después eliges tu campaña de la lista (solo aparecen las campañas
  donde estás habilitado). Si no aparece ninguna, verás "Tu usuario no está
  habilitado en ninguna campaña. Contacta a tu supervisor."
- **Volver a abrir ANA el mismo día**: verás "Sesión activa: <tu usuario>"; confirma
  la campaña y pulsa **Continuar** (no se vuelve a pedir la contraseña). La sesión
  dura un día; después ANA te pide usuario y contraseña otra vez.
- **Cambiar de usuario**: en "Sesión activa" pulsa **Cambiar de usuario**: se
  cierra la sesión guardada y aparece el formulario vacío.
- **Cerrar sesión en esta PC**: ejecuta `ANA.exe --logout` (imprime "Sesión cerrada"
  y termina; funciona aun sin internet).
- **Olvidé mi contraseña**: pide a tu supervisor que la restablezca.

Avisos mientras trabajas (en la consola y en el recuadro de estado):

- **"Sesión expirada: cierra ANA y vuelve a iniciar sesión"**: la sesión venció o
  fue revocada. ANA deja de tomar contactos hasta que vuelvas a entrar.
- **"Tu usuario no está habilitado en esta campaña"**: tu supervisor te
  deshabilitó o quitó el rol de la campaña. ANA deja de tomar contactos y vuelve a
  intentar cada 30 segundos.

La sesión se guarda cifrada para tu usuario de Windows (`%APPDATA%\ANA\.agent-session`);
si se copia a otra cuenta o PC no sirve y ANA pide iniciar sesión.

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
