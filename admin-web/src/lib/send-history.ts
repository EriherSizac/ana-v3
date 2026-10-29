/**
 * Historial de envíos (add-agent-send-history, spec v3/agent-send-history
 * "Vista Historial de envíos"): tipos, etiquetas, query y CSV compartidos por
 * la vista y el BFF. Módulo puro.
 */

export const RESULT_STATUSES = ['sent', 'no_whatsapp', 'error', 'por_revisar'] as const;
export type ResultStatus = (typeof RESULT_STATUSES)[number];

export const STATUS_LABEL: Record<ResultStatus, string> = {
  sent: 'Enviado',
  no_whatsapp: 'Sin WhatsApp',
  error: 'Error',
  por_revisar: 'Por revisar',
};

export const STATUS_VARIANT: Record<ResultStatus, 'success' | 'muted' | 'error' | 'secondary'> = {
  sent: 'success',
  no_whatsapp: 'muted',
  error: 'error',
  por_revisar: 'secondary',
};

export const SORT_FIELDS = ['sentAt', 'status', 'credit'] as const;
export type SortField = (typeof SORT_FIELDS)[number];
export type SortOrder = 'asc' | 'desc';

/** Rango máximo que acepta v3 (días MX, ambos incluidos). */
export const MAX_RANGE_DAYS = 31;
export const DEFAULT_RANGE_DAYS = 7;
export const PAGE_SIZE = 200;
/** Tope de filas para exportar (páginas de 500). */
export const EXPORT_MAX_ROWS = 10_000;
export const EXPORT_PAGE = 500;

export interface ResultRow {
  id: string;
  agent: string;
  assignmentId: string;
  publicationId: string | null;
  uploadId: string | null;
  rowIndex: number;
  credit: string | null;
  /** Enmascarado por v3 (`**1234`). */
  phone: string;
  status: ResultStatus;
  errorCode: string | null;
  error: string | null;
  sentAt: string;
  messagePreview: string | null;
}

export type StatusCounts = Record<ResultStatus, number>;

export interface PublicationSummary extends StatusCounts {
  publicationId: string;
  agent: string;
  publishedAt: string;
  published: number;
  reported: number;
  pending: number | null;
  templatePreview: string;
}

export interface ResultsResponse {
  campaign: string;
  agent: string | null;
  agents: string[];
  from: string;
  to: string;
  total: number;
  items: ResultRow[];
  nextCursor: string | null;
  summary: StatusCounts & { total: number };
  publications: PublicationSummary[];
  unlinked: StatusCounts & { reported: number };
}

export interface HistoryFilters {
  from: string;
  to: string;
  statuses: ResultStatus[];
  publicationId: string | null;
  q: string;
  agent: string | null;
  sort: SortField;
  order: SortOrder;
}

// ── Fechas (días de Ciudad de México) ────────────────────────────────────

const mxDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit' });
const mxDateTime = new Intl.DateTimeFormat('es-MX', { timeZone: 'America/Mexico_City', dateStyle: 'short', timeStyle: 'short' });

/** `YYYY-MM-DD` en hora de Ciudad de México. */
export const mxToday = (now: Date = new Date()): string => mxDay.format(now);

/** Suma días a un `YYYY-MM-DD`. */
export const addDays = (date: string, days: number): string =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

export const isDay = (s: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));

/** Días entre `from` y `to` incluidos (0 si el orden es inválido). */
export const rangeDays = (from: string, to: string): number =>
  isDay(from) && isDay(to) && from <= to ? Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1 : 0;

/** Fecha y hora legibles en Ciudad de México. */
export function formatMx(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : mxDateTime.format(d);
}

/** Error de rango para mostrar junto a los filtros, o null. */
export function rangeError(from: string, to: string): string | null {
  if (!isDay(from) || !isDay(to)) return 'Elige un rango de fechas válido';
  if (from > to) return 'La fecha inicial debe ser anterior a la final';
  if (rangeDays(from, to) > MAX_RANGE_DAYS) return `El rango admite como máximo ${MAX_RANGE_DAYS} días`;
  return null;
}

export const defaultFilters = (now: Date = new Date()): HistoryFilters => {
  const to = mxToday(now);
  return { from: addDays(to, -(DEFAULT_RANGE_DAYS - 1)), to, statuses: [], publicationId: null, q: '', agent: null, sort: 'sentAt', order: 'desc' };
};

/** Query de v3 para los filtros (sin parámetros vacíos). */
export function buildQuery(f: HistoryFilters, page: { cursor?: string | null; limit?: number } = {}): string {
  const p = new URLSearchParams();
  p.set('from', f.from);
  p.set('to', f.to);
  if (f.statuses.length > 0) p.set('status', f.statuses.join(','));
  if (f.publicationId) p.set('publicationId', f.publicationId);
  if (f.q.trim()) p.set('q', f.q.trim());
  if (f.agent) p.set('agent', f.agent);
  p.set('sort', f.sort);
  p.set('order', f.order);
  if (page.cursor) p.set('cursor', page.cursor);
  p.set('limit', String(page.limit ?? PAGE_SIZE));
  return p.toString();
}

/** Siguiente orden al pulsar una columna: misma columna alterna; otra empieza descendente. */
export function nextSort(f: Pick<HistoryFilters, 'sort' | 'order'>, field: SortField): Pick<HistoryFilters, 'sort' | 'order'> {
  if (f.sort === field) return { sort: field, order: f.order === 'desc' ? 'asc' : 'desc' };
  return { sort: field, order: field === 'sentAt' ? 'desc' : 'asc' };
}

// ── Tarjetas ─────────────────────────────────────────────────────────────

/** Porcentaje reportado de una publicación (0–100), o null sin contactos. */
export function progressPct(p: Pick<PublicationSummary, 'published' | 'reported'>): number | null {
  if (!p.published) return null;
  return Math.min(100, Math.round((p.reported / p.published) * 100));
}

// ── CSV ──────────────────────────────────────────────────────────────────

const CSV_HEADER = ['fecha_envio_mx', 'agente', 'estado', 'credito', 'telefono', 'publicacion', 'carga', 'fila', 'error', 'mensaje'];

const csvCell = (v: unknown): string => {
  const s = v == null ? '' : String(v);
  // Evita fórmulas al abrir en Excel.
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

/** CSV (con BOM para Excel) de las filas ya filtradas; los teléfonos siguen enmascarados. */
export function toCsv(rows: readonly ResultRow[]): string {
  const lines = [CSV_HEADER.join(',')];
  for (const r of rows) {
    lines.push(
      [formatMx(r.sentAt), r.agent, STATUS_LABEL[r.status] ?? r.status, r.credit, r.phone, r.publicationId, r.uploadId, r.rowIndex + 1, r.error, r.messagePreview]
        .map(csvCell)
        .join(','),
    );
  }
  return `﻿${lines.join('\r\n')}\r\n`;
}

export const csvFileName = (campaign: string, f: Pick<HistoryFilters, 'from' | 'to' | 'agent'>): string =>
  `historial-envios-${campaign}${f.agent ? `-${f.agent}` : ''}-${f.from}_${f.to}.csv`.replace(/[^A-Za-z0-9._-]/g, '_');
