import type { ButtonHTMLAttributes, Ref } from 'react';
import { cn } from '@/lib/cn';

export type ButtonVariant = 'default' | 'outline' | 'destructive' | 'ghost' | 'inverse';
export type ButtonSize = 'sm' | 'default' | 'lg' | 'icon';

const VARIANTS: Record<ButtonVariant, string> = {
  default: 'bg-primary text-primary-foreground hover:bg-primary-10 active:bg-primary-20',
  outline: 'border border-neutral-60 bg-white text-primary hover:bg-primary-light-90',
  destructive: 'bg-error-60 text-white hover:bg-error-70',
  ghost: 'bg-transparent text-text-muted hover:bg-neutral-40',
  // Sobre fondos azules (login).
  inverse: 'bg-white text-primary hover:bg-primary-light-90',
};

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-xs',
  default: 'h-10 px-4 text-sm',
  lg: 'h-12 px-6 text-base',
  icon: 'h-10 w-10 p-0',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Deshabilita el botón y muestra un indicador de progreso. */
  loading?: boolean;
  ref?: Ref<HTMLButtonElement>;
}

export function Button({
  variant = 'default',
  size = 'default',
  loading = false,
  disabled,
  className,
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition-colors',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-secondary focus-visible:ring-offset-1',
        'disabled:cursor-not-allowed disabled:opacity-60',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...rest}
    >
      {loading && (
        <span
          aria-hidden="true"
          className="inline-block h-4 w-4 rounded-full border-2 border-current border-r-transparent"
          style={{ animation: 'spin 0.8s linear infinite' }}
        />
      )}
      {children}
    </button>
  );
}
