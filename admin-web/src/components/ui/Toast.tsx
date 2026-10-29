'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { cn } from '@/lib/cn';

export type ToastKind = 'success' | 'error' | 'info';

interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
}

interface ToastApi {
  show: (message: string, kind?: ToastKind) => void;
  success: (message: string) => void;
  error: (message: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const STYLES: Record<ToastKind, string> = {
  success: 'bg-green-50 text-green-700 border-green-700/20',
  error: 'bg-red-50 text-red-700 border-red-700/20',
  info: 'bg-primary-light-90 text-primary border-primary/20',
};

const AUTO_DISMISS_MS = 5000;

/** Toasts no modales: se cierran solos o con ×. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => setItems((xs) => xs.filter((x) => x.id !== id)), []);
  const show = useCallback((message: string, kind: ToastKind = 'info') => {
    const id = nextId.current++;
    setItems((xs) => [...xs, { id, kind, message }]);
  }, []);

  const api = useMemo<ToastApi>(
    () => ({ show, success: (m) => show(m, 'success'), error: (m) => show(m, 'error') }),
    [show],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[calc(100%-2rem)] max-w-sm flex-col gap-2"
      >
        {items.map((t) => (
          <ToastView key={t.id} item={t} onDismiss={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastView({ item, onDismiss }: { item: ToastItem; onDismiss: (id: number) => void }) {
  useEffect(() => {
    const t = window.setTimeout(() => onDismiss(item.id), AUTO_DISMISS_MS);
    return () => window.clearTimeout(t);
  }, [onDismiss, item.id]);
  return (
    <div
      role={item.kind === 'error' ? 'alert' : 'status'}
      className={cn(
        'pointer-events-auto flex items-start gap-3 rounded-xl border px-4 py-3 text-sm shadow-card animate-enter',
        STYLES[item.kind],
      )}
    >
      <span className="flex-1">{item.message}</span>
      <button
        type="button"
        aria-label="Cerrar aviso"
        onClick={() => onDismiss(item.id)}
        className="rounded p-0.5 hover:bg-white/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-secondary"
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
}

/** Acceso a los toasts. Fuera del provider es no-op (útil en pruebas aisladas). */
export function useToast(): ToastApi {
  return (
    useContext(ToastContext) ?? {
      show: () => {},
      success: () => {},
      error: () => {},
    }
  );
}

/** Mensaje inline (design-system §7.5). */
export function InlineMessage({
  kind = 'error',
  children,
  className,
}: {
  kind?: 'error' | 'success' | 'warning';
  children: ReactNode;
  className?: string;
}) {
  if (kind === 'warning') {
    // Aviso no bloqueante: fondo neutro con icono warning en error.60 (design-system §2).
    return (
      <div role="status" className={cn('flex items-start gap-2 rounded-xl border border-neutral-50 bg-neutral-30 px-4 py-2 text-sm text-text-muted', className)}>
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-error-60" aria-hidden="true" />
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    );
  }
  return (
    <div
      role={kind === 'error' ? 'alert' : 'status'}
      className={cn(
        'rounded-xl px-4 py-2 text-sm',
        kind === 'error' ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700',
        className,
      )}
    >
      {children}
    </div>
  );
}
