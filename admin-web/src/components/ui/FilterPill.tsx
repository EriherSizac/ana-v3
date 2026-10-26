import { X } from 'lucide-react';

export interface FilterPillProps {
  label: string;
  onRemove: () => void;
}

/** Pill de filtro activo con × para quitar (design-system §5). */
export function FilterPill({ label, onRemove }: FilterPillProps) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-primary-light-90 py-1 pl-3 pr-1 text-xs font-semibold text-primary">
      {label}
      <button
        type="button"
        aria-label={`Quitar filtro ${label}`}
        onClick={onRemove}
        className="rounded-full p-0.5 hover:bg-primary-light-80 focus:outline-none focus-visible:ring-2 focus-visible:ring-secondary"
      >
        <X className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </span>
  );
}

/** Alterna un valor en una lista (helper para filtros). */
export function toggleValue<T>(list: readonly T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}
