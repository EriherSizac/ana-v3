import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

export type BadgeVariant = 'default' | 'primary' | 'secondary' | 'success' | 'error' | 'muted' | 'outline';

const VARIANTS: Record<BadgeVariant, string> = {
  default: 'bg-primary-light-90 text-primary',
  primary: 'bg-primary text-primary-foreground',
  secondary: 'bg-secondary-light-90 text-primary-30',
  success: 'bg-green-50 text-green-700',
  error: 'bg-error-10 text-error-70',
  muted: 'bg-neutral-40 text-text-muted',
  outline: 'border border-neutral-60 bg-white text-text-muted',
};

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
}

export function Badge({ variant = 'default', className, ...rest }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold',
        VARIANTS[variant],
        className,
      )}
      {...rest}
    />
  );
}
