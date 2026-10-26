# Design

## Context

- `normalizeDigits(raw, cc)`: quita no-dígitos, `00`, convierte `521`+10 (13) a `52`+10 y antepone `cc` si `!d.startsWith(cc)`; acepta 11–15 dígitos. `resolveJid` devuelve `null` tanto si la normalización falla como si `getNumberId` no encuentra el número, y `runJob` trata ambos como "No tiene WhatsApp" (reporta `no_whatsapp` → `PATCH /phone`).
- Backend `toE164Mx`: 10 → `+52`+10; `521`+10 → `+52`+10; `52`+10 → `+`; otro → `+` + dígitos (por ejemplo `+0445512345678`).
- Los jobs traen `countryCode` (default `52`) y el teléfono crudo del CSV.

## Goals / Non-Goals

**Goals:** una sola regla documentada y probada para México, aplicada igual en desktop y backend; nunca marcar "sin WhatsApp" por un problema de formato.

**Non-Goals:** soporte completo de numeración internacional (no se agrega libphonenumber; el número real lo sigue resolviendo WhatsApp).

## Decisions

- **D1. Algoritmo para lada `52`** (`normalizeMx(raw)`): `international = /^\s*(\+|00)/.test(raw)`; `d = dígitos`; quitar `00` inicial. Luego, en orden: si `d.length === 10` → `52`+d; si 12 y empieza con `52` → d; si 13 y empieza con `521` → `52`+últimos 10; si 13 y empieza con `044` o `045` → `52`+últimos 10; si 12 y empieza con `01` → `52`+últimos 10; si 11 y empieza con `1` → `52`+últimos 10; si `international` y no empieza con `52` y tiene 11–15 → d (extranjero); otro → `null`.
- **D2. Otras ladas**: se conserva la regla genérica actual (`00`, anteponer `cc` si falta, 11–15).
- **D3. Resultado tipado** en `resolveJid`: `{ kind: 'invalid' } | { kind: 'not_on_whatsapp' } | { kind: 'ok', jid }`. `runJob` mapea `invalid` → `error` "Teléfono inválido" (sin `report('no_whatsapp')`; el reporte al CRM va como `error`, que el backend registra como "Se envía WhatsApp" no contactable, igual que hoy cualquier error).
- **D4. Backend con las mismas reglas.** `src/lib/phone.ts` implementa `normalizeMx`; `toE164Mx` = `'+' + normalizeMx(raw)` (o `''` si `null`), y el reintento sin `+52` ante 404 se conserva. Se acepta código duplicado entre paquetes (no hay paquete compartido en `v4/`); la coherencia la garantizan los vectores compartidos.
- **D5. Vectores compartidos** `v4/shared/phone-mx-vectors.json` (`[{ "in": "...", "cc": "52", "out": "..." | null }]`), leídos por las pruebas de ambos paquetes con ruta relativa.

## Risks / Trade-offs

- [Un número extranjero sin `+` (p. ej. `13055551234` de EE. UU.) se interpreta como `1` + 10 de México] → Con lada `52` el CSV es mexicano por definición; para extranjeros se pide escribir `+`. Se documenta.
- [Celulares ya marcados sin WhatsApp por el error] → Se documenta cómo listarlos: jobs con `status: no_whatsapp` cuyo teléfono crudo empieza con `044`/`045`/`01` (historial de 7 días) para que operación los revise en el CRM.

## Migration Plan

Backend primero (solo afecta la búsqueda de crédito), luego release del desktop. Rollback independiente por componente.
