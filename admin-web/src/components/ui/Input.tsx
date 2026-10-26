import type { InputHTMLAttributes, LabelHTMLAttributes, Ref, TextareaHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

const base =
  'w-full rounded-xl border border-input bg-white px-3 text-sm text-text placeholder:text-text-light-muted ' +
  'focus:outline-none focus:ring-2 focus:ring-secondary disabled:cursor-not-allowed disabled:bg-neutral-30';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  ref?: Ref<HTMLInputElement>;
  invalid?: boolean;
}

export function Input({ className, invalid, ...rest }: InputProps) {
  return (
    <input
      aria-invalid={invalid || undefined}
      className={cn(base, 'h-10', invalid && 'border-error-60', className)}
      {...rest}
    />
  );
}

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  ref?: Ref<HTMLTextAreaElement>;
  invalid?: boolean;
}

export function Textarea({ className, invalid, ...rest }: TextareaProps) {
  return (
    <textarea
      aria-invalid={invalid || undefined}
      className={cn(base, 'min-h-[96px] py-2', invalid && 'border-error-60', className)}
      {...rest}
    />
  );
}

export function Label({ className, ...rest }: LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn('mb-1 block text-xs font-semibold text-text-light', className)} {...rest} />;
}
