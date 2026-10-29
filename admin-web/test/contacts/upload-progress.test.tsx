import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetNavigation } from '../helpers/navigation';

vi.mock('next/navigation', () => import('../helpers/navigation'));
vi.mock('@/lib/auth-client', () => ({ hasSession: async () => true, logout: vi.fn(), currentIdToken: vi.fn() }));
const apiFetch = vi.fn();
vi.mock('@/lib/api-client', async () => {
  const real = await vi.importActual<typeof import('@/lib/api-client')>('@/lib/api-client');
  return { ...real, apiFetch: (...a: unknown[]) => apiFetch(...a) };
});

import { ContactsUploadView } from '@/components/contacts/ContactsUploadView';
import { CancelledError, createContactsProcessor, type ContactsProcessor } from '@/lib/contacts/processor';
import type { Progress } from '@/lib/contacts/pipeline';

// support-crm-base-upload: "Procesamiento en segundo plano", "Pegado sin congelar la página" y "Carga v3 grande por S3".

type Handler = (url: string, init?: { method?: string; json?: any }) => unknown;
function setApi(enabled: string[], handler: Handler = () => ({})) {
  apiFetch.mockImplementation(async (url: string, init?: { method?: string; json?: any }) => {
    if (url === '/api/campaigns') return { campaigns: ['didi_vip'] };
    if (/\/enabled-agents\?fleet=/.test(url)) return { agents: enabled, supervisors: [] };
    return handler(url, init);
  });
}

async function pick(label: RegExp, option: string) {
  await userEvent.click(await screen.findByRole('button', { name: label }));
  await userEvent.click(screen.getByRole('option', { name: option }));
}

async function setup(createProcessor?: () => ContactsProcessor) {
  render(<ContactsUploadView pollIntervalMs={10} pollTimeoutMs={200} {...(createProcessor ? { createProcessor } : {})} />);
  await pick(/Campaña/, 'didi_vip');
  await waitFor(() => expect(screen.getByLabelText('Archivo CSV')).toBeEnabled());
}

beforeEach(() => {
  resetNavigation();
  apiFetch.mockReset();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

/** Procesador falso: `read` queda pendiente y reporta progreso cuando la prueba lo pide. */
function fakeProcessor() {
  const ctl: { progress?: (p: Progress) => void; reject?: (e: unknown) => void; cancelled: number } = { cancelled: 0 };
  const proc: ContactsProcessor = {
    read: (_input, onProgress) =>
      new Promise((_resolve, reject) => {
        ctl.progress = onProgress;
        ctl.reject = reject;
      }),
    check: async () => ({ error: 'no usado' }),
    plan: async () => ({ error: 'no usado' }),
    cancel: () => {
      ctl.cancelled++;
      ctl.reject?.(new CancelledError());
    },
    dispose: () => {},
  };
  return { ctl, factory: () => proc };
}

describe('procesamiento en segundo plano', () => {
  it('muestra fase y % con barra de progreso, la página sigue interactiva y "Cancelar" detiene el Worker', async () => {
    setApi(['ana']);
    const { ctl, factory } = fakeProcessor();
    await setup(factory);
    await userEvent.upload(screen.getByLabelText('Archivo CSV'), new File(['phone\n5215500000001'], 'c.csv', { type: 'text/csv' }));
    await waitFor(() => expect(ctl.progress).toBeDefined());
    ctl.progress!({ phase: 'lectura', done: 50_000, total: 100_000 });
    const bar = await screen.findByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '50');
    expect(screen.getByTestId('processing')).toHaveTextContent('Lectura · 50% (50,000 de 100,000 filas)');
    ctl.progress!({ phase: 'validación', done: 75_000, total: 100_000 });
    await waitFor(() => expect(screen.getByTestId('processing')).toHaveTextContent('Validación · 75%'));
    // La UI responde mientras tanto (otro control abre y cambia).
    await pick(/Modo/, 'Asignar a un agente');
    expect(screen.getByRole('button', { name: /Agente/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Vista previa' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(ctl.cancelled).toBeGreaterThan(0);
    await waitFor(() => expect(screen.queryByRole('progressbar')).toBeNull());
    expect(screen.queryByTestId('read-summary')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('pegado', () => {
  it('toma el texto del evento paste sin pintarlo en el área: resumen y muestra; luego procesa', async () => {
    let sent: any = null;
    setApi(['ana'], (_url, init) => {
      if (init?.method === 'POST') {
        sent = init.json;
        return { fleet: 'v3', status: 'completed', manifest: { perAgent: [{ agent: 'ana', rows: 2 }] } };
      }
      return {};
    });
    await setup();
    await userEvent.click(screen.getByRole('tab', { name: 'Pegar' }));
    const area = screen.getByLabelText('Pegar desde Excel') as HTMLTextAreaElement;
    const tsv = 'id_credito\ttelefono_1\tfecha_corte\n1\t5500000001\t45961\n2\t5500000002\t45962\n';
    fireEvent.paste(area, { clipboardData: { getData: (t: string) => (t === 'text/plain' ? tsv : '') } });
    const summary = await screen.findByTestId('paste-summary');
    expect(summary).toHaveTextContent('Datos pegados: 3 líneas');
    expect(summary).toHaveTextContent('id_credito │ telefono_1 │ fecha_corte');
    expect(area.value).toBe('');
    await userEvent.click(screen.getByRole('button', { name: 'Usar datos pegados' }));
    const read = await screen.findByTestId('read-summary');
    expect(read).toHaveTextContent('2 filas · 3 columnas');
    expect(read).toHaveTextContent('2 fecha(s) de Excel convertidas');
    expect(await screen.findByTestId('validation-summary')).toHaveTextContent('2 válidas');
    await userEvent.click(screen.getByRole('button', { name: 'Vista previa' }));
    await screen.findByTestId('preview-ana');
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar carga' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Entregar' }));
    await screen.findByTestId('delivery');
    expect(sent.csv).toBe(tsv);
  });
});

describe('carga v3 grande por S3', () => {
  it('más de 4 MB: presign, PUT directo con el CSV maestro y POST con uploadId/sourceKey (sin csv)', async () => {
    const calls: Array<{ url: string; json?: any }> = [];
    setApi(['ana', 'beto'], (url, init) => {
      calls.push({ url, json: init?.json });
      if (url.endsWith('/uploads/presign')) {
        return { uploadId: '20261029T100000-abcdef12', sourceKey: 'uploads-incoming/didi_vip/20261029T100000-abcdef12.csv', url: 'https://s3.test/put?sig', headers: { 'Content-Type': 'text/csv' } };
      }
      if (url.endsWith('/uploads') && init?.method === 'POST') return { fleet: 'v3', status: 'completed', manifest: { perAgent: [{ agent: 'ana', rows: 1 }] } };
      return {};
    });
    const put = vi.fn(async (_url: string, _init: RequestInit) => new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', put);
    await setup(() => createContactsProcessor(() => null));
    const rows = Array.from({ length: 190_000 }, (_, i) => `${5215500000000 + i},Nombre ${i}`).join('\n');
    const text = 'phone,name_largo_para_crecer\n' + rows + '\n';
    expect(text.length).toBeGreaterThan(4 * 1024 * 1024);
    await userEvent.upload(screen.getByLabelText('Archivo CSV'), new File([text], 'grande.csv', { type: 'text/csv' }));
    expect(await screen.findByTestId('read-summary', {}, { timeout: 15_000 })).toHaveTextContent('Archivo grande');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Vista previa' })).toBeEnabled(), { timeout: 15_000 });
    await userEvent.click(screen.getByRole('button', { name: 'Vista previa' }));
    await screen.findByTestId('preview-ana', {}, { timeout: 15_000 });
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar carga' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Entregar' }));
    await screen.findByTestId('delivery', {}, { timeout: 15_000 });
    const presign = calls.find((c) => c.url.endsWith('/uploads/presign'))!;
    expect(presign.json).toEqual({ fleet: 'v3', bytes: expect.any(Number) });
    expect(put).toHaveBeenCalledTimes(1);
    const [putUrl, putInit] = put.mock.calls[0]!;
    expect(putUrl).toBe('https://s3.test/put?sig');
    expect(putInit.method).toBe('PUT');
    expect(putInit.headers).toEqual({ 'Content-Type': 'text/csv' });
    expect((putInit.body as Blob).size).toBe(presign.json.bytes);
    const post = calls.find((c) => c.url.endsWith('/uploads'))!;
    expect(post.json).toMatchObject({ fleet: 'v3', uploadId: '20261029T100000-abcdef12', sourceKey: 'uploads-incoming/didi_vip/20261029T100000-abcdef12.csv' });
    expect(post.json).not.toHaveProperty('csv');
    expect(post.json.plan.counts).toEqual({ ana: 95_000, beto: 95_000 });
  }, 60_000);
});
