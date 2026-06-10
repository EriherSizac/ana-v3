// File: Skeleton
// Created: 2026-06-09
// Updated: 2026-06-09
// Author: Erick Hernández Silva

export function Skeleton({ className = '' }: { className?: string }) {
  return <div aria-hidden className={`animate-pulse rounded bg-neutral-40 ${className}`} />;
}
