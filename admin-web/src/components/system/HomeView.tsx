'use client';

import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { PageContainer, PageHeader } from '@/components/ui/Page';
import { allowedSections, SECTIONS, type Section } from '@/lib/sections';
import { useAccess } from './AccessContext';

/** Inicio: resumen de las secciones que el usuario puede usar. */
export function HomeView({ sections = SECTIONS }: { sections?: readonly Section[] }) {
  const access = useAccess();
  const visible = allowedSections(access, sections);
  return (
    <PageContainer>
      <PageHeader title="ANA Admin" description={`Hola, ${access.username}. Elige una sección para comenzar.`} />
      {visible.length === 0 ? (
        <div className="pernexium-card p-6 text-sm text-text-muted">Aún no hay secciones disponibles para tu acceso.</div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((s) => (
            <Link
              key={s.href}
              href={s.href}
              className="pernexium-card group flex flex-col gap-2 p-6 transition-colors hover:border-primary-light-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-secondary"
            >
              <span className="flex items-center justify-between text-base font-semibold text-primary">
                {s.label}
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
              </span>
              <span className="text-sm text-text-light">{s.description}</span>
            </Link>
          ))}
        </div>
      )}
    </PageContainer>
  );
}
