'use client';

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/cn';

export interface SelectOption {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
}

export function normalizeSearch(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

export function filterOptions(options: readonly SelectOption[], query: string): SelectOption[] {
  const q = normalizeSearch(query);
  if (!q) return [...options];
  return options.filter(
    (o) => normalizeSearch(o.label).includes(q) || normalizeSearch(o.value).includes(q) || normalizeSearch(o.description ?? '').includes(q),
  );
}

interface ComboboxProps {
  label: string;
  hideLabel?: boolean;
  options: readonly SelectOption[];
  isSelected: (value: string) => boolean;
  onPick: (value: string) => void;
  /** Texto del botón cerrado. */
  display: ReactNode;
  placeholder?: string;
  disabled?: boolean;
  emptyText?: string;
  multiple?: boolean;
  className?: string;
  footer?: ReactNode;
  id?: string;
}

/**
 * Núcleo de los selectores con búsqueda (estilo Notion). Solo permite elegir
 * opciones de la lista: el texto escrito únicamente filtra.
 */
export function Combobox({
  label,
  hideLabel,
  options,
  isSelected,
  onPick,
  display,
  placeholder = 'Buscar…',
  disabled,
  emptyText = 'Sin resultados',
  multiple = false,
  className,
  footer,
  id,
}: ComboboxProps) {
  const autoId = useId();
  const baseId = id ?? autoId;
  const listId = `${baseId}-list`;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const filtered = useMemo(() => filterOptions(options, query), [options, query]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    inputRef.current?.focus();
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  useEffect(() => setActive(0), [query]);

  const close = () => {
    setOpen(false);
    setQuery('');
    buttonRef.current?.focus();
  };

  const pick = (o: SelectOption | undefined) => {
    if (!o || o.disabled) return;
    onPick(o.value);
    if (!multiple) close();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, Math.max(filtered.length - 1, 0)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      pick(filtered[active]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  };

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      <span id={`${baseId}-label`} className={cn('mb-1 block text-xs font-semibold text-text-light', hideLabel && 'sr-only')}>
        {label}
      </span>
      <button
        ref={buttonRef}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-labelledby={`${baseId}-label ${baseId}-value`}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'flex h-10 w-full items-center justify-between gap-2 rounded-xl border border-input bg-white px-3 text-left text-sm',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-secondary disabled:cursor-not-allowed disabled:bg-neutral-30',
        )}
      >
        <span id={`${baseId}-value`} className="truncate">
          {display}
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 text-text-light" aria-hidden="true" />
      </button>
      {open && (
        <div className="absolute left-0 right-0 z-40 mt-1 min-w-[220px] rounded-xl border border-neutral-50 bg-white p-2 shadow-card animate-enter">
          <input
            ref={inputRef}
            role="combobox"
            aria-label={`Buscar ${label}`}
            aria-expanded="true"
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={filtered[active] ? `${baseId}-opt-${active}` : undefined}
            value={query}
            placeholder={placeholder}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            className="mb-2 h-9 w-full rounded-lg border border-input px-3 text-sm focus:outline-none focus:ring-2 focus:ring-secondary"
          />
          <ul id={listId} role="listbox" aria-multiselectable={multiple || undefined} className="max-h-64 overflow-y-auto">
            {filtered.length === 0 && <li className="px-3 py-2 text-sm text-text-light">{emptyText}</li>}
            {filtered.map((o, i) => {
              const selected = isSelected(o.value);
              return (
                <li
                  key={o.value}
                  id={`${baseId}-opt-${i}`}
                  role="option"
                  aria-selected={selected}
                  aria-disabled={o.disabled || undefined}
                  onMouseEnter={() => setActive(i)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(o)}
                  className={cn(
                    'flex cursor-pointer items-start gap-2 rounded-lg px-3 py-2 text-sm',
                    i === active && 'bg-primary-light-90',
                    o.disabled && 'cursor-not-allowed opacity-50',
                  )}
                >
                  <Check className={cn('mt-0.5 h-4 w-4 shrink-0 text-primary', !selected && 'invisible')} aria-hidden="true" />
                  <span className="min-w-0">
                    <span className="block truncate">{o.label}</span>
                    {o.description && <span className="block text-xs text-text-light">{o.description}</span>}
                  </span>
                </li>
              );
            })}
          </ul>
          {footer}
        </div>
      )}
    </div>
  );
}
