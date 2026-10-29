'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { ListFilter } from 'lucide-react';
import { Input } from '@/components/ui';
import { cn } from '@/lib/cn';
import {
  EMPTY_VALUE_LABEL,
  MAX_FILTER_VALUES,
  parseDay,
  parseNumber,
  visibleValues,
  type ColumnFilter,
  type ColumnKind,
  type ValueCount,
} from '@/lib/workspace';

export interface ColumnFilterStats {
  kind: ColumnKind;
  /** Valores de las filas que pasan los demás filtros (más frecuentes primero). */
  counts: ValueCount[];
}

export interface ColumnFilterButtonProps {
  column: string;
  active: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  filter: ColumnFilter | undefined;
  onChange: (next: ColumnFilter) => void;
  /** Solo se calcula con el popover abierto (`null` cerrado). */
  stats: ColumnFilterStats | null;
  /** Texto mostrado por valor (p. ej. teléfonos enmascarados). */
  formatValue?: (v: string) => string;
}

const POPOVER_WIDTH = 288;
const GUTTER = 8;
const fmtCount = new Intl.NumberFormat('es-MX');

/** Botón de filtro del encabezado + popover estilo Excel (lista de valores y rango). */
export function ColumnFilterButton({ column, active, open, onOpenChange, filter, onChange, stats, formatValue }: ColumnFilterButtonProps) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-label={`Filtrar ${column}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        data-active={active || undefined}
        onClick={() => onOpenChange(!open)}
        className={cn(
          'shrink-0 rounded-md p-1 normal-case focus:outline-none focus-visible:ring-2 focus-visible:ring-secondary',
          active ? 'bg-primary-light-90 text-primary' : 'text-text-light-muted hover:bg-neutral-40 hover:text-text-light',
        )}
      >
        <ListFilter className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
      {open && stats && (
        <ColumnFilterPopover
          anchorRef={buttonRef}
          column={column}
          filter={filter}
          onChange={onChange}
          stats={stats}
          formatValue={formatValue}
          onClose={(focusTrigger) => {
            onOpenChange(false);
            if (focusTrigger) buttonRef.current?.focus();
          }}
        />
      )}
    </>
  );
}

interface PopoverProps {
  anchorRef: RefObject<HTMLButtonElement | null>;
  column: string;
  filter: ColumnFilter | undefined;
  onChange: (next: ColumnFilter) => void;
  stats: ColumnFilterStats;
  formatValue?: (v: string) => string;
  onClose: (focusTrigger: boolean) => void;
}

function ColumnFilterPopover({ anchorRef, column, filter, onChange, stats, formatValue, onClose }: PopoverProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  const place = useCallback(() => {
    const r = anchorRef.current?.getBoundingClientRect();
    if (!r) return;
    const maxLeft = Math.max(GUTTER, window.innerWidth - POPOVER_WIDTH - GUTTER);
    setPos({ top: r.bottom + 4, left: Math.min(Math.max(GUTTER, r.right - POPOVER_WIDTH), maxLeft) });
  }, [anchorRef]);

  useLayoutEffect(place, [place]);

  useEffect(() => {
    searchRef.current?.focus();
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || anchorRef.current?.contains(t)) return;
      closeRef.current(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      closeRef.current(true);
    };
    const onScroll = (e: Event) => {
      if (!panelRef.current?.contains(e.target as Node)) place();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', place);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', place);
    };
  }, [anchorRef, place]);

  const selected = useMemo(() => filter?.values ?? [], [filter?.values]);
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const label = useCallback((v: string) => (v === '' ? EMPTY_VALUE_LABEL : formatValue ? formatValue(v) : v), [formatValue]);
  const { items, matches } = useMemo(() => visibleValues(stats.counts, query, selected, MAX_FILTER_VALUES, label), [stats.counts, query, selected, label]);

  const update = (patch: Partial<ColumnFilter>) => onChange({ ...filter, ...patch });
  const setValues = (values: string[]) => update({ values });
  const toggle = (v: string) => setValues(selectedSet.has(v) ? selected.filter((x) => x !== v) : [...selected, v]);
  const selectAll = () => {
    const add = matches.map((m) => m.value).filter((v) => !selectedSet.has(v));
    setValues([...selected, ...add]);
  };
  const clearValues = () => setValues(query ? selected.filter((v) => !matches.some((m) => m.value === v)) : []);

  const number = filter?.number ?? { min: '', max: '' };
  const date = filter?.date ?? { from: '', to: '' };
  const badNumber = (s: string) => !!s.trim() && parseNumber(s) === null;
  const badDate = (s: string) => !!s.trim() && parseDay(s) === null;

  const panel = (
    <div
      ref={panelRef}
      role="dialog"
      aria-label={`Filtro de ${column}`}
      data-testid={`column-filter-${column}`}
      className="fixed z-50 rounded-xl border border-neutral-50 bg-white p-3 text-left text-sm normal-case tracking-normal text-text shadow-card animate-enter"
      style={{ top: pos?.top ?? 0, left: pos?.left ?? 0, width: POPOVER_WIDTH, visibility: pos ? 'visible' : 'hidden' }}
    >
      <p className="truncate text-xs font-semibold text-text-light">{column}</p>

      {stats.kind === 'number' && (
        <fieldset className="mt-2">
          <legend className="mb-1 text-xs font-semibold text-text-light">Rango</legend>
          <div className="flex gap-2">
            <Input
              className="h-9"
              inputMode="decimal"
              placeholder="Mín"
              aria-label={`Mínimo de ${column}`}
              value={number.min}
              invalid={badNumber(number.min)}
              onChange={(e) => update({ number: { ...number, min: e.target.value } })}
            />
            <Input
              className="h-9"
              inputMode="decimal"
              placeholder="Máx"
              aria-label={`Máximo de ${column}`}
              value={number.max}
              invalid={badNumber(number.max)}
              onChange={(e) => update({ number: { ...number, max: e.target.value } })}
            />
          </div>
        </fieldset>
      )}

      {stats.kind === 'date' && (
        <fieldset className="mt-2">
          <legend className="mb-1 text-xs font-semibold text-text-light">Rango de fechas</legend>
          <div className="flex gap-2">
            <Input
              className="h-9"
              placeholder="dd/mm/aaaa"
              aria-label={`Desde ${column}`}
              value={date.from}
              invalid={badDate(date.from)}
              onChange={(e) => update({ date: { ...date, from: e.target.value } })}
            />
            <Input
              className="h-9"
              placeholder="dd/mm/aaaa"
              aria-label={`Hasta ${column}`}
              value={date.to}
              invalid={badDate(date.to)}
              onChange={(e) => update({ date: { ...date, to: e.target.value } })}
            />
          </div>
          {(badDate(date.from) || badDate(date.to)) && <p className="mt-1 text-xs text-error-60">Usa el formato dd/mm/aaaa</p>}
        </fieldset>
      )}

      <div className="mt-3">
        <input
          ref={searchRef}
          type="search"
          aria-label={`Buscar valores de ${column}`}
          placeholder="Buscar…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="h-9 w-full rounded-lg border border-input px-3 text-sm placeholder:text-text-light-muted focus:outline-none focus:ring-2 focus:ring-secondary"
        />
        <div className="mt-2 flex items-center justify-between gap-2 text-xs">
          <button
            type="button"
            onClick={selectAll}
            disabled={matches.length === 0}
            className="rounded-lg px-2 py-1 font-semibold text-primary hover:bg-primary-light-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-secondary disabled:opacity-50"
          >
            Seleccionar todo
          </button>
          <button
            type="button"
            onClick={clearValues}
            disabled={selected.length === 0}
            className="rounded-lg px-2 py-1 font-semibold text-primary hover:bg-primary-light-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-secondary disabled:opacity-50"
          >
            Limpiar
          </button>
        </div>
        <ul role="group" aria-label={`Valores de ${column}`} className="mt-1 max-h-60 overflow-y-auto">
          {items.length === 0 && <li className="px-2 py-2 text-text-light">Sin resultados</li>}
          {items.map((c) => (
            <li key={c.value}>
              <label className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-neutral-30">
                <input type="checkbox" aria-label={label(c.value)} checked={selectedSet.has(c.value)} onChange={() => toggle(c.value)} />
                <span className={cn('min-w-0 flex-1 truncate', c.value === '' && 'italic text-text-light')}>{label(c.value)}</span>
                <span className="shrink-0 text-xs text-text-light">{fmtCount.format(c.count)}</span>
              </label>
            </li>
          ))}
        </ul>
        {matches.length > items.length && (
          <p className="mt-1 text-xs text-text-light" data-testid="column-filter-truncated">
            Mostrando {fmtCount.format(items.length)} de {fmtCount.format(matches.length)} valores; busca para encontrar otros.
          </p>
        )}
      </div>
    </div>
  );
  return createPortal(panel, document.body);
}
