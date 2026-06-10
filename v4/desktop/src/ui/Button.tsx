// File: Button
// Created: 2026-06-09
// Updated: 2026-06-09
// Author: Erick Hernández Silva

import type { ButtonHTMLAttributes } from 'react';

type Variant = 'default' | 'outline' | 'destructive' | 'ghost';

const styles: Record<Variant, string> = {
  default: 'bg-primary text-primary-foreground hover:bg-primary/90',
  outline: 'border border-neutral-50 bg-white text-text hover:bg-neutral-30',
  destructive: 'bg-error-60 text-white hover:bg-error-70',
  ghost: 'text-text-muted hover:bg-neutral-30',
};

export function Button({
  variant = 'default',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      className={`rounded-xl px-4 py-2 text-sm font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-secondary disabled:opacity-50 ${styles[variant]} ${className}`}
      {...props}
    />
  );
}
