import { useState } from 'react';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { FilterPill } from '@/components/ui/FilterPill';
import { SearchableMultiselect } from '@/components/ui/SearchableMultiselect';
import { SearchableSelect } from '@/components/ui/SearchableSelect';
import { Skeleton } from '@/components/ui/Skeleton';
import { ToastProvider, useToast } from '@/components/ui/Toast';

const CAMPAIGNS = ['didi_vip', 'didi_regular', 'zendere', 'prueba'].map((c) => ({ value: c, label: c }));

describe('ConfirmDialog', () => {
  const setup = (props: Partial<Parameters<typeof ConfirmDialog>[0]> = {}) => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog open title="Eliminar registro" description="No se puede deshacer." destructive confirmLabel="Eliminar" onCancel={onCancel} onConfirm={onConfirm} {...props} />,
    );
    return { onCancel, onConfirm };
  };

  it('tiene role=dialog y aria-modal', () => {
    setup();
    const d = screen.getByRole('dialog');
    expect(d).toHaveAttribute('aria-modal', 'true');
    expect(d).toHaveAccessibleName('Eliminar registro');
  });

  it('Escape cierra', async () => {
    const { onCancel } = setup();
    await userEvent.keyboard('{Escape}');
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('clic en backdrop cierra', async () => {
    const { onCancel } = setup();
    await userEvent.click(screen.getByTestId('dialog-backdrop'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('Cancelar cierra y Confirmar confirma', async () => {
    const { onCancel, onConfirm } = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    await userEvent.click(screen.getByRole('button', { name: 'Eliminar' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('con loading los botones quedan deshabilitados y no se cierra', async () => {
    const { onCancel } = setup({ loading: true });
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Eliminar' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Cerrar' })).toBeNull();
    await userEvent.keyboard('{Escape}');
    await userEvent.click(screen.getByTestId('dialog-backdrop'));
    expect(onCancel).not.toHaveBeenCalled();
  });
});

describe('Button', () => {
  it('loading deshabilita', () => {
    render(<Button loading>Guardar</Button>);
    expect(screen.getByRole('button', { name: 'Guardar' })).toBeDisabled();
  });
});

describe('Skeleton', () => {
  it('no se lee como texto', () => {
    const { container } = render(<Skeleton className="h-4 w-32" />);
    expect(container.firstChild).toHaveAttribute('aria-hidden', 'true');
  });
});

function SelectHarness({ onChange }: { onChange: (v: string) => void }) {
  const [v, setV] = useState<string | null>(null);
  return (
    <SearchableSelect
      label="Campaña"
      options={CAMPAIGNS}
      value={v}
      onChange={(x) => {
        setV(x);
        onChange(x);
      }}
    />
  );
}

describe('SearchableSelect', () => {
  it('filtra por texto y elige una opción', async () => {
    const onChange = vi.fn();
    render(<SelectHarness onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: /Campaña/ }));
    await userEvent.type(screen.getByRole('combobox'), 'didi');
    const opts = within(screen.getByRole('listbox')).getAllByRole('option');
    expect(opts.map((o) => o.textContent)).toEqual(['didi_vip', 'didi_regular']);
    await userEvent.click(opts[1]!);
    expect(onChange).toHaveBeenCalledWith('didi_regular');
    expect(screen.getByRole('button', { name: /Campaña/ })).toHaveTextContent('didi_regular');
  });

  it('no acepta texto que no sea una opción', async () => {
    const onChange = vi.fn();
    render(<SelectHarness onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: /Campaña/ }));
    await userEvent.type(screen.getByRole('combobox'), 'inventada{Enter}');
    expect(screen.getByText('Sin resultados')).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('teclado: flechas + Enter eligen, Escape cierra', async () => {
    const onChange = vi.fn();
    render(<SelectHarness onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: /Campaña/ }));
    await userEvent.keyboard('{ArrowDown}{Enter}');
    expect(onChange).toHaveBeenCalledWith('didi_regular');
    await userEvent.click(screen.getByRole('button', { name: /Campaña/ }));
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).toBeNull();
  });
});

function MultiHarness() {
  const [sel, setSel] = useState<string[]>([]);
  return (
    <>
      <SearchableMultiselect label="Campañas" options={CAMPAIGNS} selected={sel} onChange={setSel} />
      {sel.map((s) => (
        <FilterPill key={s} label={`Campaña: ${s}`} onRemove={() => setSel(sel.filter((x) => x !== s))} />
      ))}
    </>
  );
}

describe('SearchableMultiselect + FilterPill', () => {
  it('selecciona varios, muestra pills y las quita', async () => {
    render(<MultiHarness />);
    await userEvent.click(screen.getByRole('button', { name: /Campañas/ }));
    await userEvent.type(screen.getByRole('combobox'), 'zen');
    await userEvent.click(screen.getByRole('option', { name: 'zendere' }));
    await userEvent.clear(screen.getByRole('combobox'));
    await userEvent.click(screen.getByRole('option', { name: 'prueba' }));
    expect(screen.getByText('Campaña: zendere')).toBeInTheDocument();
    expect(screen.getByText('Campaña: prueba')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Quitar filtro Campaña: zendere' }));
    expect(screen.queryByText('Campaña: zendere')).toBeNull();
  });
});

function ToastHarness() {
  const t = useToast();
  return <Button onClick={() => t.error('Algo falló')}>Disparar</Button>;
}

describe('Toast', () => {
  it('se cierra con × y solo tras 5 s', async () => {
    render(
      <ToastProvider>
        <ToastHarness />
      </ToastProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Disparar' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Algo falló');
    await userEvent.click(screen.getByRole('button', { name: 'Cerrar aviso' }));
    expect(screen.queryByRole('alert')).toBeNull();

    vi.useFakeTimers();
    try {
      act(() => screen.getByRole('button', { name: 'Disparar' }).click());
      expect(screen.getByRole('alert')).toBeInTheDocument();
      act(() => vi.advanceTimersByTime(5100));
      expect(screen.queryByRole('alert')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
