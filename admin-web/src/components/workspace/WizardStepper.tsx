'use client';

import { ArrowLeft, ArrowRight, Check } from 'lucide-react';
import { Button } from '@/components/ui';
import { cn } from '@/lib/cn';
import { WIZARD_STEPS, type WizardStep } from '@/lib/workspace/wizard';

/** Encabezado del asistente: pasos 1–4 con estado actual/completado; los anteriores se pueden revisitar. */
export function WizardStepper({ current, onGo }: { current: WizardStep; onGo: (step: WizardStep) => void }) {
  return (
    <nav aria-label="Pasos de la asignación" className="pernexium-card p-4 sm:p-5">
      <ol className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {WIZARD_STEPS.map(({ step, title }) => {
          const done = step < current;
          const active = step === current;
          return (
            <li key={step} aria-current={active ? 'step' : undefined} data-testid={`wizard-step-${step}`} data-state={active ? 'current' : done ? 'complete' : 'upcoming'}>
              <button
                type="button"
                disabled={!done}
                onClick={() => onGo(step)}
                className={cn(
                  'flex w-full items-center gap-3 rounded-xl px-2 py-1.5 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-secondary',
                  done && 'hover:bg-neutral-30',
                  !done && 'cursor-default',
                )}
              >
                <span
                  className={cn(
                    'flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-sm font-semibold',
                    active && 'border-primary bg-primary text-primary-foreground shadow-card',
                    done && 'border-primary bg-primary-light-90 text-primary',
                    !active && !done && 'border-neutral-60 bg-white text-text-light',
                  )}
                  aria-hidden="true"
                >
                  {done ? <Check className="h-4 w-4" /> : step}
                </span>
                <span className="min-w-0">
                  <span className="block text-2xs uppercase tracking-wider text-text-light">Paso {step}</span>
                  <span className={cn('jost block truncate text-sm font-semibold', active || done ? 'text-primary' : 'text-text-muted')}>{title}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** Barra inferior del paso: Atrás / Siguiente (deshabilitado con el motivo mientras el paso no sea válido). */
export function WizardNav({
  step,
  block,
  loading,
  onBack,
  onNext,
  nextLabel = 'Siguiente',
}: {
  step: WizardStep;
  block: string | null;
  loading?: boolean;
  onBack: () => void;
  onNext?: () => void;
  nextLabel?: string;
}) {
  return (
    <div className="mt-6 flex flex-col-reverse gap-3 border-t border-neutral-40 pt-4 sm:flex-row sm:items-center sm:justify-between">
      <Button variant="outline" onClick={onBack} disabled={step === 1}>
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Atrás
      </Button>
      {onNext && (
        <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
          {block && (
            <span className="text-xs text-text-light" data-testid="step-block">
              {block}
            </span>
          )}
          <Button onClick={onNext} disabled={!!block} loading={loading}>
            {nextLabel}
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      )}
    </div>
  );
}
