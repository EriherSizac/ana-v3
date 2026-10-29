import { mockClient } from 'aws-sdk-client-mock';
import { GetObjectCommand, ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getAgentCampaigns, getAgentSettings } from '../src/handlers/agent';
import { installCondS3, type CondS3 } from './helpers/condS3';
import { derivedList } from './helpers/admin';
import { bearer, setupAgentAuth, signIdToken } from './helpers/agentJwt';

const s3mock = mockClient(S3Client);
let s3: CondS3;

const disabled = (campaign: string, user: string) =>
  JSON.stringify({ schemaVersion: 2, campaign, updatedAt: null, updatedBy: null, overrides: { [user]: { enabled: false, updatedAt: 'x', updatedBy: 'l' } } });

beforeEach(() => {
  s3mock.reset();
  process.env.BUCKET_NAME = 'ana-backend-storage-test';
  s3 = installCondS3(s3mock, {}, 2); // paginación de 2 en 2
  setupAgentAuth({ enforced: false });
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

const parse = (r: { body: string }) => JSON.parse(r.body);

describe('GET /agent/campaigns', () => {
  it('lista las campañas habilitadas en orden alfabético (paginado)', async () => {
    s3.set('campaign-agents/ventas.json', derivedList('ventas', ['erick']));
    s3.set('campaign-agents/prueba.json', derivedList('prueba', ['erick', 'ana']));
    s3.set('campaign-agents/cobranza.json', derivedList('cobranza', ['erick']));
    s3.set('rosters/cobranza.json', disabled('cobranza', 'erick'));
    s3.set('campaign-agents/didi.json', derivedList('didi', ['ana'])); // no derivado
    s3.set('campaign-agents/vieja.json', derivedList('vieja', ['erick'], new Date(Date.now() - 48 * 3600_000).toISOString())); // vencida
    const res = await getAgentCampaigns({ headers: bearer(signIdToken({ 'cognito:username': 'Erick' })) });
    expect(res.statusCode).toBe(200);
    expect(parse(res)).toEqual({ username: 'erick', campaigns: ['prueba', 'ventas'], crmUserId: null, displayName: null });
    expect(s3mock.commandCalls(ListObjectsV2Command).length).toBeGreaterThan(1);
  });

  it('agente sin campañas → lista vacía', async () => {
    s3.set('campaign-agents/prueba.json', derivedList('prueba', ['ana']));
    const res = await getAgentCampaigns({ headers: bearer(signIdToken()) });
    expect(parse(res)).toEqual({ username: 'erick', campaigns: [], crmUserId: null, displayName: null });
  });

  it('sin token en modo reporte → 401 sin leer rosters', async () => {
    s3.set('campaign-agents/prueba.json', derivedList('prueba', ['erick']));
    const res = await getAgentCampaigns({ headers: {} });
    expect(res.statusCode).toBe(401);
    expect(s3mock.calls()).toHaveLength(0);
  });
});

describe('GET /agent/settings (add-cli-remote-settings 1.3)', () => {
  it('200 con defaults si no hay configuración guardada', async () => {
    const res = await getAgentSettings({ headers: bearer(signIdToken()) });
    expect(res.statusCode).toBe(200);
    expect(parse(res)).toEqual({ settings: { noWhatsappConsultRegistration: false }, updatedAt: null });
    expect(res.headers['Cache-Control']).toBe('no-store');
  });

  it('500 con objeto ilegible', async () => {
    s3.set('config/cli-settings.json', '{no es json');
    const res = await getAgentSettings({ headers: bearer(signIdToken()) });
    expect(res.statusCode).toBe(500);
  });

  it('sin token (aun en modo reporte) → 401 sin leer S3', async () => {
    const res = await getAgentSettings({ headers: {} });
    expect(res.statusCode).toBe(401);
    expect(s3mock.commandCalls(GetObjectCommand)).toHaveLength(0);
  });

  it('valor guardado', async () => {
    s3.set(
      'config/cli-settings.json',
      JSON.stringify({ schemaVersion: 1, settings: { noWhatsappConsultRegistration: true }, updatedAt: '2026-10-26T10:00:00Z', updatedBy: 'dev' }),
    );
    const res = await getAgentSettings({ headers: bearer(signIdToken()) });
    expect(parse(res).settings.noWhatsappConsultRegistration).toBe(true);
  });
});
