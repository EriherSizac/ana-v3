import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetNavigation } from '../helpers/navigation';

vi.mock('next/navigation', () => import('../helpers/navigation'));
vi.mock('@/lib/auth-client', () => ({ hasSession: async () => true, logout: vi.fn(), currentIdToken: vi.fn() }));
const apiFetch = vi.fn();
vi.mock('@/lib/api-client', async () => {
  const real = await vi.importActual<typeof import('@/lib/api-client')>('@/lib/api-client');
  return { ...real, apiFetch: (...a: unknown[]) => apiFetch(...a) };
});

import { MyAssignmentView } from '@/components/workspace/MyAssignmentView';
import { storageKey } from '@/lib/workspace';

/** add-agent-workspace: "Filtros y orden de contactos" en "Mi asignación". */
const K = 'assignments/agents/prueba/ana.lopez-contacts-T1.csv';
const CSV = [
  'phone_number,nombre,saldo_vencido_actual,fecha_pago,segmento_credito,tramo_vencido',
  '5215500000001,Beto,"1,200.50",05/03/2026,A,1-30',
  '5215500000002,Ana,300,28/12/2025,B,31-60',
  '5215500000003,Carla,15000,01/03/2026,A,61-90',
  '5215500000004,Dora,90,10/01/2026,C,1-30',
].join('\n');

function setApi() {
  apiFetch.mockImplementation(async (url: string) => {
    if (url === '/api/agent/campaigns') return { campaigns: ['prueba'] };
    if (url.endsWith('/publications')) return { items: [] };
    if (url.includes('/file?key=')) return { key: K, etag: '"e1"', csv: CSV };
    if (/^\/api\/agent\/assignments\/[^/]+$/.test(url)) return { items: [{ key: K, fileName: 'f.csv', lastModified: null, size: 1, etag: '"e1"' }] };
    return {};
  });
}

async function load() {
  render(<MyAssignmentView />);
  await screen.findByTestId('pending-files');
  await userEvent.click(screen.getByRole('button', { name: 'Siguiente' }));
  return screen.findByTestId('contacts-table');
}

const bodyNames = (table: HTMLElement) =>
  within(table)
    .getAllByRole('row')
    .slice(1)
    .map((tr) => within(tr).getAllByRole('cell')[2]!.textContent);

beforeEach(() => {
  resetNavigation();
  apiFetch.mockReset();
  localStorage.clear();
  sessionStorage.clear();
  setApi();
});

describe('Mi asignación: filtros y orden', () => {
  it('clic en encabezado ordena numérico asc/desc con aria-sort', async () => {
    const table = await load();
    const header = within(table).getByRole('columnheader', { name: /saldo_vencido_actual/ });
    expect(header).toHaveAttribute('aria-sort', 'none');
    await userEvent.click(within(header).getByRole('button', { name: 'saldo_vencido_actual' }));
    expect(header).toHaveAttribute('aria-sort', 'ascending');
    expect(bodyNames(table)).toEqual(['Dora', 'Ana', 'Beto', 'Carla']);
    await userEvent.click(within(header).getByRole('button', { name: 'saldo_vencido_actual' }));
    expect(header).toHaveAttribute('aria-sort', 'descending');
    expect(bodyNames(table)).toEqual(['Carla', 'Beto', 'Ana', 'Dora']);
  });

  it('ordena fechas dd/mm/yyyy por fecha real', async () => {
    const table = await load();
    await userEvent.click(within(within(table).getByRole('columnheader', { name: /fecha_pago/ })).getByRole('button', { name: 'fecha_pago' }));
    expect(bodyNames(table)).toEqual(['Ana', 'Dora', 'Carla', 'Beto']);
  });

  it('multiselect + pill + "Limpiar filtros"; seleccionar todos = filas filtradas', async () => {
    const table = await load();
    await userEvent.click(within(screen.getByTestId('contacts-filters')).getByRole('button', { name: /^segmento_credito/ }));
    await userEvent.click(screen.getByRole('option', { name: 'A' }));
    await userEvent.keyboard('{Escape}');
    expect(bodyNames(table)).toEqual(['Beto', 'Carla']);
    expect(within(screen.getByTestId('filter-pills')).getByText('segmento_credito: A')).toBeInTheDocument();

    // Cargar selecciona todo; las 2 filas ocultas se avisan y se puede quedar solo con lo filtrado.
    expect(screen.getByTestId('hidden-selected')).toHaveTextContent('2 fila(s) seleccionada(s) fuera de los filtros');
    await userEvent.click(screen.getByRole('button', { name: 'Seleccionar solo los resultados' }));
    expect(screen.getByText(/2 fila\(s\) seleccionada\(s\) · 2 teléfono\(s\)/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar todos los resultados' }));
    expect(screen.queryByText(/fila\(s\) seleccionada\(s\) ·/)).toBeNull();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar todos los resultados' }));
    expect(screen.getByText(/2 fila\(s\) seleccionada\(s\) · 2 teléfono\(s\)/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Limpiar filtros' }));
    expect(bodyNames(table)).toHaveLength(4);
    expect(screen.queryByTestId('filter-pills')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Limpiar filtros' })).toBeNull();
  });

  it('rango numérico de monto con pill que se puede quitar', async () => {
    const table = await load();
    await userEvent.type(screen.getByLabelText('saldo_vencido_actual mínimo'), '500');
    expect(bodyNames(table)).toEqual(['Beto', 'Carla']);
    await userEvent.type(screen.getByLabelText('saldo_vencido_actual máximo'), '2000');
    expect(bodyNames(table)).toEqual(['Beto']);
    await userEvent.click(screen.getByRole('button', { name: 'Quitar filtro saldo_vencido_actual: 500 – 2000' }));
    expect(bodyNames(table)).toHaveLength(4);
  });

  it('persiste filtros y orden por campaña en localStorage y los restaura', async () => {
    let table = await load();
    await userEvent.type(screen.getByLabelText('Buscar contactos'), 'a');
    await userEvent.click(within(within(table).getByRole('columnheader', { name: /nombre/ })).getByRole('button', { name: 'nombre' }));
    const saved = JSON.parse(localStorage.getItem(storageKey('prueba'))!);
    expect(saved).toMatchObject({ filters: { search: 'a' }, sort: { column: 'nombre', dir: 'asc' } });

    cleanup();
    sessionStorage.clear(); // sin borrador del asistente: vuelve al paso 1
    table = await load();
    expect(screen.getByLabelText('Buscar contactos')).toHaveValue('a');
    expect(within(table).getByRole('columnheader', { name: /nombre/ })).toHaveAttribute('aria-sort', 'ascending');
    expect(bodyNames(table)).toEqual(['Ana', 'Beto', 'Carla', 'Dora']);
  });

  it('localStorage corrupto no rompe la vista', async () => {
    localStorage.setItem(storageKey('prueba'), '{roto');
    const table = await load();
    expect(bodyNames(table)).toHaveLength(4);
  });
});
