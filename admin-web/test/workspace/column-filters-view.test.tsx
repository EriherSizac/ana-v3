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

/** "Mi asignación": filtros por encabezado de columna (estilo Excel) sobre la barra de filtros. */
const K = 'assignments/agents/prueba/ana.lopez-contacts-T1.csv';
const CSV = [
  'phone_number,nombre,saldo_vencido_actual,fecha_pago,segmento_credito,tramo_vencido',
  '5215500000001,Beto,"1,200.50",05/03/2026,A,1-30',
  '5215500000002,Ana,300,28/12/2025,B,31-60',
  '5215500000003,Carla,15000,01/03/2026,A,61-90',
  '5215500000004,Dora,90,10/01/2026,C,1-30',
].join('\n');

function setApi(csv = CSV) {
  apiFetch.mockImplementation(async (url: string) => {
    if (url === '/api/agent/campaigns') return { campaigns: ['prueba'] };
    if (url.endsWith('/publications')) return { items: [] };
    if (url.includes('/file?key=')) return { key: K, etag: '"e1"', csv };
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

async function openFilter(column: string) {
  await userEvent.click(screen.getByRole('button', { name: `Filtrar ${column}` }));
  return screen.getByRole('dialog', { name: `Filtro de ${column}` });
}
const pills = () => screen.queryByTestId('filter-pills');
const savedColumns = () => JSON.parse(localStorage.getItem(storageKey('prueba'))!).filters.columns;

beforeEach(() => {
  resetNavigation();
  apiFetch.mockReset();
  localStorage.clear();
  sessionStorage.clear();
  setApi();
});

describe('Mi asignación: filtros por encabezado', () => {
  it('cada columna tiene botón de filtro; la lista muestra valores con conteo, búsqueda, "Seleccionar todo" y "Limpiar"', async () => {
    const table = await load();
    for (const h of ['phone_number', 'nombre', 'saldo_vencido_actual', 'fecha_pago', 'segmento_credito', 'tramo_vencido']) {
      expect(within(within(table).getByRole('columnheader', { name: new RegExp(h) })).getByRole('button', { name: `Filtrar ${h}` })).toBeInTheDocument();
    }
    const pop = await openFilter('tramo_vencido');
    const list = within(pop).getByRole('group', { name: 'Valores de tramo_vencido' });
    expect(within(list).getAllByRole('checkbox').map((c) => c.getAttribute('aria-label'))).toEqual(['1-30', '31-60', '61-90']);
    expect(within(list).getByText('1-30').parentElement).toHaveTextContent('1-302');

    await userEvent.click(within(pop).getByRole('checkbox', { name: '1-30' }));
    expect(bodyNames(table)).toEqual(['Beto', 'Dora']);
    expect(screen.getByRole('button', { name: 'Filtrar tramo_vencido' })).toHaveAttribute('data-active', 'true');
    expect(within(pills()!).getByText('tramo_vencido: 1-30')).toBeInTheDocument();

    await userEvent.type(within(pop).getByRole('searchbox', { name: 'Buscar valores de tramo_vencido' }), '6');
    expect(within(list).getAllByRole('checkbox').map((c) => c.getAttribute('aria-label'))).toEqual(['31-60', '61-90']);
    await userEvent.click(within(pop).getByRole('button', { name: 'Seleccionar todo' }));
    expect(bodyNames(table)).toHaveLength(4);
    await userEvent.click(within(pop).getByRole('button', { name: 'Limpiar' })); // limpia solo lo buscado
    expect(bodyNames(table)).toEqual(['Beto', 'Dora']);

    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Filtro de tramo_vencido' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Filtrar tramo_vencido' })).toHaveFocus();
  });

  it('los valores listados dependen de los demás filtros (estilo Excel)', async () => {
    await load();
    await userEvent.click(within(screen.getByTestId('contacts-filters')).getByRole('button', { name: /^segmento_credito/ }));
    await userEvent.click(screen.getByRole('option', { name: 'A' }));
    await userEvent.keyboard('{Escape}');
    const pop = await openFilter('tramo_vencido');
    expect(within(pop).getAllByRole('checkbox').map((c) => c.getAttribute('aria-label'))).toEqual(['1-30', '61-90']);
  });

  it('rango numérico en el popover con pill que se puede quitar', async () => {
    const table = await load();
    const pop = await openFilter('saldo_vencido_actual');
    await userEvent.type(within(pop).getByLabelText('Mínimo de saldo_vencido_actual'), '100');
    await userEvent.type(within(pop).getByLabelText('Máximo de saldo_vencido_actual'), '2000');
    expect(bodyNames(table)).toEqual(['Beto', 'Ana']);
    await userEvent.keyboard('{Escape}');
    await userEvent.click(screen.getByRole('button', { name: 'Quitar filtro saldo_vencido_actual: 100 – 2000' }));
    expect(bodyNames(table)).toHaveLength(4);
    expect(screen.getByRole('button', { name: 'Filtrar saldo_vencido_actual' })).not.toHaveAttribute('data-active');
  });

  it('rango de fechas dd/mm/aaaa; texto inválido avisa y no filtra', async () => {
    const table = await load();
    const pop = await openFilter('fecha_pago');
    expect(within(pop).queryByLabelText('Mínimo de fecha_pago')).toBeNull();
    await userEvent.type(within(pop).getByLabelText('Desde fecha_pago'), '2026');
    expect(within(pop).getByText('Usa el formato dd/mm/aaaa')).toBeInTheDocument();
    expect(bodyNames(table)).toHaveLength(4);
    await userEvent.clear(within(pop).getByLabelText('Desde fecha_pago'));
    await userEvent.type(within(pop).getByLabelText('Desde fecha_pago'), '01/01/2026');
    await userEvent.type(within(pop).getByLabelText('Hasta fecha_pago'), '05/03/2026');
    expect(bodyNames(table)).toEqual(['Beto', 'Carla', 'Dora']);
    await userEvent.keyboard('{Escape}');
    await userEvent.click(screen.getByRole('button', { name: 'Quitar filtro fecha_pago: 01/01/2026 – 05/03/2026' }));
    expect(bodyNames(table)).toHaveLength(4);
  });

  it('teléfonos: solo lista de valores, enmascarados', async () => {
    await load();
    const pop = await openFilter('phone_number');
    expect(within(pop).queryByLabelText('Mínimo de phone_number')).toBeNull();
    const labels = within(pop).getAllByRole('checkbox').map((c) => c.getAttribute('aria-label') ?? '');
    expect(labels).toHaveLength(4);
    expect(labels.some((l) => l.includes('5215500000001'))).toBe(false);
  });

  it('se combinan con la barra (AND) y "Limpiar filtros" quita ambos', async () => {
    const table = await load();
    await userEvent.click(within(screen.getByTestId('contacts-filters')).getByRole('button', { name: /^segmento_credito/ }));
    await userEvent.click(screen.getByRole('option', { name: 'A' }));
    await userEvent.keyboard('{Escape}');
    const pop = await openFilter('tramo_vencido');
    await userEvent.click(within(pop).getByRole('checkbox', { name: '1-30' }));
    await userEvent.keyboard('{Escape}');
    expect(bodyNames(table)).toEqual(['Beto']);
    expect(within(pills()!).getByText('segmento_credito: A')).toBeInTheDocument();
    expect(within(pills()!).getByText('tramo_vencido: 1-30')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Limpiar filtros' }));
    expect(bodyNames(table)).toHaveLength(4);
    expect(pills()).toBeNull();
    expect(savedColumns()).toEqual({});
    expect(screen.getByRole('button', { name: 'Filtrar tramo_vencido' })).not.toHaveAttribute('data-active');
  });

  it('"Seleccionar todos los resultados" respeta los filtros de encabezado', async () => {
    await load();
    const pop = await openFilter('tramo_vencido');
    await userEvent.click(within(pop).getByRole('checkbox', { name: '1-30' }));
    await userEvent.keyboard('{Escape}');
    expect(screen.getByText('Seleccionar todos los resultados (2)')).toBeInTheDocument();
    expect(screen.getByTestId('hidden-selected')).toHaveTextContent('2 fila(s) seleccionada(s) fuera de los filtros');
    // Desmarcar todo solo afecta a las filas filtradas: las 2 ocultas siguen seleccionadas.
    await userEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar todos los resultados' }));
    expect(screen.getByTestId('selection-bar')).toHaveTextContent('2 fila(s) seleccionada(s)');
    expect(screen.getByRole('checkbox', { name: 'Seleccionar fila 0:0' })).not.toBeChecked();
    await userEvent.click(screen.getByRole('button', { name: 'Seleccionar solo los resultados' }));
    expect(screen.queryByTestId('hidden-selected')).toBeNull();
    expect(screen.getByTestId('selection-bar')).toHaveTextContent('2 fila(s) seleccionada(s) · 2 teléfono(s)');
    expect(screen.getByRole('checkbox', { name: 'Seleccionar fila 0:0' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Seleccionar fila 0:3' })).toBeChecked();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar todos los resultados' }));
    expect(screen.queryByTestId('selection-bar')).toBeNull();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar todos los resultados' }));
    expect(screen.getByTestId('selection-bar')).toHaveTextContent('2 fila(s) seleccionada(s)');
    await userEvent.click(screen.getByRole('button', { name: 'Limpiar filtros' }));
    expect(screen.getByRole('checkbox', { name: 'Seleccionar fila 0:1' })).not.toBeChecked();
  });

  it('persisten por campaña junto con los demás filtros y se restauran', async () => {
    let table = await load();
    const pop = await openFilter('nombre');
    await userEvent.click(within(pop).getByRole('checkbox', { name: 'Ana' }));
    await userEvent.click(within(pop).getByRole('checkbox', { name: 'Dora' }));
    expect(savedColumns()).toEqual({ nombre: { values: ['Ana', 'Dora'] } });

    cleanup();
    sessionStorage.clear();
    table = await load();
    expect(bodyNames(table)).toEqual(['Ana', 'Dora']);
    expect(within(pills()!).getByText('nombre: Ana, Dora')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Filtrar nombre' })).toHaveAttribute('data-active', 'true');
  });

  it('muchos valores: lista los más frecuentes y la búsqueda encuentra el resto', async () => {
    const rows = Array.from({ length: 260 }, (_, i) => `52155${String(i).padStart(8, '0')},n${i},${i},01/01/2026,A,1-30`);
    setApi(['phone_number,nombre,saldo_vencido_actual,fecha_pago,segmento_credito,tramo_vencido', ...rows].join('\n'));
    const table = await load();
    const pop = await openFilter('nombre');
    expect(within(pop).getAllByRole('checkbox')).toHaveLength(200);
    expect(within(pop).getByTestId('column-filter-truncated')).toHaveTextContent('Mostrando 200 de 260 valores');
    await userEvent.type(within(pop).getByRole('searchbox'), 'n259');
    await userEvent.click(within(pop).getByRole('checkbox', { name: 'n259' }));
    expect(bodyNames(table)).toEqual(['n259']);
  });
});
