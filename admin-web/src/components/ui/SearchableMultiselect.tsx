'use client';

import { Combobox, type SelectOption } from './Combobox';
import { toggleValue } from './FilterPill';

export interface SearchableMultiselectProps {
  label: string;
  hideLabel?: boolean;
  options: readonly SelectOption[];
  selected: readonly string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  id?: string;
}

/**
 * Selección múltiple con búsqueda (estilo Notion). Los valores activos se
 * muestran fuera, con `FilterPill` (design-system §5 y §7.1).
 */
export function SearchableMultiselect({
  label,
  hideLabel,
  options,
  selected,
  onChange,
  placeholder,
  disabled,
  className,
  id,
}: SearchableMultiselectProps) {
  const count = selected.length;
  return (
    <Combobox
      id={id}
      multiple
      label={label}
      hideLabel={hideLabel}
      options={options}
      isSelected={(v) => selected.includes(v)}
      onPick={(v) => {
        if (options.some((o) => o.value === v)) onChange(toggleValue(selected, v));
      }}
      display={count === 0 ? <span className="text-text-light-muted">{label}</span> : `${label} (${count})`}
      placeholder={placeholder}
      disabled={disabled}
      className={className}
      footer={
        count > 0 ? (
          <button
            type="button"
            onClick={() => onChange([])}
            className="mt-2 w-full rounded-lg px-3 py-1.5 text-left text-xs font-semibold text-primary hover:bg-primary-light-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-secondary"
          >
            Limpiar selección
          </button>
        ) : null
      }
    />
  );
}
