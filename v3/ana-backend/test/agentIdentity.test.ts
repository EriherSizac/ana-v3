import { mockClient } from 'aws-sdk-client-mock';
import { S3Client } from '@aws-sdk/client-s3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearAgentIdentityCache, getAgentIdentity } from '../src/lib/agentIdentity';
import { getAgentCampaigns } from '../src/handlers/agent';
import { installCondS3 } from './helpers/condS3';
import { derivedList } from './helpers/admin';
import { bearer, setupAgentAuth, signIdToken } from './helpers/agentJwt';

const UID = 'c8889644-1111-4222-8333-444455556666';
const s3mock = mockClient(S3Client);
let fetchMock: ReturnType<typeof vi.fn>;

const rolesResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  clearAgentIdentityCache();
  process.env.ROLES_API_KEY = 'fake-roles-key';
  process.env.ROLES_API_BASE = 'https://roles.test.invalid/';
  fetchMock = vi.fn(async () => rolesResponse(200, { user_id: UID, name: 'RIOS MIRANDA', username: 'miranda.rios', email: 'x@y' }));
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete process.env.ROLES_API_KEY;
  delete process.env.ROLES_API_BASE;
});

describe('getAgentIdentity (API de Roles)', () => {
  it('devuelve user_id y nombre; llama /users/{username} con X-Api-Key', async () => {
    expect(await getAgentIdentity('Miranda.Rios')).toEqual({ crmUserId: UID, displayName: 'RIOS MIRANDA' });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://roles.test.invalid/users/miranda.rios');
    expect((init.headers as Record<string, string>)['X-Api-Key']).toBe('fake-roles-key');
  });

  it('cachea por username (una sola llamada)', async () => {
    await getAgentIdentity('miranda.rios');
    await getAgentIdentity('miranda.rios');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('HTTP 404 → nulls y no cachea el fallo', async () => {
    fetchMock.mockResolvedValueOnce(rolesResponse(404, { error: 'not found' }));
    expect(await getAgentIdentity('nadie')).toEqual({ crmUserId: null, displayName: null });
    expect(await getAgentIdentity('nadie')).toEqual({ crmUserId: UID, displayName: 'RIOS MIRANDA' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('error de red → nulls (nunca lanza)', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
    expect(await getAgentIdentity('miranda.rios')).toEqual({ crmUserId: null, displayName: null });
  });

  it('user_id ausente o no UUID → nulls', async () => {
    fetchMock.mockResolvedValueOnce(rolesResponse(200, { name: 'X' }));
    expect(await getAgentIdentity('a')).toEqual({ crmUserId: null, displayName: null });
    fetchMock.mockResolvedValueOnce(rolesResponse(200, { user_id: 'no-es-uuid', name: 'X' }));
    expect(await getAgentIdentity('b')).toEqual({ crmUserId: null, displayName: null });
  });

  it('sin ROLES_API_KEY → nulls sin llamar a la API', async () => {
    delete process.env.ROLES_API_KEY;
    expect(await getAgentIdentity('miranda.rios')).toEqual({ crmUserId: null, displayName: null });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('GET /agent/campaigns con identidad CRM', () => {
  beforeEach(() => {
    s3mock.reset();
    process.env.BUCKET_NAME = 'ana-backend-storage-test';
    const s3 = installCondS3(s3mock, {}, 2);
    s3.set('campaign-agents/prueba.json', derivedList('prueba', ['erick']));
    setupAgentAuth({ enforced: false });
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  it('agrega crmUserId y displayName del agente que llama', async () => {
    const res = await getAgentCampaigns({ headers: bearer(signIdToken()) });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ username: 'erick', campaigns: ['prueba'], crmUserId: UID, displayName: 'RIOS MIRANDA' });
    expect(String(fetchMock.mock.calls[0][0])).toBe('https://roles.test.invalid/users/erick');
  });

  it('API de Roles caída → 200 con crmUserId null', async () => {
    fetchMock.mockResolvedValueOnce(rolesResponse(500, {}));
    const res = await getAgentCampaigns({ headers: bearer(signIdToken()) });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toMatchObject({ campaigns: ['prueba'], crmUserId: null, displayName: null });
  });
});
