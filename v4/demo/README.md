# Demo — prueba de envío

`contactos-demo.csv` — un contacto para probar el envío masivo.

| Columna | Valor |
|---------|-------|
| `telefono` | `525513023544` (MX, +52 55 1302 3544) |
| `nombre` | Erick |
| `saldo` | 1234.50 |

## Cómo probar
1. Conecta WhatsApp (escanea QR).
2. Tab **Campañas** → sube `contactos-demo.csv`.
3. Columna teléfono: `telefono` · Lada país: `52`.
4. Plantilla (default): `Hola {nombre}, tu saldo es {saldo}. Realiza tu pago hoy.`
   - `{saldo}` se formatea como MXN → `$1,234.50`.
5. **Sin** "repartir" → el job va a tu propio operador → tú lo envías.
6. Subir → el backend genera el job → tu app lo recoge (~4s) y manda el mensaje.

Mensaje resultante:
> Hola Erick, tu saldo es $1,234.50. Realiza tu pago hoy.
