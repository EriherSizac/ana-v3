import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

/** Contenedor estándar de página (design-system §4). */
export function PageContainer({
  children,
  narrow = false,
  className,
}: {
  children: ReactNode;
  narrow?: boolean;
  className?: string;
}) {
  return (
    <main className={cn('mx-auto px-4 py-8 sm:px-6 lg:px-8 lg:py-10', narrow ? 'max-w-4xl' : 'max-w-7xl', className)}>
      {children}
    </main>
  );
}

/** Un único h1 por página y su descripción. */
export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-2xl font-bold sm:text-3xl">{title}</h1>
        {description && <p className="mt-1 text-sm text-text-light">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

/** Envoltura obligatoria de tablas (scroll horizontal en móvil; §7.4). */
export function TableContainer({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('overflow-x-auto', className)}>{children}</div>;
}
