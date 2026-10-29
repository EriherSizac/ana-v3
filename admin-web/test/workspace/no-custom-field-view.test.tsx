import { render, screen, within } from '@testing-library/react';
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

/** "Mi asignación": aviso no bloqueante de plantilla sin campo personalizado. */
const K = 'assignments/agents/prueba/ana.lopez-contacts-T1.csv';
const CSV = [
  'phone_number,ana_upload_id,segmento_credito,saldo_vencido_actual,nombre_cliente',
  '5215500000001,U1,A,100,Ana',
  '5215500000002,U1,B,200,Beto',
].join('\n');

beforeEach(() => {
  resetNavigation();
  apiFetch.mockReset();
  localStorage.clear();
  sessionStorage.clear();
  apiFetch.mockImplementation(async (url: string, init?: { method?: string }) => {
    if (url === '/api/agent/campaigns') return { campaigns: ['prueba'] };
    if (url.endsWith('/publications')) return { items: [] };
    if (url.includes('/file?key=')) return { key: K, etag: '"e1"', csv: CSV };
    if (init?.method === 'POST') return { publishId: 'P1', manifest: { contacts: 2, rows: 2, publishId: 'P1' } };
    if (/^\/api\/agent\/assignments\/[^/]+$/.test(url)) return { items: [{ key: K, fileName: 'f.csv', lastModified: null, size: 1, etag: '"e1"' }] };
    return {};
  });
});

const next = () => userEvent.click(screen.getByRole('button', { name: 'Siguiente' }));
const warning = () => screen.queryByTestId('no-custom-field-warning');
const editor = () => screen.getByLabelText('Mensaje para WhatsApp') as HTMLTextAreaElement;

async function toMessage() {
  render(<MyAssignmentView />);
  await screen.findByTestId('pending-files');
  await next();
  await screen.findByTestId('contacts-table');
  await next();
}

describe('Mi asignación: plantilla sin campo personalizado', () => {
  it('el aviso aparece y desaparece en vivo; variable desconocida no lo quita', async () => {
    await toMessage();
    expect(warning()).toBeNull(); // mensaje vacío
    await userEvent.type(editor(), 'Hola, tienes un saldo pendiente');
    expect(warning()).toHaveTextContent('Tu plantilla no tiene ningún campo personalizado');
    await userEvent.type(editor(), ' {{{{apodo}}');
    expect(warning()).not.toBeNull();
    await userEvent.clear(editor());
    await userEvent.type(editor(), 'Hola {{{{nombre_cliente}}');
    expect(warning()).toBeNull();
  });

  it('sugiere 3 columnas (sin teléfono ni ana_upload_id) y el chip inserta {{col}} en el cursor', async () => {
    await toMessage();
    await userEvent.type(editor(), 'Hola  tu saldo');
    const chips = within(warning()!).getAllByRole('button').map((b) => b.textContent);
    expect(chips).toEqual(['{{nombre_cliente}}', '{{saldo_vencido_actual}}', '{{segmento_credito}}']);
    editor().setSelectionRange(5, 5);
    await userEvent.click(screen.getByRole('button', { name: 'Insertar {{nombre_cliente}}' }));
    expect(editor()).toHaveValue('Hola {{nombre_cliente}} tu saldo');
    expect(warning()).toBeNull();
  });

  it('se repite en el Resumen; el ConfirmDialog lo menciona y permite "Enviar de todos modos"', async () => {
    await toMessage();
    await userEvent.type(editor(), 'Hola');
    await next();
    expect(screen.getByTestId('summary-no-custom-field')).toHaveTextContent('Tu plantilla no tiene ningún campo personalizado');
    await userEvent.click(screen.getByRole('button', { name: 'Enviar' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('tu plantilla no tiene ningún campo personalizado');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Enviar de todos modos' }));
    expect(await screen.findByTestId('publish-success')).toBeInTheDocument();
  });

  it('con variable válida: sin aviso en el Resumen y el botón es "Enviar"', async () => {
    await toMessage();
    await userEvent.type(editor(), 'Hola {{{{nombre_cliente}}');
    await next();
    expect(screen.queryByTestId('summary-no-custom-field')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Enviar' }));
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'Enviar' })).toBeInTheDocument();
    expect(within(screen.getByRole('dialog')).queryByRole('button', { name: 'Enviar de todos modos' })).toBeNull();
  });
});
