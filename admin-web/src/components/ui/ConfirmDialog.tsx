'use client';

import type { ReactNode } from 'react';
import { Button } from './Button';
import { Dialog } from './Dialog';

export interface ConfirmDialogProps {
  open: boolean;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  destructive?: boolean;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Mientras es true, los botones quedan deshabilitados y no se puede cerrar. */
  loading?: boolean;
  confirmDisabled?: boolean;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}

/**
 * Confirmación obligatoria para toda acción destructiva y toda confirmación
 * (sustituye a `confirm()` nativo; design-system §5 y §11).
 */
export function ConfirmDialog({
  open,
  title,
  description,
  children,
  destructive = false,
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  loading = false,
  confirmDisabled = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const icon = (
    <span
      aria-hidden="true"
      className={
        destructive
          ? 'flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-error-10 text-lg font-bold text-error-60'
          : 'flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary-light-90 text-lg font-bold text-primary'
      }
    >
      {destructive ? '⚠' : '?'}
    </span>
  );
  return (
    <Dialog
      open={open}
      title={title}
      description={description}
      onClose={onCancel}
      dismissable={!loading}
      icon={icon}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onCancel} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button
            data-autofocus
            variant={destructive ? 'destructive' : 'default'}
            onClick={() => void onConfirm()}
            loading={loading}
            disabled={confirmDisabled}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
    </Dialog>
  );
}
