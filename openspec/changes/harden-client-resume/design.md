# Design

## Decisiones

- **Detección por reloj de pared**: `setInterval` de 5 s compara deltas de `Date.now()`; una brecha > 30 s (o reloj hacia atrás) se trata como reanudación. Cubre suspensión del SO y congelamientos del proceso. En v4 se combina con `powerMonitor` y las señales se coalescen (una recuperación a la vez; se ignoran señales en los 15 s siguientes).
- **Reinicio del loop sin cancelar**: una llamada Playwright colgada no se puede cancelar; el supervisor abandona la iteración atascada y arranca otra. Si la abandonada devuelve contactos, los escribe al diario pero no los envía; la nueva iteración los retoma del diario. El latido se suspende (`setBusy`) durante envíos.
- **Ventanas cerradas no se relanzan en v3**: relanzar el mismo perfil con el lock del anterior es riesgoso; se muestra "cierra ANA y vuelve a abrirlo". Ventanas sin respuesta se recargan (nunca la de automatización mientras envía).
- **v4 no reinicia WhatsApp** si antes de suspender estaba `disconnected`/QR/inactivo: podría quitarle la sesión a otra PC.
- La lógica pura recibe reloj y timers inyectables para pruebas con reloj falso.
