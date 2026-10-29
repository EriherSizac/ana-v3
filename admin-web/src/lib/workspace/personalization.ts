// Aviso de plantilla sin personalizar ("Mi asignación"): un mensaje idéntico
// para todos los contactos aumenta el riesgo de bloqueos de WhatsApp.
// Lógica pura sobre el mismo render que publica v3 (`template.ts`).
import { contactSources, PHONE_ALIASES, UPLOAD_ID_COLUMN } from './csv';
import { renderTemplateDetailed } from './template';

/** Columnas que no cuentan como campo personalizado (teléfonos e id de carga). */
const isExcluded = (h: string, phoneColumns: readonly string[]): boolean =>
  h.toLowerCase() === UPLOAD_ID_COLUMN || phoneColumns.includes(h) || (PHONE_ALIASES as readonly string[]).includes(h) || /tel|phone/i.test(h);

/**
 * La plantilla usa al menos una variable (`{{col}}`, `{col}` o expresión) que
 * resuelve a una columna del archivo. Se renderiza dos veces con valores
 * distintos por columna: si el texto cambia, algún marcador depende de una
 * columna. Marcadores desconocidos, campos estándar ausentes del archivo,
 * expresiones constantes y teléfonos no cuentan.
 */
export function templateHasCustomField(template: string, header: readonly string[], phoneColumns: readonly string[] = []): boolean {
  if (!/\{/.test(template)) return false;
  const cols = header.filter((h) => h.toLowerCase() !== UPLOAD_ID_COLUMN);
  const render = (offset: number) => {
    const s = contactSources(
      cols,
      cols.map((h, i) => (isExcluded(h, phoneColumns) ? '' : String(offset + i))),
    );
    s.fields.phone = '';
    return renderTemplateDetailed(template, s).text;
  };
  return render(1000) !== render(5000);
}

/** Columnas preferidas para sugerir, en orden. */
const PREFERRED = ['nombre_cliente', 'saldo_vencido_actual'];
const NOT_SUGGESTED = new Set(['message']);

/** Hasta `limit` columnas sugeridas para personalizar: preferidas primero, luego el resto en orden del archivo. */
export function suggestedFields(header: readonly string[], phoneColumns: readonly string[] = [], limit = 3): string[] {
  const ok = header.filter((h) => !isExcluded(h, phoneColumns) && !NOT_SUGGESTED.has(h.toLowerCase()));
  return [...PREFERRED.filter((p) => ok.includes(p)), ...ok.filter((h) => !PREFERRED.includes(h))].slice(0, limit);
}

export const NO_CUSTOM_FIELD_WARNING =
  'Tu plantilla no tiene ningún campo personalizado. Usar variables como {{nombre_cliente}} o {{saldo_vencido_actual}} hace cada mensaje distinto y reduce la probabilidad de bloqueos de WhatsApp.';
