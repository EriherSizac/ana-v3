import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

/** Loader visual (design-system §5). No se lee como texto (aria-hidden). */
export function Skeleton({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div aria-hidden="true" data-skeleton="" className={cn('skeleton-shimmer rounded-md', className)} {...rest} />;
}

/** Filas Skeleton para tablas en carga. */
export function SkeletonRows({ rows = 8, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div aria-hidden="true" className="flex flex-col gap-3 py-2" data-testid="skeleton-rows">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-4">
          {Array.from({ length: cols }).map((__, j) => (
            <Skeleton key={j} className={cn('h-4', j === 0 ? 'w-40' : 'w-24')} />
          ))}
        </div>
      ))}
    </div>
  );
}
