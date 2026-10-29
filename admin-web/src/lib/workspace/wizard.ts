// Asistente de "Mi asignación" (add-agent-workspace): antigüedad de pendientes,
// borrador por campaña (sessionStorage) y resumen de lo que se va a enviar.
import type { MergedRow, PendingFile, PhoneMode } from './index';
import { phoneCandidates } from './index';

export type WizardStep = 1 | 2 | 3 | 4;
export const WIZARD_STEPS: ReadonlyArray<{ step: WizardStep; title: string }> = [
  { step: 1, title: 'Archivo de asignación' },
  { step: 2, title: 'Contactos' },
  { step: 3, title: 'Mensaje' },
  { step: 4, title: 'Resumen y envío' },
];

// ── Antigüedad (misma regla que v3 `isStaleSource`) ────────────────────────
export const MAX_SOURCE_AGE_DAYS = 90;
export const MAX_SOURCE_AGE_MS = MAX_SOURCE_AGE_DAYS * 24 * 60 * 60 * 1000;
const KEY_TS_RE = /-contacts-(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z\.csv$/;

/** Fecha de carga: `uploadedAt` de v3, la de la llave o `lastModified` (ms; `null` si ninguna). */
export function sourceDate(p: Pick<PendingFile, 'key' | 'lastModified' | 'uploadedAt'>): number | null {
  const fromIso = (s: string | null | undefined) => {
    if (!s) return null;
    const t = Date.parse(s);
    return Number.isNaN(t) ? null : t;
  };
  const up = fromIso(p.uploadedAt);
  if (up !== null) return up;
  const m = KEY_TS_RE.exec(p.key);
  if (m) {
    const [y, mo, d, h, mi, se, ms] = m.slice(1).map(Number) as [number, number, number, number, number, number, number];
    const t = Date.UTC(y, mo - 1, d, h, mi, se, ms);
    const back = new Date(t);
    if (back.getUTCMonth() === mo - 1 && back.getUTCDate() === d && h < 24 && mi < 60 && se < 60) return t;
  }
  return fromIso(p.lastModified);
}

/** ¿Se puede ofrecer? (≤ 90 días; sin fecha conocida se ofrece y v3 decide). */
export const isRecentSource = (p: Pick<PendingFile, 'key' | 'lastModified' | 'uploadedAt'>, now: number = Date.now()): boolean => {
  const t = sourceDate(p);
  return t === null || now - t <= MAX_SOURCE_AGE_MS;
};

// ── Borrador por campaña (sessionStorage) ──────────────────────────────────
export interface WizardDraft {
  v: 1;
  step: WizardStep;
  /** Archivos marcados en el paso 1 (en orden). */
  keys: string[];
  /** ETag de cada archivo cargado (mismo orden que `keys`); vacío si no se cargaron. */
  etags: string[];
  selected: string[];
  phoneColumns: string[];
  phoneMode: PhoneMode;
  overrides: Array<[string, string]>;
  template: string;
}

export const draftKey = (campaign: string): string => `ana.workspace.draft.${campaign}`;

const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');

export function loadDraft(campaign: string): WizardDraft | null {
  try {
    const raw = window.sessionStorage.getItem(draftKey(campaign));
    if (!raw) return null;
    const d = JSON.parse(raw) as Partial<WizardDraft>;
    if (!d || d.v !== 1 || ![1, 2, 3, 4].includes(d.step as number)) return null;
    if (!strings(d.keys) || !strings(d.etags) || !strings(d.selected) || !strings(d.phoneColumns)) return null;
    if (d.phoneMode !== 'first' && d.phoneMode !== 'all') return null;
    if (typeof d.template !== 'string') return null;
    const overrides = Array.isArray(d.overrides) ? d.overrides.filter((e): e is [string, string] => strings(e) && e.length === 2) : [];
    return { ...(d as WizardDraft), overrides };
  } catch {
    return null;
  }
}

export function saveDraft(campaign: string, draft: WizardDraft): void {
  try {
    window.sessionStorage.setItem(draftKey(campaign), JSON.stringify(draft));
  } catch {
    // Sin almacenamiento (modo privado, cuota): el asistente sigue sin borrador.
  }
}

export function clearDraft(campaign: string): void {
  try {
    window.sessionStorage.removeItem(draftKey(campaign));
  } catch {
    // ignore
  }
}

// ── Resumen ────────────────────────────────────────────────────────────────
export interface ExcludedReason {
  reason: string;
  count: number;
}

export interface PlanSummary {
  /** Filas seleccionadas. */
  selected: number;
  /** Mensajes que se publicarán (tras modo de teléfono y deduplicado). */
  messages: number;
  excluded: ExcludedReason[];
}

/** Cuenta mensajes y filas que no se enviarán, con su motivo. */
export function summarizePlan(
  allRows: readonly MergedRow[],
  selectedRows: readonly MergedRow[],
  phones: ReadonlyMap<string, readonly string[]>,
  phoneColumns: readonly string[],
): PlanSummary {
  const sel = new Set(selectedRows.map((r) => r.id));
  let incomplete = 0;
  let unselected = 0;
  let noPhone = 0;
  let duplicate = 0;
  let messages = 0;
  for (const r of allRows) {
    if (!r.valid) {
      incomplete++;
      continue;
    }
    if (!sel.has(r.id)) {
      unselected++;
      continue;
    }
    const n = phones.get(r.id)?.length ?? 0;
    messages += n;
    if (n > 0) continue;
    if (phoneCandidates(r.record, phoneColumns).length === 0) noPhone++;
    else duplicate++;
  }
  const excluded: ExcludedReason[] = [
    { reason: 'Sin teléfono válido en las columnas elegidas', count: noPhone },
    { reason: 'Crédito o teléfono repetido (ya incluido)', count: duplicate },
    { reason: 'No seleccionadas (o fuera de los filtros)', count: unselected },
    { reason: 'Fila incompleta', count: incomplete },
  ].filter((e) => e.count > 0);
  return { selected: selectedRows.length, messages, excluded };
}

/** Primeros `n` pares (fila, teléfono) que se enviarán, en orden de publicación. */
export function samplePairs(selectedRows: readonly MergedRow[], phones: ReadonlyMap<string, readonly string[]>, n = 3): Array<{ row: MergedRow; phone: string }> {
  const out: Array<{ row: MergedRow; phone: string }> = [];
  for (const r of selectedRows) {
    for (const phone of phones.get(r.id) ?? []) {
      if (out.length >= n) return out;
      out.push({ row: r, phone });
    }
  }
  return out;
}
