import { cn } from '@/lib/cn';

export interface ToggleProps {
  checked: boolean;
  /** Nombre accesible del interruptor. */
  label: string;
  onChange: () => void;
  disabled?: boolean;
}

/** Interruptor (`role="switch"`) con tokens del sistema de diseño. */
export function Toggle({ checked, label, onChange, disabled }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={onChange}
      className={cn(
        'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-secondary disabled:opacity-60',
        checked ? 'bg-primary' : 'bg-neutral-60',
      )}
    >
      <span className={cn('inline-block h-5 w-5 rounded-full bg-white shadow-card transition-transform', checked ? 'translate-x-5' : 'translate-x-0.5')} />
    </button>
  );
}
