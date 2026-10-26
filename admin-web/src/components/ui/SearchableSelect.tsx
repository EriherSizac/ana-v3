'use client';

import { Combobox, type SelectOption } from './Combobox';

export type { SelectOption } from './Combobox';

export interface SearchableSelectProps {
  label: string;
  hideLabel?: boolean;
  options: readonly SelectOption[];
  value: string | null;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Texto cuando no hay valor elegido. */
  emptyLabel?: string;
  disabled?: boolean;
  className?: string;
  id?: string;
}

/** Selector de un valor con búsqueda (reemplaza a `<select>`; design-system §11). */
export function SearchableSelect({
  label,
  hideLabel,
  options,
  value,
  onChange,
  placeholder,
  emptyLabel = 'Selecciona…',
  disabled,
  className,
  id,
}: SearchableSelectProps) {
  const current = options.find((o) => o.value === value);
  return (
    <Combobox
      id={id}
      label={label}
      hideLabel={hideLabel}
      options={options}
      isSelected={(v) => v === value}
      onPick={(v) => {
        // Solo valores de la lista (el texto libre únicamente filtra).
        if (options.some((o) => o.value === v)) onChange(v);
      }}
      display={current ? current.label : <span className="text-text-light-muted">{emptyLabel}</span>}
      placeholder={placeholder}
      disabled={disabled}
      className={className}
    />
  );
}
