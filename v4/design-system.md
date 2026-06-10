# Pernexium — Design System

Lineamientos visuales y de componentes **compartidos** por todos los productos
internos de Pernexium (ARIA, VID, CRM, VPN Admin, iMery, paneles administrativos,
etc.). Pensado para implementarse en **cualquier proyecto** nuevo o existente, no
para una app en particular. Mantener consistencia con `pernexium.com`.

Donde aparezca una ruta tipo `src/...` o `<proyecto>/...`, es relativa a tu
repo; adáptala. Donde se citen utilidades (`pernexium-card`, `pernexium-gradient`,
tokens Tailwind), créalas en tu proyecto con los valores de esta guía para que
todos los productos se vean igual.

---

## 1. Identidad

| Atributo | Valor |
|----------|-------|
| Marca | `PERNEXIUM` (caps, tracking ancho, peso 700-900) |
| Sub-marca | nombre del producto en pill blanco translúcido sobre navy (ej. `VPN Admin`, `CRM`, `iMery`) |
| Tono | Corporativo, sobrio, profesional. Cero emojis decorativos. |
| Idioma UI | Español MX (salvo que el producto requiera otro) |
| Densidad | Confortable — `py-3` filas, `gap-3` columnas, padding generoso en cards |

---

## 2. Paleta

Define estos tokens en el `tailwind.config.ts` de tu proyecto. Cada token va con
`foreground` para el contraste correcto.

### Primary (acción principal, headers, links)

| Token | Hex | Uso |
|-------|-----|-----|
| `primary` | `#145CB3` | Botones CTA, headings, links activos |
| `primary.foreground` | `#FFFFFF` | Texto sobre `primary` |
| `primary.10–90` | gradient navy → casi negro | Hover, pressed, fondos oscuros |
| `primary.light.10–90` | celestes → blanco azulado | Badges, fondos suaves, hover claro |

### Secondary (acento, info)

| Token | Hex | Uso |
|-------|-----|-----|
| `secondary` | `#27A3D7` | Acentos, focus rings, indicadores secundarios |
| `secondary.light.10–90` | celestes claros | Fondos suaves, hover, selección |

### Error (destructive)

| Token | Hex | Uso |
|-------|-----|-----|
| `error` | `#56070C` | Texto destructive intenso |
| `error.10` | `#F9E8E9` | Fondo de alertas / badges error |
| `error.60` | `#D71B28` | Botones destructive, iconos warning |
| `error.70` | `#B3131F` | Títulos destructive (`text-error-70`) |

### Neutral (superficies)

| Token | Hex | Uso |
|-------|-----|-----|
| `neutral.10` (white) | `#FFFFFF` | Cards, dialogs |
| `neutral.30` | `#EEF3F7` | Background app, headers tabla |
| `neutral.40` | `#E5EBF1` | Skeletons, dividers, hover |
| `neutral.50` | `#DCE4EB` | Borders default |
| `neutral.60` | `#D3DCE5` | Borders checkbox/select |

### Text

| Token | Hex | Uso |
|-------|-----|-----|
| `text` | `#050505` | Texto principal body |
| `text.muted` | `#333333` | Texto secundario |
| `text.light` | `#666666` | Captions, etiquetas |
| `text.light.muted` | `#999999` | Placeholder, etiquetas inactivas |

### Reglas

- Texto sobre `bg-primary` siempre `text-primary-foreground` (blanco). Nunca usar gris/negro sobre fondo azul.
- Texto destructive: `text-error-70` (no `text-error` directo, muy oscuro).
- Fondos suaves: `bg-primary-light-90` (azul muy pálido) o `bg-neutral-30`.
- **Nunca** hardcodear hex en JSX ni usar colores Tailwind default (`bg-blue-500`, `text-gray-XXX`). Siempre tokens.

---

## 3. Tipografía

```
@import url("https://fonts.googleapis.com/css2?family=Jost:ital,wght@0,100..900;1,100..900&display=swap");
```

- **Headings (`h1–h6`)**: Jost, weight 700, `text-large` base.
- **Body (`<body>`)**: Inter (vía `next/font/google` cargado en el layout root).
- **Mono**: stack default del browser para datos técnicos (IDs, IPs, keys, tokens), clase `font-mono`.

### Escala recomendada

| Uso | Clase Tailwind |
|-----|----------------|
| Hero título página | `text-2xl sm:text-3xl font-bold` |
| Sub-título / sección | `text-base font-semibold` |
| Body | `text-sm` |
| Body secundario | `text-sm text-text-muted` |
| Caption / etiqueta | `text-xs text-text-light` |
| Micro tag | `text-2xs uppercase tracking-wider` |

### Reglas

- Headings usan Jost por la clase `.jost` o vía `h1-h6` (CSS global).
- Body siempre Inter (legibilidad en datos).
- Datos técnicos (IPs, IDs, keys): `font-mono`, opcionalmente `text-xs`.

---

## 4. Espaciado y layout

### Container

Toda página envuelve su contenido en:

```jsx
<main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8 lg:py-10">
```

- `max-w-7xl` (1280 px) — estándar para tablas y cards anchas.
- Padding responsive: `px-4` mobile → `sm:px-6` tablet → `lg:px-8` desktop.
- Vertical: `py-8` mobile → `lg:py-10` desktop.

Páginas más angostas (formularios, listas simples) pueden usar `max-w-4xl` pero **mantener** la estructura `mx-auto px-4 sm:px-6 lg:px-8`.

### Breakpoints (defaults Tailwind)

| Token | Width | Uso |
|-------|-------|-----|
| `sm` | ≥ 640px | Tablets pequeñas, paddings intermedios |
| `md` | ≥ 768px | Nav full (oculta hamburger) |
| `lg` | ≥ 1024px | Desktop estándar |
| `xl` | ≥ 1280px | Pantallas grandes |

### Cards

```jsx
<div className="pernexium-card p-6 shadow-card">
```

Utilidad `pernexium-card` (defínela en tu `globals.css`):
```css
.pernexium-card {
  @apply rounded-2xl bg-white border border-neutral-50 shadow-card;
}
```

- Radius: `rounded-2xl` (~16px) para cards principales, `rounded-xl` (~12px) para sub-elementos, `rounded-full` para pills/badges.
- Sombra `shadow-card`: dos capas suaves (`0 1px 2px` + `0 4px 16px` con tinte navy 4-5%).

### Gradient header

```jsx
<header className="pernexium-gradient sticky top-0 z-30 border-b border-white/10">
```

```css
.pernexium-gradient {
  background: linear-gradient(135deg, #06417c 0%, #104a8f 55%, #145cb3 100%);
}
```

---

## 5. Componentes

Componentes base recomendados (estilo shadcn). Ubícalos en `src/components/ui/`
de tu proyecto. Los nombres y la API son la convención compartida.

### Button

Variantes:

| Variant | Uso |
|---------|-----|
| `default` (primary) | CTA principal — `bg-primary text-primary-foreground` |
| `outline` | Acciones secundarias |
| `destructive` | Eliminar / Revocar / Quitar |
| `ghost` | Acciones tipo "Cancelar" inline |

```jsx
<Button onClick={save}>Guardar</Button>
<Button variant="outline">Recargar</Button>
<Button variant="destructive">Eliminar</Button>
```

Tamaños: `sm`, `default`, `lg`.

### Input

```jsx
<Input placeholder="Buscar..." value={q} onChange={(e) => setQ(e.target.value)} />
```

Hereda `bg-white`, `border-input`, `focus:ring-secondary`.

### Card

```jsx
<Card>
  <CardHeader>
    <CardTitle>Título</CardTitle>
    <CardDescription>Subtítulo</CardDescription>
  </CardHeader>
  <CardContent>...</CardContent>
</Card>
```

Usa `pernexium-card` directamente cuando necesites más control.

### Dialog

Para edición compleja (CRUD). Para confirmaciones cortas usar `ConfirmDialog`.

### ConfirmDialog

Modal animado con fade + slide. **Obligatorio** para toda acción destructiva y
para cualquier confirmación (sustituye a los diálogos nativos del browser).

```jsx
<ConfirmDialog
  open={open}
  title="Eliminar registro"
  description="Vas a eliminar el registro ABC. Esta acción no se puede deshacer."
  destructive
  confirmLabel="Eliminar"
  onConfirm={doDelete}
  onCancel={() => setOpen(false)}
/>
```

- Backdrop blur + tint navy semi-transparente
- Icon badge: `⚠` rojo (destructive) o `?` azul (normal)
- Cierre por: backdrop click, Escape, botón cancelar
- Disabled durante `loading`

### Skeleton

Loader visual. **Obligatorio** en estado `loading` de pages — no usar texto plano "Cargando…".

```jsx
{loading ? (
  <Skeleton className="h-4 w-32" />
) : (
  <span>{data}</span>
)}
```

Tamaños: usa `h-X w-Y` para coincidir con el contenido real.

Patrón típico tabla:
```jsx
{Array.from({ length: 8 }).map((_, i) => (
  <div key={i} className="flex items-center gap-4">
    <Skeleton className="h-4 w-4" />
    <Skeleton className="h-4 w-40" />
    {/* ... */}
  </div>
))}
```

### SearchableMultiselect + FilterPill

Dropdown buscable. Estilo Notion. Selección múltiple. Pills externas para mostrar valores activos. **Todo selector de la app debe ser de este tipo** (ver §11).

```jsx
<SearchableMultiselect
  label="Categoría"
  options={items.map((g) => ({ value: g, label: g }))}
  selected={filters}
  onChange={setFilters}
  placeholder="Buscar…"
/>

{Array.from(filters).map((g) => (
  <FilterPill
    key={g}
    label={`Categoría: ${g}`}
    onRemove={() => setFilters(toggleSet(filters, g))}
  />
))}
```

### Badge

Pills coloreadas según categoría / estado. Mantener legibilidad WCAG AA.

### Nav

Sticky top con `pernexium-gradient`. Pills redondeadas para items. Active state: fondo blanco + texto primary. Hamburger menu `< md`.

---

## 6. Animaciones (`globals.css`)

| Keyframe | Uso |
|----------|-----|
| `fadeIn` | Backdrop modal, content reveal |
| `enter` | Dialog panel entrada (translateY -10px + fade) |
| `leave` | Dialog panel salida |
| `shimmer` | Skeleton (gradient sliding) |
| `pulse` | Indicadores "live" |
| `glow` | Highlights especiales (ej. login) |
| `sweep` / `lightsweep-animation` | Texto con brillo recorriendo (loading screens) |
| `gradientAnimation` (loading-screen) | Background degradado animado en splash |
| `spin` | Spinners |

### Reglas

- Duración: 200–500 ms (entradas/salidas), 1.5–3 s (loops).
- Easing: `ease-out` para entradas, `ease-in` para salidas, `linear` para loops.
- **NO** usar en cada hover trivial — guardar animación para feedback significativo.

---

## 7. Patrones

### 7.1 Filter bar (Notion-style)

1. Search Input (`min-w-[180px] flex-1`).
2. `SearchableMultiselect` dropdowns (1–4 max).
3. `GroupBySelect` opcional (agrupar / subagrupar).
4. Botón "Limpiar filtros" cuando hay filtros activos.
5. Debajo: pills (`FilterPill`) con valores activos, con `×` para quitar.

### 7.2 Bulk action bar

Aparece **solo** cuando hay items seleccionados. Sticky o inline arriba de la tabla.

```jsx
<div className="rounded-2xl bg-primary px-5 py-3 text-white shadow-card flex justify-between">
  <span>{n} seleccionados</span>
  <div className="flex gap-2">
    <button>Acción primaria</button>
    <button variant="outline">Acción secundaria</button>
    <button variant="ghost">Cancelar</button>
  </div>
</div>
```

Responsive: stack columnar en mobile (`flex-col sm:flex-row`).

### 7.3 Group-by (Notion grouping)

Tabla con header rows colapsables:
- Chevron `▸` (rotated `90deg` cuando expandido)
- Label del grupo + count badge
- Click toggles collapsed

Subgroups: indent con `paddingLeft: depth * 16`.

### 7.4 Tabla responsive

```jsx
<div className="overflow-x-auto">
  <table className="w-full min-w-[900px]">...</table>
</div>
```

Mobile: scroll horizontal. **No** hacer tablas que se rompan layout.

### 7.5 Mensajes inline

| Tipo | Estilo |
|------|--------|
| Error | `rounded-xl bg-red-50 px-4 py-2 text-sm text-red-700` |
| Info / éxito | `rounded-xl bg-green-50 px-4 py-2 text-sm text-green-700` |

Para errores críticos o confirmaciones prefiere `ConfirmDialog` o `Toast`.

---

## 8. Accesibilidad

- Contrast ratio WCAG AA mínimo: 4.5:1 body, 3:1 grandes.
- `aria-label` en botones icon-only.
- `aria-modal="true"` y `role="dialog"` en modales.
- Escape cierra modales/dropdowns.
- Focus visible: `focus:ring-2 focus:ring-secondary` por default en inputs/buttons.
- Tab order natural — no `tabIndex` arbitrario.
- Skeleton no debe leerse como texto (usar `aria-hidden="true"` si interfiere screen readers).

---

## 9. Iconografía

- Preferir glyphs Unicode simples (`▸`, `▾`, `×`, `↑↓`, `⚠`, `?`, `✓`) o SVG inline minimal.
- No emojis decorativos en producción (solo si user data lo requiere).
- Para sets de iconos, usar `lucide-react`.

---

## 10. Do's and Don'ts

### Do

- ✅ Usar `pernexium-card` para superficies elevadas.
- ✅ `max-w-7xl mx-auto px-4 sm:px-6 lg:px-8` en TODO `<main>`.
- ✅ Skeleton en estado loading.
- ✅ ConfirmDialog para destructive y para toda confirmación.
- ✅ Pills sólidas para selección activa, outline para opciones.
- ✅ Mobile-first: probar `< 640 px` antes de commit.
- ✅ Heading h1 por página, texto descriptivo `text-sm text-text-light`.

### Don't

- ❌ `bg-blue-500` (azul Tailwind default). Usar `bg-primary`.
- ❌ Texto negro sobre fondo navy. Siempre `text-primary-foreground`.
- ❌ `text-gray-XXX`. Usar `text-text-*`.
- ❌ Loaders genéricos "Cargando…". Usar Skeleton.
- ❌ `alert()` / `confirm()` / `prompt()` nativos. Usar `ConfirmDialog` / modal (§11).
- ❌ `<select>` nativo sin búsqueda. Usar `SearchableMultiselect` (§11).
- ❌ Tablas sin `overflow-x-auto`.
- ❌ Emojis en titles / labels.
- ❌ Hardcodear colores hex en JSX. Usar tokens Tailwind.

---

## 11. Reglas globales (obligatorias en todos los productos)

Reglas transversales. Aplican **siempre**, en cualquier producto Pernexium —
sobre todo en los que comparten sesión SSO (ver
[`sso-cognito-cookie-storage.md`](./sso-cognito-cookie-storage.md)). No son
"según el caso".

- **Login siempre con fondo azul.** La pantalla de login usa fondo azul (token
  `primary` / `pernexium-gradient`), nunca blanco, gris ni el tema del resto de
  la app. Texto sobre ese fondo siempre `text-primary-foreground`.
- **Login por username, no email.** El identificador de login es un **username**,
  no un correo. **No** validar como email, **no** forzar formato de mail, **no**
  usar `type="email"` ni regex de correo en ese input. Aceptar el usuario tal
  cual (el IdP resuelve contra el username del pool). Validación de email solo
  aplica a destinatarios de correo, nunca al login.
- **Siempre searchable dropdowns.** Todo selector debe ser un dropdown con
  búsqueda (filtrado por texto al escribir) — usar `SearchableMultiselect` (ver
  §5), nunca un `<select>` nativo sin búsqueda para listas no triviales. Aplica
  a todos los pickers.
- **Nunca diálogos nativos del browser (`alert()` / `confirm()` / `prompt()`).**
  Toda confirmación, aviso o error que requiera atención del usuario va en un
  **modal** (`ConfirmDialog`, ver §5) o, para avisos menores, en mensaje inline /
  toast (§7.5). Los `alert`/`confirm`/`prompt` nativos están prohibidos en
  producción.

---

## 12. Referencias

Rutas relativas a tu proyecto (adáptalas):

- Componentes base: `src/components/ui/`
- Tema y tokens: `tailwind.config.ts`
- Estilos globales y utilidades (`pernexium-card`, `pernexium-gradient`, keyframes): `src/app/globals.css`
- Layout root (fuentes, providers): `src/app/layout.tsx`
- Pernexium corporativo: `https://pernexium.com`

Actualizar este doc cada que se agregue un componente compartido o cambie un
token visual.
