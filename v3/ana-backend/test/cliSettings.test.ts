import { mockClient } from 'aws-sdk-client-mock';
import { S3Client } from '@aws-sdk/client-s3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { agentSettingsResponse, getCliSettings, updateCliSettingsHandler } from '../src/handlers/cliSettings';
import { CliSettingsError, readCliSettings, updateCliSettings } from '../src/lib/cliSettings';
import { installCondS3, type CondS3 } from './helpers/condS3';
import { ADMIN, adminEvent, mockV4Me, parse } from './helpers/admin';

const s3mock = mockClient(S3Client);
let s3: CondS3;
const KEY = 'config/cli-settings.json';
const DEV = { permissions: [], campaigns: ['*'], roleNames: ['Developér'], isAdmin: false };

beforeEach(() => {
  s3mock.reset();
  process.env.BUCKET_NAME = 'ana-backend-storage-test';
  s3 = installCondS3(s3mock);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('lib/cliSettings', () => {
  it('objeto inexistente = defaults', async () => {
    const { doc } = await readCliSettings();
    expect(doc).toEqual({ schemaVersion: 1, settings: { noWhatsappConsultRegistration: false }, updatedAt: null, updatedBy: null });
  });

  it('texto "true" se ignora (tipo incorrecto) y llaves desconocidas también', async () => {
    s3.set(KEY, JSON.stringify({ schemaVersion: 1, settings: { noWhatsappConsultRegistration: 'true', modoTurbo: true } }));
    expect((await readCliSettings()).doc.settings).toEqual({ noWhatsappConsultRegistration: false });
  });

  it('versión 2 o JSON inválido = error', async () => {
    s3.set(KEY, JSON.stringify({ schemaVersion: 2, settings: {} }));
    await expect(readCliSettings()).rejects.toBeInstanceOf(CliSettingsError);
    s3.set(KEY, '{roto');
    await expect(readCliSettings()).rejects.toBeInstanceOf(CliSettingsError);
  });

  it('escritura condicional con reintento ante conflicto', async () => {
    s3.set(KEY, JSON.stringify({ schemaVersion: 1, settings: {}, updatedAt: null, updatedBy: null }));
    let once = false;
    s3.beforePut = () => {
      if (!once) {
        once = true;
        s3.set(KEY, JSON.stringify({ schemaVersion: 1, settings: {}, updatedAt: 'x', updatedBy: 'otro' }));
      }
    };
    const doc = await updateCliSettings({ noWhatsappConsultRegistration: true }, 'erick.silva', () => new Date('2026-10-26T00:00:00Z'));
    expect(doc.updatedBy).toBe('erick.silva');
    expect(s3.puts).toHaveLength(2);
    expect(s3.json(KEY)).toEqual({ schemaVersion: 1, settings: { noWhatsappConsultRegistration: true }, updatedAt: '2026-10-26T00:00:00.000Z', updatedBy: 'erick.silva' });
  });
});

describe('GET/POST /admin/cli-settings', () => {
  it('Developer sin configuración guardada → defaults, catálogo y updatedAt nulo', async () => {
    mockV4Me(DEV);
    const res = await getCliSettings(adminEvent({}));
    expect(res.statusCode).toBe(200);
    const data = parse(res).data;
    expect(data.settings).toEqual({ noWhatsappConsultRegistration: false });
    expect(data.updatedAt).toBeNull();
    expect(data.catalog).toEqual([
      expect.objectContaining({ key: 'noWhatsappConsultRegistration', type: 'boolean', default: false, description: expect.any(String) }),
    ]);
  });

  it('Developer activa el flag → guarda autor (minúsculas) y fecha', async () => {
    mockV4Me(DEV);
    const res = await updateCliSettingsHandler(adminEvent({ username: 'Erick.Silva', body: { settings: { noWhatsappConsultRegistration: true } } }));
    expect(res.statusCode).toBe(200);
    expect(parse(res).data).toMatchObject({ settings: { noWhatsappConsultRegistration: true }, updatedBy: 'erick.silva' });
    expect(s3.json(KEY)).toMatchObject({ schemaVersion: 1, settings: { noWhatsappConsultRegistration: true }, updatedBy: 'erick.silva' });
  });

  it('admin sin rol Developer → 403 "Solo Developer" sin S3', async () => {
    mockV4Me(ADMIN);
    const res = await updateCliSettingsHandler(adminEvent({ body: { settings: { noWhatsappConsultRegistration: true } } }));
    expect(res.statusCode).toBe(403);
    expect(parse(res)).toEqual({ success: false, message: 'Solo Developer' });
    expect(s3mock.calls()).toHaveLength(0);
    mockV4Me(ADMIN);
    expect((await getCliSettings(adminEvent({}))).statusCode).toBe(403);
  });

  it('llave desconocida → 400 sin escribir', async () => {
    mockV4Me(DEV);
    const res = await updateCliSettingsHandler(adminEvent({ body: { settings: { modoTurbo: true } } }));
    expect(parse(res)).toEqual({ success: false, message: 'Configuración desconocida: modoTurbo' });
    expect(s3.puts).toHaveLength(0);
  });

  it('tipo incorrecto → 400', async () => {
    mockV4Me(DEV);
    const res = await updateCliSettingsHandler(adminEvent({ body: { settings: { noWhatsappConsultRegistration: 'true' } } }));
    expect(res.statusCode).toBe(400);
  });

  it('conflicto persistente → 409', async () => {
    mockV4Me(DEV);
    s3.set(KEY, JSON.stringify({ schemaVersion: 1, settings: {} }));
    s3.beforePut = () => s3.set(KEY, JSON.stringify({ schemaVersion: 1, settings: {} }));
    const res = await updateCliSettingsHandler(adminEvent({ body: { settings: { noWhatsappConsultRegistration: true } } }));
    expect(res.statusCode).toBe(409);
  });

  it('v4 caído → 503', async () => {
    mockV4Me('down');
    expect((await getCliSettings(adminEvent({}))).statusCode).toBe(503);
  });
});

describe('GET /agent/settings (cuerpo)', () => {
  it('200 con defaults', async () => {
    const res = await agentSettingsResponse();
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ settings: { noWhatsappConsultRegistration: false }, updatedAt: null });
  });

  it('500 con objeto ilegible', async () => {
    s3.set(KEY, '{roto');
    const res = await agentSettingsResponse();
    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body)).toEqual({ error: 'Configuración no disponible' });
  });
});
