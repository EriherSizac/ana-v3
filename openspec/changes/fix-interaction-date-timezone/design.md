# Design

## Context

Los cuatro sitios que construyen interacciones repiten el mismo bloque (ver proposal.md - Why):

```js
const now = new Date();
const contact_date = now.toISOString().slice(0, 10);   // UTC
const hh = String(now.getHours()).padStart(2, '0');    // zona del equipo
const nextH = String((now.getHours() + 1) % 24).padStart(2, '0');
```

Sitios: `index.js:491-495` (automático), `whatsapp-manual.js:326-330` (`submitNoWhatsappInfoInteraction`), `whatsapp-manual.js:2286-2290` (`submitGestionInteraction`), `whatsapp-monitor.js:533-537`. Todos corren en Node (dentro de `exposeFunction` en el caso manual), no en el navegador, así que pueden importar un módulo.

El CLI portable embebe Node 18.20.2 (`build-portable.ps1:47`), cuya distribución oficial incluye ICU completo: `Intl.DateTimeFormat` acepta `timeZone: 'America/Mexico_City'` y su base tz ya refleja la eliminación del horario de verano en México (2022). El build pkg (`node18-win-x64`) también usa ICU completo.

## Goals / Non-Goals

**Goals:**
- Un helper puro y probado, la única fuente de `contact_date`/`contact_time`/`range_time`.
- Resultado idéntico sin importar la zona del equipo.

**Non-Goals:**
- Corregir el reloj del equipo (si la hora del sistema está mal, el instante sigue mal; solo se elimina la dependencia de la zona).
- Cambiar `sent_at` (ISO UTC) ni las marcas de tiempo de respaldos.
- Hacer configurable la zona por agente o campaña.

## Decisions

### D1. Zona explícita `America/Mexico_City` en lugar de la zona del equipo
Los agentes y las carteras son de México y el CRM de Pernexium reporta en hora del centro. Usar la zona del equipo (la corrección "mínima": `getFullYear/getMonth/getDate` locales) arreglaría la incoherencia fecha/hora solo en equipos bien configurados; en la práctica hay equipos con Windows en UTC o en zona de EE. UU., y entonces fecha **y** hora quedarían desplazadas. Una zona explícita hace el dato independiente del equipo y coherente entre agentes.
- Alternativa: zona del equipo. Descartada por lo anterior.
- Alternativa: enviar UTC y que el CRM convierta. Cambiaría el contrato del CRM (externo) y los reportes existentes; descartada.
- Decisión confirmada: no hay agentes fuera de la zona centro (CDMX), así que `America/Mexico_City` fija es correcta. La zona sigue siendo un parámetro del helper si eso cambiara.

### D2. API del helper
`v3/cli-whatsapp/interaction-time.js`:

```js
export const INTERACTIONS_TIME_ZONE = 'America/Mexico_City';
export function interactionDateTime(date = new Date(), timeZone = INTERACTIONS_TIME_ZONE)
// → { contact_date: 'YYYY-MM-DD', contact_time: 'HH:MM', range_time: 'HH:00 - HH+1:00' }
```

Implementación con un único `Intl.DateTimeFormat('en-CA', { timeZone, year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hourCycle:'h23' }).formatToParts(date)`, de modo que fecha y hora salen del mismo instante. `hourCycle: 'h23'` evita el `24:05` que algunas versiones de ICU producen con `hour12: false`. `range_time` conserva la regla actual `(h + 1) % 24` (23 → `00`). El formateador se crea una vez por zona (cache) porque el monitor lo usa cada pocos segundos.
- Alternativa: aritmética manual con offset fijo `-06:00`. Funciona hoy, pero se rompe si México vuelve a cambiar su régimen horario; la base tz de ICU lo absorbe con una actualización de Node.

### D3. Pruebas
`test/interaction-time.test.js` con instantes fijos: `2026-10-27T01:40:00Z` → `2026-10-26`, `19:40`, `19:00 - 20:00`; `2026-10-27T05:59:00Z` → `23:59` y `23:00 - 00:00`; `2026-10-27T06:05:00Z` → `2026-10-27`, `00:05`, `00:00 - 01:00`; un instante de abril (antiguo horario de verano) para fijar UTC-6. Independencia del equipo: la misma prueba se ejecuta en procesos hijos con `TZ=UTC` y `TZ=Asia/Tokyo` (`child_process.execFileSync(process.execPath, [...], { env: { ...process.env, TZ } })`) y compara resultados.

## Risks / Trade-offs

- [Reportes del CRM que ya "compensaban" el desfase] → a partir del release las interacciones nocturnas cambian de día; avisar a quien opera los reportes. Las interacciones históricas afectadas se identifican como las registradas con `contact_time` ≥ `18:00` (equipos en hora de México) y su `contact_date` real es un día antes.
- [Un equipo con reloj desfasado] → fuera de alcance; el dato sigue el reloj del sistema.
- [Node sin ICU completo en algún build futuro] → `Intl` lanzaría `RangeError` con la zona; la prueba lo detecta y el helper hace fallback a la hora local con advertencia en consola en lugar de tumbar el ciclo.

## Migration Plan

Sin migración de datos. Release normal (build + upload). Rollback = publicar una versión mayor con el código anterior.

